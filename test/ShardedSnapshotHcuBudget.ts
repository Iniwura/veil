import { expect } from "chai";

import { ZAMA_HCU_LIMITS } from "../scripts/draw-hcu-budget";
import { estimateShardedSnapshotBatchHcu, SNAPSHOT_BATCH_LIMITS } from "../scripts/sharded-snapshot-hcu-budget";

describe("Sharded snapshot HCU budget", function () {
  it("keeps two full 24-seat shards below both published limits", function () {
    const estimate = estimateShardedSnapshotBatchHcu([24, 24]);

    expect(estimate.totalParticipants).to.equal(48);
    expect(estimate.withinPublishedLimits).to.equal(true);
    expect(estimate.transactionHcu).to.equal(18_615_136);
    expect(estimate.depthHcu).to.equal(4_431_064);
    expect(estimate.transactionHcu).to.be.lessThan(ZAMA_HCU_LIMITS.transaction);
    expect(estimate.depthHcu).to.be.lessThan(ZAMA_HCU_LIMITS.depth);
  });

  it("charges the begin-plus-batch fusion without changing the safe boundary", function () {
    const estimate = estimateShardedSnapshotBatchHcu([24, 24], true);

    expect(estimate.includesBegin).to.equal(true);
    expect(estimate.transactionHcu).to.equal(18_615_168);
    expect(estimate.depthHcu).to.equal(4_431_096);
    expect(estimate.withinPublishedLimits).to.equal(true);
  });

  it("rejects three full shards because the transaction HCU budget is exceeded", function () {
    const estimate = estimateShardedSnapshotBatchHcu([24, 24, 24]);

    expect(estimate.withinTransactionLimit).to.equal(false);
    expect(estimate.withinDepthLimit).to.equal(true);
  });

  it("allows the measured sparse maximum of 24 one-seat shards", function () {
    const estimate = estimateShardedSnapshotBatchHcu(Array(SNAPSHOT_BATCH_LIMITS.maxShards).fill(1));

    expect(estimate.totalParticipants).to.equal(24);
    expect(estimate.withinPublishedLimits).to.equal(true);
  });

  it("allows 51 partial-shard participant operations but not 52", function () {
    const maximum = estimateShardedSnapshotBatchHcu([17, 17, 17]);
    const oneBeyond = estimateShardedSnapshotBatchHcu([18, 17, 17]);

    expect(maximum.totalParticipants).to.equal(51);
    expect(maximum.withinPublishedLimits).to.equal(true);
    expect(oneBeyond.totalParticipants).to.equal(52);
    expect(oneBeyond.withinTransactionLimit).to.equal(false);
  });

  it("rejects a depth-unsafe mixed batch even when its global HCU is below 20M", function () {
    const estimate = estimateShardedSnapshotBatchHcu([24, ...Array(5).fill(1)]);

    expect(estimate.withinTransactionLimit).to.equal(true);
    expect(estimate.withinDepthLimit).to.equal(false);
  });
});
