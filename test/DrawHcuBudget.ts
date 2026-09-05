import { expect } from "chai";

import {
  V3_MAX_PLAYERS,
  ZAMA_HCU_LIMITS,
  estimateBlindDrawHcu,
  maximumParticipantsWithinPublishedDepthLimit,
} from "../scripts/draw-hcu-budget";

describe("BlindDraw HCU budget", function () {
  it("shows the V2 32-seat scan exceeds the published sequential depth limit", function () {
    const estimate = estimateBlindDrawHcu(32);

    expect(estimate.transactionHcu).to.be.lessThan(ZAMA_HCU_LIMITS.transaction);
    expect(estimate.depthHcu).to.be.greaterThan(ZAMA_HCU_LIMITS.depth);
    expect(estimate.withinTransactionLimit).to.equal(true);
    expect(estimate.withinDepthLimit).to.equal(false);
  });

  it("finds 29 seats as the theoretical maximum under the published depth table", function () {
    expect(maximumParticipantsWithinPublishedDepthLimit()).to.equal(29);
  });

  it("keeps the V3 roster at 24 seats with meaningful HCU headroom", function () {
    const estimate = estimateBlindDrawHcu(V3_MAX_PLAYERS);

    expect(V3_MAX_PLAYERS).to.equal(24);
    expect(estimate.withinTransactionLimit).to.equal(true);
    expect(estimate.withinDepthLimit).to.equal(true);
    expect(estimate.depthHeadroom).to.be.greaterThan(800_000);
    expect(estimate.transactionHeadroom).to.be.greaterThan(7_000_000);
  });
});
