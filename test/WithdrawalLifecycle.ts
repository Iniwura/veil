import { expect } from "chai";

import {
  canCancelWithdrawal,
  canSubmitWithdrawalAction,
  deriveWithdrawalLifecycle,
  type WithdrawalLifecycleState,
} from "../shared/withdrawalLifecycle";

const baseState: WithdrawalLifecycleState = {
  requestId: 7n,
  exists: true,
  canceled: false,
  settled: false,
  classified: false,
  queued: false,
  committed: false,
  queueSequence: 0n,
  createdWithdrawalBatchId: 2n,
  createdWithdrawalFundingNonce: 0n,
  completed: true,
  completionProofAvailable: true,
  currentBatchId: 2n,
  currentBatchOpenedAt: 100n,
  minimumBatchAge: 10n,
  now: 200n,
  lastManagerWithdrawalBatchId: 0n,
  lastManagerBatchFundingNonce: 1n,
  lastManagerBatchRecognized: false,
  lastManagerBatchResolved: false,
  fifoHeadSequence: 1n,
  fifoHeadRequestId: 0n,
  fifoHeadCanceled: false,
};

function state(overrides: Partial<WithdrawalLifecycleState> = {}): WithdrawalLifecycleState {
  return { ...baseState, ...overrides };
}

describe("UNVEIL confidential withdrawal lifecycle derivation", function () {
  it("takes an instant request from verification to settled without a strategy batch", function () {
    expect(deriveWithdrawalLifecycle(state()).kind).to.equal("CLASSIFY");
    expect(
      deriveWithdrawalLifecycle(state({ classified: true, settled: true, queueSequence: 0n, completed: true })).kind,
    ).to.equal("SETTLED");
  });

  it("classifies an unpaid request into the queued path", function () {
    expect(deriveWithdrawalLifecycle(state({ completed: false })).kind).to.equal("CLASSIFY");
    expect(deriveWithdrawalLifecycle(state({ classified: true, queued: true, completed: false })).kind).to.equal(
      "FUND_LIQUIDITY",
    );
  });

  it("derives each queued funding, route, settlement, and finalization step", function () {
    const queued = { classified: true, queued: true, completed: false };
    expect(deriveWithdrawalLifecycle(state(queued)).kind).to.equal("FUND_LIQUIDITY");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: false,
          lastManagerBatchState: 0,
          now: 109n,
        }),
      ).kind,
    ).to.equal("WAIT_BATCH_AGE");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: false,
          lastManagerBatchState: 0,
          now: 110n,
        }),
      ).kind,
    ).to.equal("DISPATCH_BATCH");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: false,
          lastManagerBatchState: 1,
        }),
      ).kind,
    ).to.equal("PROVE_BATCH");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: false,
          lastManagerBatchState: 2,
        }),
      ).kind,
    ).to.equal("RESOLVE_BATCH");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          committed: true,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: true,
          lastManagerBatchState: 2,
          queueSequence: 1n,
          fifoHeadSequence: 1n,
          fifoHeadRequestId: 7n,
        }),
      ).kind,
    ).to.equal("SETTLE");
    expect(
      deriveWithdrawalLifecycle(
        state({
          ...queued,
          committed: true,
          completed: true,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: true,
          lastManagerBatchState: 2,
          queueSequence: 1n,
          fifoHeadSequence: 1n,
          fifoHeadRequestId: 7n,
        }),
      ).kind,
    ).to.equal("FINALIZE");
    expect(deriveWithdrawalLifecycle(state({ settled: true })).kind).to.equal("SETTLED");
  });

  it("leaves an incompletely settled request open for another valid cycle", function () {
    expect(
      deriveWithdrawalLifecycle(
        state({
          classified: true,
          queued: true,
          committed: true,
          completed: false,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: true,
          lastManagerBatchState: 2,
          queueSequence: 1n,
          fifoHeadSequence: 1n,
          fifoHeadRequestId: 7n,
        }),
      ).kind,
    ).to.equal("SETTLE");
  });

  it("allows cancellation only for an open uncommitted request", function () {
    expect(canCancelWithdrawal(state())).to.equal(true);
    expect(canCancelWithdrawal(state({ committed: true }))).to.equal(false);
    expect(canCancelWithdrawal(state({ settled: true }))).to.equal(false);
    expect(deriveWithdrawalLifecycle(state()).kind).to.equal("CLASSIFY");
  });

  it("never exposes a later FIFO request as settleable ahead of the head", function () {
    const later = state({
      classified: true,
      queued: true,
      committed: true,
      lastManagerWithdrawalBatchId: 2n,
      lastManagerBatchRecognized: true,
      lastManagerBatchResolved: true,
      lastManagerBatchState: 2,
      queueSequence: 2n,
      fifoHeadSequence: 1n,
      fifoHeadRequestId: 1n,
      fifoHeadCanceled: false,
    });
    expect(deriveWithdrawalLifecycle(later).kind).to.equal("WAIT_FIFO_HEAD");
    expect(deriveWithdrawalLifecycle({ ...later, fifoHeadCanceled: true }).kind).to.equal("ADVANCE_CANCELED_HEAD");
  });

  it("blocks proof-dependent actions when KMS is unavailable", function () {
    expect(deriveWithdrawalLifecycle(state({ completionProofAvailable: false })).kind).to.equal("BLOCKED");
    expect(
      deriveWithdrawalLifecycle(
        state({
          classified: true,
          queued: true,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: false,
          lastManagerBatchState: 1,
          batchProofAvailable: false,
        }),
      ).kind,
    ).to.equal("BLOCKED");
    expect(
      deriveWithdrawalLifecycle(
        state({
          classified: true,
          queued: true,
          completed: true,
          completionProofAvailable: false,
          committed: true,
          lastManagerWithdrawalBatchId: 2n,
          lastManagerBatchRecognized: true,
          lastManagerBatchResolved: true,
          lastManagerBatchState: 2,
          queueSequence: 1n,
          fifoHeadSequence: 1n,
          fifoHeadRequestId: 7n,
        }),
      ).kind,
    ).to.equal("BLOCKED");
  });

  it("gates all withdrawal writes on a connected Sepolia session", function () {
    const action = deriveWithdrawalLifecycle(state());
    expect(canSubmitWithdrawalAction(action, "connected")).to.equal(true);
    expect(canSubmitWithdrawalAction(action, "wrong-network")).to.equal(false);
    expect(canSubmitWithdrawalAction(action, "disconnected")).to.equal(false);
    expect(canSubmitWithdrawalAction(action, "reconnect-required")).to.equal(false);
  });

  it("returns conservative terminal and empty states", function () {
    expect(deriveWithdrawalLifecycle(state({ exists: false })).kind).to.equal("NONE");
    expect(deriveWithdrawalLifecycle(state({ canceled: true })).kind).to.equal("CANCELED");
    expect(deriveWithdrawalLifecycle(state({ settled: true })).actionable).to.equal(false);
  });
});
