import { Contract, type JsonRpcSigner, type TransactionReceipt } from "ethers";
import { UNVEIL_CONTRACTS } from "./contracts";
import { ensureSepolia, createEncryptedInputFor, publicDecryptHandle } from "./veilClient";
import { waitForSubmittedTransaction } from "../../shared/transactionSafety";
import {
  derivePrizeRedemptionState,
  PRIZE_REDEMPTION_BATCH_STATES,
  validatePrizeRedemptionAmount,
  selectLatestPrizeRedemptionState,
  type PrizeRedemptionDepositStatus,
  type PrizeRedemptionRecoveryState,
  type PrizeRedemptionState,
} from "../../shared/prizeRedemptionLifecycle";
import {
  classifyPrizeRedemptionBatchActivity,
  decodePrizeRedemptionEvent,
  PRIZE_REDEMPTION_BATCH_UNKNOWN,
  selectUniqueJoinedBatchId,
  type NormalizedPrizeRedemptionEvent,
} from "../../shared/prizeRedemptionReceipts";
import { queryLogsInChunks } from "../../shared/chunkedLogs";
import { sepoliaReadProvider } from "./lib/sepoliaReadProvider";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const DEFAULT_REDEMPTION_DISCOVERY_FROM_BLOCK = 11_625_092;
const MAX_REDEMPTION_DISCOVERY_LOOKBACK = 50_000;

export type PrizeRedemptionRecovery = PrizeRedemptionRecoveryState;

export function isPrizeRedemptionBatchUnknown(error: unknown): error is Error & { transactionHash?: string } {
  return error instanceof Error && error.message.startsWith(PRIZE_REDEMPTION_BATCH_UNKNOWN);
}

const SHARES_ABI = [
  "function underlying() view returns (address)",
  "function confidentialTransferAndCall(address to,bytes32 encryptedAmount,bytes inputProof,bytes data) returns (bytes32)",
  "function unwrapAmount(bytes32 requestId) view returns (bytes32)",
] as const;

const PRINCIPAL_ABI = ["function underlying() view returns (address)"] as const;

const BATCHER_ABI = [
  "function fromToken() view returns (address)",
  "function toToken() view returns (address)",
  "function vault() view returns (address)",
  "function currentBatchId() view returns (uint256)",
  "function currentBatchOpenedAt() view returns (uint64)",
  "function minimumBatchAge() view returns (uint64)",
  "function batchState(uint256) view returns (uint8)",
  "function deposits(uint256,address) view returns (bytes32)",
  "function exchangeRate(uint256) view returns (uint64)",
  "function unwrapRequestId(uint256) view returns (bytes32)",
  "function dispatchBatch()",
  "function dispatchBatchCallback(uint256,uint64,bytes)",
  "function claim(uint256,address)",
  "function quit(uint256)",
  "event Joined(uint256 indexed batchId,address indexed account,bytes32 amount)",
  "event Claimed(uint256 indexed batchId,address indexed account,bytes32 amount)",
  "event Quit(uint256 indexed batchId,address indexed account,bytes32 amount)",
] as const;

type Step = (message: string) => void;

function actionError(prefix: string, error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : "";
  if (code === 4001 || message.toLowerCase().includes("user rejected")) throw error;
  if (
    message.startsWith("UNVEIL_PRIZE_REDEMPTION_ROUTE_INVALID:") ||
    message.startsWith("UNVEIL_PRIZE_REDEMPTION_STATE_CHANGED:") ||
    message.startsWith(PRIZE_REDEMPTION_BATCH_UNKNOWN)
  )
    throw error;
  throw new Error(`${prefix}${message ? ` ${message}` : ""}`);
}

function readBatcher() {
  return new Contract(UNVEIL_CONTRACTS.withdrawalBatcher, BATCHER_ABI, sepoliaReadProvider);
}

type RedemptionDiscoveryBatcher = {
  filters: {
    Joined: (batchId?: bigint | string | null, account?: string | null) => unknown;
    Claimed: (batchId?: bigint | string | null, account?: string | null) => unknown;
    Quit: (batchId?: bigint | string | null, account?: string | null) => unknown;
  };
  queryFilter: (filter: unknown, fromBlock: number, toBlock: number) => Promise<readonly unknown[]>;
  batchState: (batchId: bigint) => Promise<bigint | number>;
};

type RedemptionDiscoveryReader = {
  getBlockNumber: () => Promise<number>;
};

