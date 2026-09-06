import { expect } from "chai";

import { discoverAccounts, queryFilterInChunks, type KeeperContracts } from "../scripts/v4-keeper";

const ALICE = "0x0000000000000000000000000000000000000001";
const BOB = "0x0000000000000000000000000000000000000002";
const CAROL = "0x0000000000000000000000000000000000000003";

describe("V4 keeper log discovery", function () {
  it("uses one large hosted scan when the RPC accepts it", async function () {
    const ranges: Array<[number, number]> = [];
    const events = await queryFilterInChunks(
      async (fromBlock, toBlock) => {
        ranges.push([fromBlock, toBlock]);
        return [`${fromBlock}-${toBlock}`];
      },
      100,
      125,
    );

    expect(ranges).to.deep.equal([[100, 125]]);
    expect(events).to.deep.equal(["100-125"]);
  });

  it("adaptively splits a rejected hosted scan until the RPC accepts it", async function () {
    const acceptedRanges: Array<[number, number]> = [];
    const events = await queryFilterInChunks(
      async (fromBlock, toBlock) => {
        const span = toBlock - fromBlock + 1;
        if (span > 10) throw new Error("range too large");
        acceptedRanges.push([fromBlock, toBlock]);
        return [`${fromBlock}-${toBlock}`];
      },
      100,
      125,
    );

    expect(acceptedRanges.every(([fromBlock, toBlock]) => toBlock - fromBlock + 1 <= 10)).to.equal(true);
    expect(acceptedRanges[0]?.[0]).to.equal(100);
    expect(acceptedRanges.at(-1)?.[1]).to.equal(125);
    expect(events.length).to.equal(acceptedRanges.length);
  });

  it("handles equal and reversed ranges without gaps or calls", async function () {
    const equalRanges: Array<[number, number]> = [];
    await queryFilterInChunks(
      async (fromBlock, toBlock) => {
        equalRanges.push([fromBlock, toBlock]);
        return [];
      },
      42,
      42,
    );
    expect(equalRanges).to.deep.equal([[42, 42]]);

    let reversedCalls = 0;
    const reversed = await queryFilterInChunks(
      async () => {
        reversedCalls++;
        return ["unexpected"];
      },
      43,
      42,
    );
    expect(reversedCalls).to.equal(0);
    expect(reversed).to.deep.equal([]);
  });

  it("discovers both event sources and de-duplicates accounts", async function () {
    const requestedRanges: Array<[number, number]> = [];
    const renewedRanges: Array<[number, number]> = [];
    const requestedEvents = [
      { blockNumber: 100, args: { account: ALICE } },
      { blockNumber: 110, args: { account: BOB } },
      { blockNumber: 120, args: { account: ALICE } },
    ];
    const renewedEvents = [
      { blockNumber: 105, args: { player: ALICE } },
      { blockNumber: 115, args: { player: CAROL } },
      { blockNumber: 125, args: { player: BOB } },
    ];

    const seatKeeper = {
      filters: { SeatAttestationRequested: () => "SeatAttestationRequested" },
      queryFilter: async (_filter: unknown, fromBlock: number, toBlock: number) => {
        requestedRanges.push([fromBlock, toBlock]);
        return requestedEvents.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
      },
    };
    const pool = {
      filters: { ShardedSeatRenewed: () => "ShardedSeatRenewed" },
      queryFilter: async (_filter: unknown, fromBlock: number, toBlock: number) => {
        renewedRanges.push([fromBlock, toBlock]);
        return renewedEvents.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
      },
    };

    const accounts = await discoverAccounts({ seatKeeper, pool } as unknown as KeeperContracts, 100, 125);

    expect(accounts).to.deep.equal([ALICE, BOB, CAROL]);
    expect(requestedRanges).to.deep.equal([[100, 125]]);
    expect(renewedRanges).to.deep.equal(requestedRanges);
  });
});
