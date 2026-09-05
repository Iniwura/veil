export const PRIZE_REDEMPTION_BATCH_STATES = {
  PENDING: 0,
  DISPATCHED: 1,
  FINALIZED: 2,
  CANCELED: 3,
} as const;

export type PrizeRedemptionDepositStatus =
  | "NONE"
  | "JOINED_ACTIVE"
  | "CLAIMABLE"
  | "REFUNDABLE"
  | "CLAIMED_COMPLETE"
  | "REFUNDED_COMPLETE";

export type PrizeRedemptionStatus =
  | "READY"
  | "WAITING_FOR_BATCH"
  | "JOINED"
  | "DISPATCHED"
  | "ROUTE_READY"
  | "CLAIMABLE"
  | "COMPLETE"
  | "CANCELED"
  | "BLOCKED";

export type PrizeRedemptionActionKind = "NONE" | "DISPATCH" | "PROVE" | "CLAIM" | "REFUND";

export type PrizeRedemptionAction = {
  kind: PrizeRedemptionActionKind;
  title: string;
  description: string;
  actionable: boolean;
};

export function prizeRedemptionActionInvalidatesPrivateBalances(kind: PrizeRedemptionActionKind) {
  return kind === "DISPATCH" || kind === "PROVE" || kind === "CLAIM" || kind === "REFUND";
}

export type PrizeRedemptionInput = {
  batchId: bigint;
  batchState: number;
  currentBatchId: bigint;
  currentBatchOpenedAt: bigint;
  minimumBatchAge: bigint;
  now: bigint;
  depositedHandle: string;
  exchangeRate: bigint;
  account: string;
  /** Authoritative event-derived status when an encrypted zero is ambiguous. */
  depositStatus?: PrizeRedemptionDepositStatus;
};

export type PrizeRedemptionRecoveryState = {
  transactionHash: string;
  account: string;
  message: string;
};

export function prizeRedemptionSubmissionBlocked(recovery?: PrizeRedemptionRecoveryState) {
  return Boolean(recovery);
}

export type PrizeRedemptionState = {
  batchId: bigint;
  account: string;
  batchState: number;
  currentBatchId: bigint;
  currentBatchOpenedAt: bigint;
  minimumBatchAge: bigint;
  batchMaturesAt: bigint;
  depositedHandle: string;
  hasDeposit: boolean;
  exchangeRate: bigint;
  claimable: boolean;
  action: PrizeRedemptionAction;
  status: PrizeRedemptionStatus;
  depositStatus: PrizeRedemptionDepositStatus;
};

export const ZERO_ENCRYPTED_HANDLE = `0x${"0".repeat(64)}`;

const NONE: PrizeRedemptionAction = {
  kind: "NONE",
  title: "NO ACTION",
  description: "The redemption route is waiting for its next permissionless step.",
  actionable: false,
};

function action(kind: PrizeRedemptionActionKind, title: string, description: string): PrizeRedemptionAction {
  return { kind, title, description, actionable: true };
}

export function validatePrizeRedemptionAmount(amount: bigint) {
  if (amount <= 0n) throw new Error("Enter a valid whole-number prize amount.");
  return amount;
}

export function derivePrizeRedemptionState(input: PrizeRedemptionInput): PrizeRedemptionState {
  if (!Number.isInteger(input.batchState) || input.batchState < 0 || input.batchState > 3) {
    throw new Error("UNVEIL_PRIZE_REDEMPTION_STATE_UNEXPECTED: Unknown withdrawal batch state.");
  }

  const depositStatus = inferredDepositStatus(input);
  const hasDeposit =
    depositStatus === "JOINED_ACTIVE" || depositStatus === "CLAIMABLE" || depositStatus === "REFUNDABLE";
  const batchMaturesAt = input.currentBatchOpenedAt + input.minimumBatchAge;
  let status: PrizeRedemptionStatus;
  let nextAction = NONE;

  if (input.batchState === PRIZE_REDEMPTION_BATCH_STATES.PENDING) {
    if (!hasDeposit) {
      status = "READY";
    } else if (input.currentBatchId !== input.batchId) {
      status = "BLOCKED";
    } else if (input.now < batchMaturesAt) {
      status = "WAITING_FOR_BATCH";
    } else {
      status = "JOINED";
      nextAction = action(
        "DISPATCH",
        "DISPATCH BATCH",
        "The batch is mature and can be routed by the connected operator.",
      );
    }
  } else if (input.batchState === PRIZE_REDEMPTION_BATCH_STATES.DISPATCHED) {
    status = hasDeposit ? "DISPATCHED" : "BLOCKED";
    if (hasDeposit) {
      nextAction = action("PROVE", "VERIFY ROUTE", "Publish the KMS proof for the aggregate redemption route.");
    }
  } else if (input.batchState === PRIZE_REDEMPTION_BATCH_STATES.FINALIZED) {
    status = hasDeposit ? "CLAIMABLE" : "COMPLETE";
    if (hasDeposit) {
      nextAction = action(
        "CLAIM",
        "RECEIVE PRINCIPAL",
        "Claim the resulting confidential cUSDC principal into this wallet.",
      );
    }
  } else {
    status = hasDeposit ? "CANCELED" : "COMPLETE";
    if (hasDeposit) {
      nextAction = action("REFUND", "REFUND SHARES", "Return the pending confidential shares from the canceled batch.");
    }
  }

  return {
    batchId: input.batchId,
    account: input.account,
    batchState: input.batchState,
    currentBatchId: input.currentBatchId,
    currentBatchOpenedAt: input.currentBatchOpenedAt,
    minimumBatchAge: input.minimumBatchAge,
    batchMaturesAt,
    depositedHandle: input.depositedHandle,
    hasDeposit,
    exchangeRate: input.exchangeRate,
    claimable: input.batchState === PRIZE_REDEMPTION_BATCH_STATES.FINALIZED && hasDeposit,
    action: nextAction,
    status,
    depositStatus,
  };
}

function inferredDepositStatus(input: PrizeRedemptionInput): PrizeRedemptionDepositStatus {
  if (input.depositStatus) return input.depositStatus;
  const hasInitializedDeposit = input.depositedHandle.toLowerCase() !== ZERO_ENCRYPTED_HANDLE;
  if (!hasInitializedDeposit) return "NONE";
  if (input.batchState === PRIZE_REDEMPTION_BATCH_STATES.FINALIZED) return "CLAIMABLE";
  if (input.batchState === PRIZE_REDEMPTION_BATCH_STATES.CANCELED) return "REFUNDABLE";
  return "JOINED_ACTIVE";
}

export function selectLatestPrizeRedemptionState(
  states: readonly PrizeRedemptionState[],
): PrizeRedemptionState | undefined {
  if (!states.length) return undefined;
  const ordered = [...states].sort((left, right) =>
    left.batchId < right.batchId ? 1 : left.batchId > right.batchId ? -1 : 0,
  );
  return ordered.find((state) => state.status !== "COMPLETE") ?? ordered[0];
}