export type PrizeRedemptionDiscoveryOptions = {
  fromBlock?: number;
  latestBlock?: number;
  batcher?: RedemptionDiscoveryBatcher;
  reader?: RedemptionDiscoveryReader;
  readState?: (
    batchId: bigint,
    account: string,
    depositStatus?: PrizeRedemptionDepositStatus,
  ) => Promise<PrizeRedemptionState>;
};

function discoveryFromBlock(latestBlock: number, configured?: number) {
  if (configured !== undefined) return configured;
  return Math.max(DEFAULT_REDEMPTION_DISCOVERY_FROM_BLOCK, latestBlock - MAX_REDEMPTION_DISCOVERY_LOOKBACK + 1);
}

function eventKey(event: NormalizedPrizeRedemptionEvent) {
  return `${event.transactionHash ?? ""}:${event.logIndex ?? ""}:${event.kind}:${event.batchId.toString()}`;
}

async function readRedemptionEvents(
  account: string,
  batcher: RedemptionDiscoveryBatcher,
  fromBlock: number,
  latestBlock: number,
) {
  const [joined, claimed, quit] = await Promise.all([
    queryLogsInChunks(
      (from, to) => batcher.queryFilter(batcher.filters.Joined(null, account), from, to).then((logs) => [...logs]),
      fromBlock,
      latestBlock,
    ),
    queryLogsInChunks(
      (from, to) => batcher.queryFilter(batcher.filters.Claimed(null, account), from, to).then((logs) => [...logs]),
      fromBlock,
      latestBlock,
    ),
    queryLogsInChunks(
      (from, to) => batcher.queryFilter(batcher.filters.Quit(null, account), from, to).then((logs) => [...logs]),
      fromBlock,
      latestBlock,
    ),
  ]);
  const unique = new Map<string, NormalizedPrizeRedemptionEvent>();
  for (const log of [...joined, ...claimed, ...quit]) {
    const event = decodePrizeRedemptionEvent(log, UNVEIL_CONTRACTS.withdrawalBatcher);
    if (event && event.account.toLowerCase() === account.toLowerCase()) unique.set(eventKey(event), event);
  }
  return [...unique.values()];
}

function statusForBatchActivity(
  batchState: number,
  activity: ReturnType<typeof classifyPrizeRedemptionBatchActivity>,
): PrizeRedemptionDepositStatus {
  if (activity.claimed && activity.quit)
    throw new Error(`${PRIZE_REDEMPTION_BATCH_UNKNOWN} Ambiguous claim/refund history.`);
  if (activity.claimed) return "CLAIMED_COMPLETE";
  if (activity.quit) return "REFUNDED_COMPLETE";
  if (batchState === PRIZE_REDEMPTION_BATCH_STATES.FINALIZED) return "CLAIMABLE";
  if (batchState === PRIZE_REDEMPTION_BATCH_STATES.CANCELED) return "REFUNDABLE";
  return "JOINED_ACTIVE";
}

/** Rediscover the account's latest bounded redemption batch after a reload. */
export async function discoverPrizeRedemption(
  account: string,
  options: PrizeRedemptionDiscoveryOptions = {},
): Promise<PrizeRedemptionState | undefined> {
  const reader = options.reader ?? sepoliaReadProvider;
  const batcher = options.batcher ?? (readBatcher() as unknown as RedemptionDiscoveryBatcher);
  const latestBlock = options.latestBlock ?? (await reader.getBlockNumber());
  const fromBlock = discoveryFromBlock(latestBlock, options.fromBlock);
  const events = await readRedemptionEvents(account, batcher, fromBlock, latestBlock);
  const batchIds = [
    ...new Set(events.filter((event) => event.kind === "Joined").map((event) => event.batchId.toString())),
  ]
    .map((value) => BigInt(value))
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  const readState =
    options.readState ?? ((batchId, owner, depositStatus) => readPrizeRedemptionState(batchId, owner, depositStatus));
  const states: PrizeRedemptionState[] = [];
  for (const batchId of batchIds) {
    let rawBatchState: bigint | number;
    try {
      rawBatchState = await batcher.batchState(batchId);
    } catch {
      continue;
    }
    const activity = classifyPrizeRedemptionBatchActivity(events, account, UNVEIL_CONTRACTS.withdrawalBatcher, batchId);
    if (activity.ambiguous) continue;
    const depositStatus = statusForBatchActivity(Number(rawBatchState), activity);
    try {
      states.push(await readState(batchId, account, depositStatus));
    } catch {
      // Ignore stale/nonexistent candidates and continue to older batches.
    }
  }
  return selectLatestPrizeRedemptionState(states);
}

