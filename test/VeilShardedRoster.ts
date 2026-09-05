import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import type { VeilShardedRosterHarness } from "../types";

const DRAW_PERIOD = 60 * 60;
const SHARD_COUNT = 24;
const SHARD_SIZE = 24;
const CAPACITY = SHARD_COUNT * SHARD_SIZE;

function testAddress(index: number) {
  return ethers.getAddress(
    `0x${BigInt(index + 10_000)
      .toString(16)
      .padStart(40, "0")}`,
  );
}

async function deployRoster() {
  return (await (
    await ethers.getContractFactory("VeilShardedRosterHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedRosterHarness;
}

describe("VeilShardedRoster", function () {
  it("supports 576 active savers while keeping every shard bounded at 24", async function () {
    const roster = await deployRoster();

    expect(await roster.SHARD_COUNT()).to.equal(SHARD_COUNT);
    expect(await roster.SHARD_SIZE()).to.equal(SHARD_SIZE);
    expect(await roster.MAX_ACTIVE_SAVERS()).to.equal(CAPACITY);

    for (let batch = 0; batch < SHARD_COUNT; batch++) {
      const accounts = Array.from({ length: SHARD_SIZE }, (_, offset) => testAddress(batch * SHARD_SIZE + offset));
      await roster.acquireMany(accounts);
    }

    expect(await roster.playerCount()).to.equal(CAPACITY);
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      expect(await roster.shardPlayerCount(shard)).to.equal(SHARD_SIZE);
    }

    await expect(roster.acquire(testAddress(CAPACITY))).to.be.revertedWith("Draw roster full");
  });

  it("compacts and reuses capacity inside one shard without moving other shards", async function () {
    const roster = await deployRoster();
    const accounts = Array.from({ length: SHARD_COUNT * 2 }, (_, index) => testAddress(index));
    await roster.acquireMany(accounts.slice(0, SHARD_COUNT));
    await roster.acquireMany(accounts.slice(SHARD_COUNT));

    const firstShardZero = accounts[0];
    const secondShardZero = accounts[SHARD_COUNT];
    expect(await roster.seatShard(firstShardZero)).to.equal(0);
    expect(await roster.seatShard(secondShardZero)).to.equal(0);
    expect(await roster.shardPlayerCount(0)).to.equal(2);

    await roster.release(firstShardZero);

    expect(await roster.shardPlayerCount(0)).to.equal(1);
    expect(await roster.getShardPlayer(0, 0)).to.equal(secondShardZero);
    expect(await roster.shardPlayerCount(1)).to.equal(2);

    const replacement = testAddress(999);
    await roster.acquire(replacement);
    expect(await roster.seatShard(replacement)).to.equal(0);
    expect(await roster.seatIndexInShard(replacement)).to.equal(1);
    expect(await roster.shardPlayerCount(0)).to.equal(2);
  });

  it("seals only a mutated shard and prevents post-close seat backfills", async function () {
    const roster = await deployRoster();
    const alice = testAddress(1);
    const bob = testAddress(2);
    const late = testAddress(3);

    await roster.acquire(alice);
    await roster.acquire(bob);
    await roster.setWeight(alice, 100);
    await roster.setWeight(bob, 100);

    expect(await roster.seatShard(alice)).to.equal(0);
    expect(await roster.seatShard(bob)).to.equal(1);

    const firstOpen = await roster.firstDrawOpensAt();
    const firstClose = firstOpen + BigInt(DRAW_PERIOD);
    await time.increaseTo(firstClose + 1n);

    await roster.setWeight(alice, 75);

    expect(await roster.shardLastSealedRoundId(0)).to.equal(1);
    expect(await roster.shardStateEpochCount(0)).to.equal(1);
    expect(await roster.shardLastSealedRoundId(1)).to.equal(0);
    expect(await roster.shardStateEpochCount(1)).to.equal(0);

    const epoch = await roster.getShardEpoch(0, 1);
    expect(epoch.startRoundId).to.equal(1);
    expect(epoch.endRoundId).to.equal(1);
    expect(epoch.participantCount).to.equal(1);

    const historicalAlice = await roster.historicalSeat(1, 0, 0);
    expect(historicalAlice.account).to.equal(alice);

    await roster.acquire(late);
    expect(await roster.seatShard(late)).to.equal(2);
    expect(await roster.shardLastSealedRoundId(2)).to.equal(1);
    expect(await roster.historicalParticipantCount(1, 2, firstClose)).to.equal(0);
    expect(await roster.shardPlayerCount(2)).to.equal(1);

    await roster.setWeight(bob, 75);
    expect(await roster.shardLastSealedRoundId(1)).to.equal(1);

    const historicalBob = await roster.historicalSeat(1, 1, 0);
    expect(historicalBob.account).to.equal(bob);
    expect(historicalBob.eligibleFromRoundId).to.equal(2);
    expect(await roster.historicalParticipantCount(1, 1, firstClose)).to.equal(0);
  });
});
