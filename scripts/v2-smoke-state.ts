export const SMOKE_ROUND_ID = 1n;
export const SMOKE_WITHDRAWAL_REQUEST_ID = 1n;

export type DrawResumeAction = "SNAPSHOT" | "BLIND_DRAW" | "FINALIZE_WINNER" | "PRIZE";
export type PrizeResumeAction = "PROCESS" | "COMPLETE";
export type WithdrawalResumeAction = "CREATE" | "RESUME";
export type WithdrawalBatchResumeAction =
  | "WAIT_FOR_MATURITY"
  | "PUBLIC_CALLBACK"
  | "RESOLVE"
  | "SETTLE"
  | "RESOLVE_CANCELED"
  | "RETRY_FUND";
export type DemoPositionStage = "FRESH" | "QUEUED" | "PAID";

export function drawResumeAction(drawState: number, nextRoundId: bigint): DrawResumeAction {
  switch (drawState) {
    case 0:
      if (nextRoundId !== SMOKE_ROUND_ID) {
        throw new Error(
          "Smoke round 1 is missing while the pool has already advanced; refusing to create another round",
        );
      }
      return "SNAPSHOT";
    case 1:
      return "BLIND_DRAW";
    case 2:
      return "FINALIZE_WINNER";
    case 3:
      return "PRIZE";
    case 4:
    case 5:
      throw new Error(
        `Smoke round 1 is ${drawState === 4 ? "CANCELLED" : "SKIPPED"}; no prize winner can be delivered`,
      );
    default:
      throw new Error(`Smoke round 1 has unknown draw state ${drawState}`);
  }
}

export function prizeResumeAction(pointer: bigint, processed: boolean): PrizeResumeAction {
  if (pointer < SMOKE_ROUND_ID) {
    throw new Error(`Prize pointer is blocked at earlier round ${pointer}; process FIFO before rerunning`);
  }
  if (pointer === SMOKE_ROUND_ID) {
    if (processed) throw new Error("Prize status says round 1 is processed while the FIFO pointer is still 1");
    return "PROCESS";
  }
  if (!processed) throw new Error("Prize pointer advanced without a processed prize");
  return "COMPLETE";
}

export function withdrawalResumeAction(requestExists: boolean, nextRequestId: bigint): WithdrawalResumeAction {
  if (requestExists) return "RESUME";
  if (nextRequestId !== SMOKE_WITHDRAWAL_REQUEST_ID) {
    throw new Error("Withdrawal request 1 is missing while the manager has already advanced; refusing request 2");
  }
  return "CREATE";
}

export function withdrawalBatchResumeAction(state: number, resolved: boolean): WithdrawalBatchResumeAction {
  switch (state) {
    case 0:
      return "WAIT_FOR_MATURITY";
    case 1:
      return "PUBLIC_CALLBACK";
    case 2:
      return resolved ? "SETTLE" : "RESOLVE";
    case 3:
      return resolved ? "RETRY_FUND" : "RESOLVE_CANCELED";
    default:
      throw new Error(`Unknown withdrawal batch state ${state}`);
  }
}

export function demoPositionStage(active: bigint, reserved: bigint): DemoPositionStage {
  if (active === 100n && reserved === 0n) return "FRESH";
  if (active === 0n && reserved === 100n) return "QUEUED";
  if (active === 0n && reserved === 0n) return "PAID";
  throw new Error(`Unexpected demo private position active=${active} reserved=${reserved}`);
}