function assertCurrent(isCurrent?: () => boolean) {
  if (isCurrent && !isCurrent()) {
    throw new Error("UNVEIL_PRIZE_REDEMPTION_STATE_CHANGED: Wallet session is no longer current.");
  }
}

export function joinedBatchId(receipt: TransactionReceipt | null, account: string, submittedTransactionHash: string) {
  if (!receipt) {
    throw new Error(`${PRIZE_REDEMPTION_BATCH_UNKNOWN} The transaction receipt is not available yet.`);
  }
  const events = receipt.logs.map((log) => {
    const decoded = decodePrizeRedemptionEvent(
      {
        ...log,
        transactionHash: (log as { transactionHash?: string }).transactionHash ?? receipt.hash,
      },
      UNVEIL_CONTRACTS.withdrawalBatcher,
    );
    return decoded;
  });
  return selectUniqueJoinedBatchId(
    events.filter((event): event is NormalizedPrizeRedemptionEvent => Boolean(event)),
    account,
    UNVEIL_CONTRACTS.withdrawalBatcher,
    submittedTransactionHash,
  );
}

export async function verifyPrizeRedemptionRoute() {
  const shares = new Contract(UNVEIL_CONTRACTS.shares, SHARES_ABI, sepoliaReadProvider);
  const principal = new Contract(UNVEIL_CONTRACTS.principal, PRINCIPAL_ABI, sepoliaReadProvider);
  const batcher = readBatcher();
  const [fromToken, toToken, vault, sharesUnderlying, principalUnderlying] = await Promise.all([
    batcher.fromToken(),
    batcher.toToken(),
    batcher.vault(),
    shares.underlying(),
    principal.underlying(),
  ]);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    !same(String(fromToken), UNVEIL_CONTRACTS.shares) ||
    !same(String(toToken), UNVEIL_CONTRACTS.principal) ||
    !same(String(vault), UNVEIL_CONTRACTS.vault) ||
    !same(String(sharesUnderlying), UNVEIL_CONTRACTS.vault) ||
    !same(String(principalUnderlying), UNVEIL_CONTRACTS.underlying)
  ) {
    throw new Error("UNVEIL_PRIZE_REDEMPTION_ROUTE_INVALID: The confidential prize route does not match V4.");
  }
  return true;
}

export async function readPrizeRedemptionState(
  batchId: bigint,
  account: string,
  depositStatus?: PrizeRedemptionDepositStatus,
): Promise<PrizeRedemptionState> {
  const batcher = readBatcher();
  const [currentBatchId, currentBatchOpenedAt, minimumBatchAge, batchState, depositedHandle, exchangeRate, block] =
    await Promise.all([
      batcher.currentBatchId(),
      batcher.currentBatchOpenedAt(),
      batcher.minimumBatchAge(),
      batcher.batchState(batchId),
      batcher.deposits(batchId, account),
      batcher.exchangeRate(batchId),
      sepoliaReadProvider.getBlock("latest"),
    ]);
  const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));
  return derivePrizeRedemptionState({
    batchId,
    batchState: Number(batchState),
    currentBatchId: BigInt(currentBatchId),
    currentBatchOpenedAt: BigInt(currentBatchOpenedAt),
    minimumBatchAge: BigInt(minimumBatchAge),
    now,
    depositedHandle: String(depositedHandle),
    exchangeRate: BigInt(exchangeRate),
    account,
    depositStatus,
  });
}

