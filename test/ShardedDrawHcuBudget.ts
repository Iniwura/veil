import { expect } from "chai";

import { ZAMA_HCU_LIMITS } from "../scripts/draw-hcu-budget";
import {
  V4_ACTIVE_SAVER_CAPACITY,
  V4_SHARD_COUNT,
  V4_SHARD_SIZE,
  estimateTwoStageShardedDrawHcu,
} from "../scripts/sharded-draw-hcu-budget";

describe("Sharded BlindDraw HCU budget", function () {
  it("expands the active draw roster to 576 savers without enlarging one FHE scan", function () {
    expect(V4_SHARD_COUNT).to.equal(24);
    expect(V4_SHARD_SIZE).to.equal(24);
    expect(V4_ACTIVE_SAVER_CAPACITY).to.equal(576);
  });

  it("keeps both winner-selection stages within the published HCU limits", function () {
    const estimate = estimateTwoStageShardedDrawHcu();

    expect(estimate.shardSelection.participants).to.equal(24);
    expect(estimate.memberSelection.participants).to.equal(24);
    expect(estimate.withinPublishedLimits).to.equal(true);
    expect(estimate.maximumTransactionHcu).to.be.lessThan(ZAMA_HCU_LIMITS.transaction);
    expect(estimate.maximumDepthHcu).to.be.lessThan(ZAMA_HCU_LIMITS.depth);
    expect(estimate.transactionHeadroom).to.be.greaterThan(7_000_000);
    expect(estimate.depthHeadroom).to.be.greaterThan(800_000);
  });

  it("does not model 576 savers as one sequential encrypted scan", function () {
    expect(() => estimateTwoStageShardedDrawHcu(576, 24)).to.throw(
      "participants must be an integer between 1 and 255",
    );
  });
});
