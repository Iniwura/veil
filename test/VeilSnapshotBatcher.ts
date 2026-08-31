import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { VeilShardedDrawHarness, VeilSnapshotBatcher } from "../types";
import { estimateShardedSnapshotBatchHcu } from "../scripts/sharded-snapshot-hcu-budget";
import { ZAMA_HCU_LIMITS } from "../scripts/draw-hcu-budget";

const DRAW_PERIOD = 60 * 60;
const SHARD_COUNT = 24;
const SHARD_SIZE = 24;

function testAddress(index: number) {
  return ethers.getAddress(
    `0x${BigInt(index + 100_000)
      .toString(16)
      .padStart(40, "0")}`,
  );
}

async function deployTarget() {
  return (await (
    await ethers.getContractFactory("VeilShardedDrawHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedDrawHarness;
}

async function deployBatcher(target: VeilShardedDrawHarness) {
  return (await (
    await ethers.getContractFactory("VeilSnapshotBatcher")
  ).deploy(await target.getAddress())) as VeilSnapshotBatcher;
}

async function fill(target: VeilShardedDrawHarness) {
  for (let batch = 0; batch < SHARD_SIZE; batch++) {
    const accounts = Array.from({ length: SHARD_COUNT }, (_, shard) => testAddress(batch * SHARD_COUNT + shard));
    await (await target.acquireManyWithWeight(accounts, 100)).wait();
  }
}

async function advanceToRoundClose(target: VeilShardedDrawHarness, roundId: bigint) {
  const firstOpen = await target.firstDrawOpensAt();
  await time.increaseTo(firstOpen + roundId * BigInt(DRAW_PERIOD) + 1n);
}

async function beginRoundTwo(target: VeilShardedDrawHarness) {
  await advanceToRoundClose(target, 1n);
  await (await target.setNextRoundId(2)).wait();
  await advanceToRoundClose(target, 2n);
  await (await target.beginSnapshot(2)).wait();
}

describe("VeilSnapshotBatcher", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("atomically processes two full shards within both HCU limits", async function () {
    this.timeout(120_000);
    const target = await deployTarget();
    await fill(target);
    await beginRoundTwo(target);

    const batcher = await deployBatcher(target);
    const tx = await batcher.snapshotShards(2, [0, 1]);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Snapshot batch receipt unavailable");

    const measured = fhevm.computeTransactionHCU(receipt);
    const estimate = estimateShardedSnapshotBatchHcu([24, 24]);
    expect(measured.globalHCU).to.be.lessThanOrEqual(estimate.transactionHcu);
    expect(measured.maxHCUDepth).to.be.lessThanOrEqual(estimate.depthHcu);
    expect(measured.globalHCU).to.be.lessThan(ZAMA_HCU_LIMITS.transaction);
    expect(measured.maxHCUDepth).to.be.lessThan(ZAMA_HCU_LIMITS.depth);
    expect((await target.getSnapshotShard(2, 0)).participantCount).to.equal(24);
    expect((await target.getSnapshotShard(2, 1)).participantCount).to.equal(24);
  });

  it("packs all 24 sparse one-seat shards in one HCU-safe transaction", async function () {
    const target = await deployTarget();
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      await (await target.acquire(testAddress(shard))).wait();
      await (await target.setWeight(testAddress(shard), 100)).wait();
    }
    const batcher = await deployBatcher(target);
    await advanceToRoundClose(target, 1n);
    await (await target.setNextRoundId(2)).wait();
    await advanceToRoundClose(target, 2n);
    const shards = Array.from({ length: SHARD_COUNT }, (_, i) => i);
    const tx = await batcher.beginSnapshotShardsAndComplete(shards);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Combined sparse snapshot receipt unavailable");

    const measured = fhevm.computeTransactionHCU(receipt);
    const estimate = estimateShardedSnapshotBatchHcu(Array(SHARD_COUNT).fill(1), true);
    expect(measured.globalHCU).to.be.lessThanOrEqual(estimate.transactionHcu);
    expect(measured.maxHCUDepth).to.be.lessThanOrEqual(estimate.depthHcu);

    const round = await target.getShardedSnapshotRound(2);
    expect(round.processedShardCount).to.equal(SHARD_COUNT);
    expect(round.participantCount).to.equal(SHARD_COUNT);
  });

  it("rejects a three-full-shard batch before mutating any shard", async function () {
    this.timeout(120_000);
    const target = await deployTarget();
    await fill(target);
    await beginRoundTwo(target);

    const batcher = await deployBatcher(target);
    await expect(batcher.snapshotShards(2, [0, 1, 2])).to.be.revertedWithCustomError(
      batcher,
      "SnapshotBatchTransactionHcuExceeded",
    );
    expect((await target.getSnapshotShard(2, 0)).processed).to.equal(false);
    expect((await target.getSnapshotShard(2, 1)).processed).to.equal(false);
    expect((await target.getSnapshotShard(2, 2)).processed).to.equal(false);
  });

  it("rejects duplicates, invalid shard IDs, empty batches, and repeated processing", async function () {
    const target = await deployTarget();
    await target.acquire(testAddress(0));
    await beginRoundTwo(target);
    const batcher = await deployBatcher(target);

    await expect(batcher.snapshotShards(2, [])).to.be.revertedWithCustomError(batcher, "EmptyBatch");
    await expect(batcher.snapshotShards(2, [0, 0])).to.be.revertedWithCustomError(batcher, "DuplicateShard");
    await expect(batcher.snapshotShards(2, [24])).to.be.revertedWithCustomError(batcher, "InvalidShard");
    await (await batcher.snapshotShards(2, [0])).wait();
    await expect(batcher.snapshotShards(2, [0])).to.be.revertedWith("Shard already snapshotted");
  });

  it("fuses begin with the first batch and complete with the final batch", async function () {
    this.timeout(120_000);
    const target = await deployTarget();
    await fill(target);
    await advanceToRoundClose(target, 1n);
    await (await target.setNextRoundId(2)).wait();
    await advanceToRoundClose(target, 2n);

    const batcher = await deployBatcher(target);
    const firstTx = await batcher.beginAndSnapshotShards([0, 1]);
    const firstReceipt = await firstTx.wait();
    if (!firstReceipt) throw new Error("Combined begin receipt unavailable");

    const firstMeasured = fhevm.computeTransactionHCU(firstReceipt);
    const firstEstimate = estimateShardedSnapshotBatchHcu([24, 24], true);
    expect(firstMeasured.globalHCU).to.be.lessThanOrEqual(firstEstimate.transactionHcu);
    expect(firstMeasured.maxHCUDepth).to.be.lessThanOrEqual(firstEstimate.depthHcu);
    expect((await target.getShardedSnapshotRound(2)).begun).to.equal(true);
    expect((await target.getSnapshotShard(2, 0)).participantCount).to.equal(SHARD_SIZE);

    for (let shard = 2; shard < SHARD_COUNT - 2; shard += 2) {
      await (await batcher.snapshotShards(2, [shard, shard + 1])).wait();
    }
    await (await batcher.snapshotShardsAndComplete(2, [SHARD_COUNT - 2, SHARD_COUNT - 1])).wait();

    const round = await target.getShardedSnapshotRound(2);
    expect(round.processedShardCount).to.equal(SHARD_COUNT);
    expect(round.finalized).to.equal(true);
    expect(round.participantCount).to.equal(SHARD_COUNT * SHARD_SIZE);
  });

  it("handles zero occupied shards and a one-seat skipped round", async function () {
    const empty = await deployTarget();
    await beginRoundTwo(empty);
    expect((await empty.getShardedSnapshotRound(2)).processedShardCount).to.equal(SHARD_COUNT);
    await expect(empty.finalizeSnapshot(2)).to.be.revertedWith("Need 2 mature seats");

    const one = await deployTarget();
    await one.acquire(testAddress(1));
    await beginRoundTwo(one);
    expect((await one.getShardedSnapshotRound(2)).participantCount).to.equal(0);
    const oneBatcher = await deployBatcher(one);
    await (await oneBatcher.snapshotShards(2, [0])).wait();
    await expect(one.finalizeSnapshot(2)).to.be.revertedWith("Need 2 mature seats");
  });
});
