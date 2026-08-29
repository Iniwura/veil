export const WITHDRAWAL_BATCH_STATES = {
  PENDING: 0,
  DISPATCHED: 1,
  FINALIZED: 2,
  CANCELED: 3,
} as const;

export const WITHDRAWAL_ACTION_KINDS = [
  "NONE",
  "CLASSIFY",
  "FUND_LIQUIDITY",
  "WAIT_BATCH_AGE",
  "DISPATCH_BATCH",
  "PROVE_BATCH",
  "RESOLVE_BATCH",
  "WAIT_FIFO_HEAD",
  "SETTLE",
  "FINALIZE",
  "ADVANCE_CANCELED_HEAD",
  "SETTLED",
  "CANCELED",
  "BLOCKED",
] as const;

export type WithdrawalActionKind = (typeof WITHDRAWAL_ACTION_KINDS)[number];

export type WithdrawalLifecycleAction = {
  kind: WithdrawalActionKind;
  requestId: bigint;
  batchId: bigint;
  title: string;
  description: string;
  actionable: boolean;
  proofRequired: "COMPLETION" | "BATCH" | undefined;
};

export type WithdrawalLifecycleState = {
  requestId: bigint;
  exists: boolean;
  canceled: boolean;
  settled: boolean;
  classified: boolean;
  queued: boolean;
  committed: boolean;
  queueSequence: bigint;
  createdWithdrawalBatchId: bigint;
  createdWithdrawalFundingNonce: bigint;
  completed?: boolean;
  completionProofAvailable?: boolean;
  currentBatchId: bigint;
  currentBatchOpenedAt: bigint;
  minimumBatchAge: bigint;
  now: bigint;
  lastManagerWithdrawalBatchId: bigint;
  lastManagerBatchFundingNonce: bigint;
  lastManagerBatchRecognized: boolean;
  lastManagerBatchResolved: boolean;
  lastManagerBatchState?: number;
  fifoHeadSequence: bigint;
  fifoHeadRequestId: bigint;
  fifoHeadCanceled: boolean;
  batchProofAvailable?: boolean;
};

function action(
  kind: WithdrawalActionKind,
  state: WithdrawalLifecycleState,
  title: string,
  description: string,
  actionable: boolean,
  proofRequired: "COMPLETION" | "BATCH" | undefined = undefined,
  batchId = 0n,
): WithdrawalLifecycleAction {
  return { kind, requestId: state.requestId, batchId, title, description, actionable, proofRequired };
}

function isQueueHead(state: WithdrawalLifecycleState) {
  return state.queueSequence === state.fifoHeadSequence && state.fifoHeadRequestId === state.requestId;
}

function batchProofBlocked(state: WithdrawalLifecycleState) {
  return state.batchProofAvailable === false;
}

function completionProofBlocked(state: WithdrawalLifecycleState) {
  return state.completionProofAvailable === false;
}

