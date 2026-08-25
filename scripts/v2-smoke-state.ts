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
export type ManagerDepositResumeAction =
  | "INVEST"
  | "WAIT_AND_DISPATCH"
  | "PUBLIC_CALLBACK"
  | "RESOLVE_FINALIZED"
  | "RESOLVE_CANCELED"
  | "RETRY_CANCELED"
  | "COMPLETE";

export type ManagerDepositBatch = {
  batchId: bigint;
  state: number;
  resolved: boolean;
  current: boolean;
};

type ManagerDepositBatchReader = {
  managerDepositBatch(batchId: bigint): Promise<boolean>;
  managerDepositBatchResolved(batchId: bigint): Promise<boolean>;
};

type DepositBatchStateReader = {
  currentBatchId(): Promise<bigint>;
  batchState(batchId: bigint): Promise<bigint>;
};

const MAX_MANAGER_DEPOSIT_BATCH_SCAN = 64n;

export async function findManagerDepositBatchToResume(
  manager: ManagerDepositBatchReader,
  batcher: DepositBatchStateReader,
): Promise<ManagerDepositBatch | undefined> {
  const currentBatchId = await batcher.currentBatchId();
  if (currentBatchId > MAX_MANAGER_DEPOSIT_BATCH_SCAN) {
    throw new Error(
      `Current deposit batch ${currentBatchId} exceeds the bounded smoke scan limit ${MAX_MANAGER_DEPOSIT_BATCH_SCAN}`,
    );
  }

  let latestRecognized: ManagerDepositBatch | undefined;
  let unresolved: ManagerDepositBatch | undefined;
  for (let batchId = currentBatchId; batchId >= 1n; batchId--) {
    if (await manager.managerDepositBatch(batchId)) {
      const candidate = {
        batchId,
        state: Number(await batcher.batchState(batchId)),
        resolved: await manager.managerDepositBatchResolved(batchId),
        current: batchId === currentBatchId,
      };
      latestRecognized ??= candidate;
      if (!candidate.resolved) {
        if (unresolved) {
          throw new Error(
            `Multiple unresolved manager deposit batches found: ${batchId} and ${unresolved.batchId}; manual review required`,
          );
        }
        unresolved = candidate;
      }
    }
    if (batchId === 1n) break;
  }
  return unresolved ?? latestRecognized;
}

export function managerDepositResumeAction(batch: ManagerDepositBatch | undefined): ManagerDepositResumeAction {
  if (!batch) return "INVEST";
  if (!batch.resolved) {
    if (batch.state === 0) {
      if (!batch.current) {
        throw new Error(`Manager deposit batch ${batch.batchId} is Pending after the batcher advanced`);
      }
      return "WAIT_AND_DISPATCH";
    }
    if (batch.state === 1) return "PUBLIC_CALLBACK";
    if (batch.state === 2) return "RESOLVE_FINALIZED";
    if (batch.state === 3) return "RESOLVE_CANCELED";
    throw new Error(`Manager deposit batch ${batch.batchId} has unknown state ${batch.state}`);
  }
  if (batch.state === 2) return "COMPLETE";
  if (batch.state === 3) return "RETRY_CANCELED";
  throw new Error(`Resolved manager deposit batch ${batch.batchId} has nonterminal state ${batch.state}`);
}

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