export async function startPrizeRedemption(signer: JsonRpcSigner, amount: bigint, onStep?: Step) {
  try {
    validatePrizeRedemptionAmount(amount);
    if (amount > MAX_UINT64) throw new Error("Enter a valid whole-number prize amount.");
    await ensureSepolia();
    const account = await signer.getAddress();
    await verifyPrizeRedemptionRoute();
    onStep?.("Encrypting confidential prize shares locally…");
    const encrypted = await createEncryptedInputFor(signer, UNVEIL_CONTRACTS.shares, amount);
    onStep?.("Waiting for wallet confirmation to redeem prize shares…");
    const shares = new Contract(UNVEIL_CONTRACTS.shares, SHARES_ABI, signer);
    const tx = await shares["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
      UNVEIL_CONTRACTS.withdrawalBatcher,
      encrypted.handles[0],
      encrypted.inputProof,
      "0x",
    );
    const result = await waitForSubmittedTransaction(tx, (hash) =>
      onStep?.(`SUBMITTED/PENDING · Prize redemption ${hash}`),
    );
    let actualBatchId: bigint;
    try {
      actualBatchId = joinedBatchId(result.receipt as TransactionReceipt | null, account, result.hash);
    } catch (error) {
      if (isPrizeRedemptionBatchUnknown(error)) {
        const recovery = new Error(
          `${PRIZE_REDEMPTION_BATCH_UNKNOWN} The transaction may have succeeded, but its redemption batch could not yet be identified. Do not submit another redemption. Refresh/recover the existing batch.`,
        ) as Error & { transactionHash?: string };
        recovery.transactionHash = result.hash;
        throw recovery;
      }
      throw error;
    }
    return {
      batchId: actualBatchId,
      receipt: result.receipt as TransactionReceipt | null,
      state: await readPrizeRedemptionState(actualBatchId, account, "JOINED_ACTIVE"),
    };
  } catch (error) {
    actionError("UNVEIL_PRIZE_REDEMPTION_START_FAILED:", error);
  }
}

export async function advancePrizeRedemption(
  signer: JsonRpcSigner,
  batchId: bigint,
  onStep?: Step,
  isCurrent?: () => boolean,
  depositStatus?: PrizeRedemptionDepositStatus,
) {
  try {
    const account = await signer.getAddress();
    let live = await readPrizeRedemptionState(batchId, account, depositStatus);
    if (!live.action.actionable) return live;
    assertCurrent(isCurrent);

    const batcher = new Contract(UNVEIL_CONTRACTS.withdrawalBatcher, BATCHER_ABI, signer);
    if (live.action.kind === "DISPATCH") {
      onStep?.("Dispatching the mature prize redemption batch…");
      const tx = await batcher.dispatchBatch();
      await waitForSubmittedTransaction(tx, (hash) => onStep?.(`SUBMITTED/PENDING · Batch dispatch ${hash}`));
      return readPrizeRedemptionState(batchId, account, live.depositStatus);
    }

    if (live.action.kind === "PROVE") {
      const requestId = String(await batcher.unwrapRequestId(batchId));
      const shares = new Contract(UNVEIL_CONTRACTS.shares, SHARES_ABI, sepoliaReadProvider);
      const encryptedAmount = String(await shares.unwrapAmount(requestId));
      const clear = await publicDecryptHandle(
        encryptedAmount,
        "The aggregate prize redemption amount is not ready yet.",
      );
      const amount = BigInt(clear.value as bigint | string | number);
      if (amount < 0n || amount > MAX_UINT64) throw new Error("The public redemption amount is outside uint64 bounds.");
      assertCurrent(isCurrent);
      live = await readPrizeRedemptionState(batchId, account);
      if (live.action.kind !== "PROVE")
        throw new Error("UNVEIL_PRIZE_REDEMPTION_STATE_CHANGED: Batch state changed before verification.");
      onStep?.("Submitting the KMS-verified redemption route…");
      const tx = await batcher.dispatchBatchCallback(batchId, amount, clear.proof);
      await waitForSubmittedTransaction(tx, (hash) => onStep?.(`SUBMITTED/PENDING · Route verification ${hash}`));
      return readPrizeRedemptionState(batchId, account, live.depositStatus);
    }

    if (live.action.kind === "CLAIM") {
      onStep?.("Waiting for wallet confirmation to receive confidential TEST principal…");
      const tx = await batcher.claim(batchId, account);
      await waitForSubmittedTransaction(tx, (hash) => onStep?.(`SUBMITTED/PENDING · Principal claim ${hash}`));
      return readPrizeRedemptionState(batchId, account, "CLAIMED_COMPLETE");
    }

    if (live.action.kind === "REFUND") {
      onStep?.("Returning shares from the canceled redemption batch…");
      const tx = await batcher.quit(batchId);
      await waitForSubmittedTransaction(tx, (hash) => onStep?.(`SUBMITTED/PENDING · Prize refund ${hash}`));
      return readPrizeRedemptionState(batchId, account, "REFUNDED_COMPLETE");
    }

    return live;
  } catch (error) {
    actionError("UNVEIL_PRIZE_REDEMPTION_LIFECYCLE_FAILED:", error);
  }
}

export { PRIZE_REDEMPTION_BATCH_STATES };
export type { PrizeRedemptionState } from "../../shared/prizeRedemptionLifecycle";