export function deriveWithdrawalLifecycle(state: WithdrawalLifecycleState): WithdrawalLifecycleAction {
  if (!state.exists) return action("NONE", state, "NO WITHDRAWAL", "No withdrawal request is available.", false);
  if (state.canceled) return action("CANCELED", state, "CANCELED", "This withdrawal request was canceled.", false);
  if (state.settled) return action("SETTLED", state, "SETTLED", "This withdrawal request is settled.", false);

  if (!state.classified) {
    if (completionProofBlocked(state)) {
      return action(
        "BLOCKED",
        state,
        "VERIFY REQUEST UNAVAILABLE",
        "The Zama completion proof is unavailable. The encrypted request remains open; retry verification later.",
        false,
      );
    }
    return action(
      "CLASSIFY",
      state,
      "VERIFY REQUEST",
      "Publicly verify only the encrypted completion predicate. No withdrawal amount is revealed.",
      true,
      "COMPLETION",
    );
  }

  if (!state.queued) {
    return action(
      "BLOCKED",
      state,
      "WITHDRAWAL STATE NEEDS REVIEW",
      "The public request state is inconsistent. No recovery transaction is available.",
      false,
    );
  }

  const managerBatchId = state.lastManagerWithdrawalBatchId;
  const managerBatchState = state.lastManagerBatchState;
  if (
    !state.lastManagerBatchRecognized ||
    managerBatchId === 0n ||
    state.lastManagerBatchFundingNonce <= state.createdWithdrawalFundingNonce
  ) {
    return action(
      "FUND_LIQUIDITY",
      state,
      "FUND LIQUIDITY",
      "Derive the required strategy liquidity from encrypted queue state and the live strategy balance.",
      true,
      undefined,
      state.currentBatchId,
    );
  }

  if (!state.lastManagerBatchResolved) {
    if (managerBatchState === WITHDRAWAL_BATCH_STATES.PENDING) {
      if (managerBatchId !== state.currentBatchId) {
        return action(
          "BLOCKED",
          state,
          "WITHDRAWAL BATCH NEEDS REVIEW",
          "A pending withdrawal batch is no longer the active batch. No safe recovery transaction is available.",
          false,
          undefined,
          managerBatchId,
        );
      }
      const maturesAt = state.currentBatchOpenedAt + state.minimumBatchAge;
      if (state.now < maturesAt) {
        return action(
          "WAIT_BATCH_AGE",
          state,
          "WAITING FOR BATCH AGE",
          "Strategy liquidity is staged. Dispatch becomes available when the configured batch age is reached.",
          false,
          undefined,
          managerBatchId,
        );
      }
      return action(
        "DISPATCH_BATCH",
        state,
        "DISPATCH BATCH",
        "Dispatch the mature strategy-liquidity batch for public route verification.",
        true,
        undefined,
        managerBatchId,
      );
    }
    if (managerBatchState === WITHDRAWAL_BATCH_STATES.DISPATCHED) {
      if (batchProofBlocked(state)) {
        return action(
          "BLOCKED",
          state,
          "KMS PROOF UNAVAILABLE",
          "The strategy route is awaiting a valid Zama/KMS public proof. No transaction was submitted.",
          false,
          undefined,
          managerBatchId,
        );
      }
      return action(
        "PROVE_BATCH",
        state,
        "VERIFY STRATEGY ROUTE",
        "Verify the encrypted aggregate route output with the required Zama/KMS proof.",
        true,
        "BATCH",
        managerBatchId,
      );
    }
    if (
      managerBatchState === WITHDRAWAL_BATCH_STATES.FINALIZED ||
      managerBatchState === WITHDRAWAL_BATCH_STATES.CANCELED
    ) {
      return action(
        "RESOLVE_BATCH",
        state,
        "RESOLVE LIQUIDITY",
        "Claim finalized strategy output or reclaim a canceled route into manager custody.",
        true,
        undefined,
        managerBatchId,
      );
    }
    return action(
      "BLOCKED",
      state,
      "WITHDRAWAL BATCH NEEDS REVIEW",
      "The public withdrawal-batch state is unknown. No recovery transaction is available.",
      false,
      undefined,
      managerBatchId,
    );
  }

  if (managerBatchState === WITHDRAWAL_BATCH_STATES.CANCELED) {
    return action(
      "FUND_LIQUIDITY",
      state,
      "FUND LIQUIDITY",
      "The previous strategy route was canceled. Derive and stage the next bounded liquidity attempt.",
      true,
      undefined,
      state.currentBatchId,
    );
  }
  if (managerBatchState !== WITHDRAWAL_BATCH_STATES.FINALIZED) {
    return action(
      "BLOCKED",
      state,
      "WITHDRAWAL BATCH NEEDS REVIEW",
      "The resolved withdrawal batch does not have a terminal public state.",
      false,
      undefined,
      managerBatchId,
    );
  }

  if (!isQueueHead(state)) {
    if (state.fifoHeadRequestId !== 0n && state.fifoHeadCanceled) {
      return action(
        "ADVANCE_CANCELED_HEAD",
        state,
        "ADVANCE QUEUE",
        "The FIFO head is canceled. Advance that public queue slot before settling a later request.",
        true,
      );
    }
    return action(
      "WAIT_FIFO_HEAD",
      state,
      "WAITING FOR FIFO HEAD",
      "This request cannot settle ahead of the earlier classified withdrawal at the FIFO head.",
      false,
    );
  }

  if (state.completed === true) {
    if (completionProofBlocked(state)) {
      return action(
        "BLOCKED",
        state,
        "SETTLEMENT PROOF UNAVAILABLE",
        "The final encrypted completion proof is unavailable. No transaction was submitted.",
        false,
      );
    }
    return action(
      "FINALIZE",
      state,
      "FINALIZE SETTLEMENT",
      "Finalize the completed encrypted settlement and advance the FIFO head.",
      true,
      "COMPLETION",
      managerBatchId,
    );
  }

  return action(
    "SETTLE",
    state,
    "SETTLE WITHDRAWAL",
    "Attempt the encrypted FIFO-head payout without selecting or revealing an amount.",
    true,
    undefined,
    managerBatchId,
  );
}

export function sameWithdrawalAction(left: WithdrawalLifecycleAction, right: WithdrawalLifecycleAction) {
  return left.kind === right.kind && left.requestId === right.requestId && left.batchId === right.batchId;
}

export function canCancelWithdrawal(state: WithdrawalLifecycleState) {
  return state.exists && !state.canceled && !state.settled && !state.committed;
}

export function canSubmitWithdrawalAction(
  action: WithdrawalLifecycleAction,
  walletState: "connected" | "disconnected" | "wrong-network" | "reconnect-required" | "account-changed",
) {
  return walletState === "connected" && action.actionable;
}
