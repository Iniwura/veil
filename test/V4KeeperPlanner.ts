import { expect } from "chai";

import {
  estimateShardedSnapshotBatchHcu,
  planShardedSnapshotBatches,
  shardedRoundTransactionCount,
} from "../scripts/sharded-snapshot-hcu-budget";

describe("V4 keeper snapshot planner", function () {
  it("fuses two mature savers into one snapshot transaction", function () {
    const plan = planShardedSnapshotBatches([
      { shard: 3, participants: 1 },
      { shard: 17, participants: 1 },
    ]);
    expect(plan).to.have.length(1);
    expect(plan[0].shards).to.deep.equal([3, 17]);
    expect(plan[0].estimate.includesBegin).to.equal(true);
    expect(
      shardedRoundTransactionCount([
        { shard: 3, participants: 1 },
        { shard: 17, participants: 1 },
      ]),
    ).to.equal(14);
    expect(shardedRoundTransactionCount([{ shard: 3, participants: 2 }])).to.equal(14);
  });

  it("fits all 24 sparse one-seat shards into the begin-and-complete fusion", function () {
    const widths = Array.from({ length: 24 }, (_, shard) => ({ shard, participants: 1 }));
    const plan = planShardedSnapshotBatches(widths);
    expect(plan).to.have.length(1);
    expect(plan[0].shards).to.deep.equal(Array.from({ length: 24 }, (_, shard) => shard));
    expect(plan[0].estimate.withinPublishedLimits).to.equal(true);
    expect(shardedRoundTransactionCount(widths)).to.equal(14);
  });

  it("packs a full 576-seat round into twelve two-shard transactions", function () {
    const widths = Array.from({ length: 24 }, (_, shard) => ({ shard, participants: 24 }));
    const plan = planShardedSnapshotBatches(widths);
    expect(plan).to.have.length(12);
    expect(plan.every((batch) => batch.shards.length === 2)).to.equal(true);
    expect(plan.every((batch) => batch.estimate.withinPublishedLimits)).to.equal(true);
    expect(plan[0].estimate.includesBegin).to.equal(true);
    expect(plan.slice(1).every((batch) => batch.estimate.includesBegin === false)).to.equal(true);
    expect(shardedRoundTransactionCount(widths)).to.equal(25);
    expect(estimateShardedSnapshotBatchHcu([24, 24], true).withinPublishedLimits).to.equal(true);
    expect(estimateShardedSnapshotBatchHcu([24, 24, 24], false).withinTransactionLimit).to.equal(false);
  });
});
