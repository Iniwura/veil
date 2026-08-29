import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { VeilShardedDrawHarness } from "../types";

const DRAW_PERIOD = 60 * 60;
const SHARD_COUNT = 24;
const SHARD_SIZE = 24;
const CAPACITY = SHARD_COUNT * SHARD_SIZE;

function testAddress(index: number) {
  return ethers.getAddress(`0x${BigInt(index + 100_000).toString(16).padStart(40, "0")}`);
}

async function deployDraw() {
  return (await (
    await ethers.getContractFactory("VeilShardedDrawHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedDrawHarness;
}

async function advanceToRoundClose(draw: VeilShardedDrawHarness, roundId: bigint) {
  const firstOpen = await draw.firstDrawOpensAt();
  const closesAt = firstOpen + roundId * BigInt(DRAW_PERIOD);
  await time.increaseTo(closesAt + 1n);
}

async function decryptPrizeShard(draw: VeilShardedDrawHarness, roundId: bigint, prizeIndex: number) {
  const handle = await draw.getEncryptedPrizeShard(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([handle]);
  const key = Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues;
  return { shard: Number(proof.clearValues[key]), proof: proof.decryptionProof };
}

async function decryptPrizeMember(draw: VeilShardedDrawHarness, roundId: bigint, prizeIndex: number) {
  const handle = await draw.getEncryptedPrizeMember(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([handle]);
  const key = Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues;
  return { winner: String(proof.clearValues[key]), proof: proof.decryptionProof };
}

describe("VeilShardedDraw max-capacity runtime", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("executes a 24-shard by 24-member draw with all 576 seats occupied", async function () {
    this.timeout(120_000);
    const draw = await deployDraw();

    for (let batch = 0; batch < SHARD_SIZE; batch++) {
      const accounts = Array.from({ length: SHARD_COUNT }, (_, shard) =>
        testAddress(batch * SHARD_COUNT + shard),
      );
      await (await draw.acquireManyWithWeight(accounts, 100)).wait();
    }

    expect(await draw.playerCount()).to.equal(CAPACITY);
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      expect(await draw.shardPlayerCount(shard)).to.equal(SHARD_SIZE);
    }

    await advanceToRoundClose(draw, 1n);
    await (await draw.setNextRoundId(2)).wait();
    await advanceToRoundClose(draw, 2n);

    await (await draw.beginSnapshot(2)).wait();
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      await (await draw.snapshotShard(2, shard)).wait();
      const shardSnapshot = await draw.getSnapshotShard(2, shard);
      expect(shardSnapshot.participantCount).to.equal(SHARD_SIZE);
    }
    await (await draw.finalizeSnapshot(2)).wait();

    const round = await draw.getShardedSnapshotRound(2);
    expect(round.participantCount).to.equal(CAPACITY);
    expect(round.processedShardCount).to.equal(SHARD_COUNT);
    expect(round.finalized).to.equal(true);

    await (await draw.drawPrizeShard(2, 0)).wait();
    const shardResult = await decryptPrizeShard(draw, 2n, 0);
    expect(shardResult.shard).to.be.lessThan(SHARD_COUNT);
    expect((await draw.getSnapshotShard(2, shardResult.shard)).participantCount).to.equal(SHARD_SIZE);
    await (await draw.finalizePrizeShard(2, 0, shardResult.shard, shardResult.proof)).wait();

    await (await draw.drawPrizeMember(2, 0)).wait();
    const memberResult = await decryptPrizeMember(draw, 2n, 0);
    expect(memberResult.winner).to.not.equal(ethers.ZeroAddress);
    expect(await draw.seatShard(memberResult.winner)).to.equal(shardResult.shard);

    const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [memberResult.winner]);
    await (await draw.finalizePrizeMember(2, 0, encodedWinner, memberResult.proof)).wait();

    const status = await draw.getShardedPrizeStatus(2, 0);
    expect(status.shardDrawn).to.equal(true);
    expect(status.shardFinalized).to.equal(true);
    expect(status.winnerDrawn).to.equal(true);
    expect(status.winnerFinalized).to.equal(true);
    expect(status.winner).to.equal(memberResult.winner);
  });
});
