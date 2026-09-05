import { expect } from "chai";

import {
  SMOKE_ROUND_ID,
  SMOKE_WITHDRAWAL_REQUEST_ID,
  demoPositionStage,
  drawResumeAction,
  managerDepositResumeAction,
  prizeResumeAction,
  withdrawalBatchResumeAction,
  withdrawalResumeAction,
} from "../scripts/v2-smoke-state";

describe("UNVEIL V2 smoke resumability", function () {
  it("keeps the canonical round identity and never creates a later round on resume", function () {
    expect(SMOKE_ROUND_ID).to.equal(1n);
    expect(drawResumeAction(0, 1n)).to.equal("SNAPSHOT");
    expect(drawResumeAction(1, 2n)).to.equal("BLIND_DRAW");
    expect(drawResumeAction(2, 2n)).to.equal("FINALIZE_WINNER");
    expect(drawResumeAction(3, 2n)).to.equal("PRIZE");
    expect(() => drawResumeAction(0, 2n)).to.throw("refusing to create another round");
    expect(() => drawResumeAction(4, 2n)).to.throw("CANCELLED");
    expect(() => drawResumeAction(5, 2n)).to.throw("SKIPPED");
  });

  it("processes prize round 1 once and rejects pointer/status inconsistencies", function () {
    expect(prizeResumeAction(1n, false)).to.equal("PROCESS");
    expect(prizeResumeAction(2n, true)).to.equal("COMPLETE");
    expect(() => prizeResumeAction(1n, true)).to.throw("pointer is still 1");
    expect(() => prizeResumeAction(2n, false)).to.throw("processed prize");
    expect(() => prizeResumeAction(0n, false)).to.throw("blocked at earlier round");
  });

  it("creates only request 1 on a fresh stack and resumes it thereafter", function () {
    expect(SMOKE_WITHDRAWAL_REQUEST_ID).to.equal(1n);
    expect(withdrawalResumeAction(false, 1n)).to.equal("CREATE");
    expect(withdrawalResumeAction(true, 2n)).to.equal("RESUME");
    expect(() => withdrawalResumeAction(false, 2n)).to.throw("refusing request 2");
  });

  it("maps pending, dispatched, finalized, and canceled batches to non-duplicating actions", function () {
    expect(withdrawalBatchResumeAction(0, false)).to.equal("WAIT_FOR_MATURITY");
    expect(withdrawalBatchResumeAction(1, false)).to.equal("PUBLIC_CALLBACK");
    expect(withdrawalBatchResumeAction(2, false)).to.equal("RESOLVE");
    expect(withdrawalBatchResumeAction(2, true)).to.equal("SETTLE");
    expect(withdrawalBatchResumeAction(3, false)).to.equal("RESOLVE_CANCELED");
    expect(withdrawalBatchResumeAction(3, true)).to.equal("RETRY_FUND");
  });

  it("fails clearly when an old manager deposit batch remains Pending after advancement", function () {
    expect(managerDepositResumeAction({ batchId: 1n, state: 0, resolved: false, current: true })).to.equal(
      "WAIT_AND_DISPATCH",
    );
    expect(() => managerDepositResumeAction({ batchId: 1n, state: 0, resolved: false, current: false })).to.throw(
      "Pending after the batcher advanced",
    );
    expect(managerDepositResumeAction({ batchId: 1n, state: 2, resolved: true, current: false })).to.equal("COMPLETE");
    expect(managerDepositResumeAction({ batchId: 1n, state: 3, resolved: true, current: false })).to.equal(
      "RETRY_CANCELED",
    );
  });

  it("recognizes fresh, queued, and paid private position stages without aggregate plaintext", function () {
    expect(demoPositionStage(100n, 0n)).to.equal("FRESH");
    expect(demoPositionStage(0n, 100n)).to.equal("QUEUED");
    expect(demoPositionStage(0n, 0n)).to.equal("PAID");
    expect(() => demoPositionStage(100n, 100n)).to.throw("Unexpected demo private position");
  });
});
