import { Interface } from "ethers";

export type PrizeRedemptionEventKind = "Joined" | "Claimed" | "Quit";

export type NormalizedPrizeRedemptionEvent = {
  kind: PrizeRedemptionEventKind;
  batchId: bigint;
  account: string;
  emitter: string;
  transactionHash?: string;
  logIndex?: number;
};

export type PrizeRedemptionBatchActivity = {
  joined: boolean;
  claimed: boolean;
  quit: boolean;
  ambiguous: boolean;
};

export const PRIZE_REDEMPTION_BATCH_UNKNOWN = "UNVEIL_PRIZE_REDEMPTION_BATCH_UNKNOWN:";

const BATCHER_EVENT_INTERFACE = new Interface([
  "event Joined(uint256 indexed batchId,address indexed account,bytes32 amount)",
  "event Claimed(uint256 indexed batchId,address indexed account,bytes32 amount)",
  "event Quit(uint256 indexed batchId,address indexed account,bytes32 amount)",
]);

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function decodePrizeRedemptionEvent(
  log: unknown,
  batcherAddress: string,
): NormalizedPrizeRedemptionEvent | undefined {
  const candidate = log as {
    address?: string;
    topics?: readonly string[];
    data?: string;
    transactionHash?: string;
    index?: number;
    logIndex?: number;
  };
  if (!candidate.address || !sameAddress(candidate.address, batcherAddress)) return undefined;
  try {
    const parsed = BATCHER_EVENT_INTERFACE.parseLog({
      topics: Array.from(candidate.topics ?? []),
      data: candidate.data ?? "0x",
    });
    if (!parsed || !["Joined", "Claimed", "Quit"].includes(parsed.name)) return undefined;
    return {
      kind: parsed.name as PrizeRedemptionEventKind,
      batchId: BigInt(parsed.args.batchId),
      account: String(parsed.args.account),
      emitter: candidate.address,
      transactionHash: candidate.transactionHash,
      logIndex: candidate.index ?? candidate.logIndex,
    };
  } catch {
    return undefined;
  }
}

function relevantEvents(
  events: readonly NormalizedPrizeRedemptionEvent[],
  account: string,
  batcherAddress: string,
  batchId?: bigint,
) {
  return events.filter(
    (event) =>
      sameAddress(event.emitter, batcherAddress) &&
      sameAddress(event.account, account) &&
      (batchId === undefined || event.batchId === batchId),
  );
}

/** Require exactly one authoritative Joined event from the submitted receipt. */
export function selectUniqueJoinedBatchId(
  events: readonly NormalizedPrizeRedemptionEvent[],
  account: string,
  batcherAddress: string,
  submittedTransactionHash?: string,
): bigint {
  const matches = relevantEvents(events, account, batcherAddress).filter((event) => {
    if (event.kind !== "Joined") return false;
    if (!submittedTransactionHash || !event.transactionHash) return true;
    return event.transactionHash.toLowerCase() === submittedTransactionHash.toLowerCase();
  });
  if (matches.length !== 1) {
    throw new Error(
      `${PRIZE_REDEMPTION_BATCH_UNKNOWN} Expected exactly one Joined event for this wallet in the submitted receipt; found ${matches.length}. The transaction may have succeeded, but its redemption batch could not yet be identified. Do not submit another redemption. Refresh/recover the existing batch.`,
    );
  }
  return matches[0].batchId;
}

export function classifyPrizeRedemptionBatchActivity(
  events: readonly NormalizedPrizeRedemptionEvent[],
  account: string,
  batcherAddress: string,
  batchId: bigint,
): PrizeRedemptionBatchActivity {
  const matches = relevantEvents(events, account, batcherAddress, batchId);
  const joined = matches.some((event) => event.kind === "Joined");
  const claimed = matches.some((event) => event.kind === "Claimed");
  const quit = matches.some((event) => event.kind === "Quit");
  return { joined, claimed, quit, ambiguous: claimed && quit };
}
