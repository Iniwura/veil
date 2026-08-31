import { ZAMA_HCU_LIMITS } from "../scripts/draw-hcu-budget";

export const SNAPSHOT_HCU_COSTS = {
  minEuint64NonScalar: 219_000,
  addEuint64NonScalar: 162_000,
  trivialEncrypt: 32,
} as const;

export const SNAPSHOT_BATCH_LIMITS = {
  maxShards: 24,
  maxSeatsPerShard: 24,
} as const;

export type ShardedSnapshotHcuEstimate = {
  participantsPerShard: number[];
  shardCount: number;
  totalParticipants: number;
  maximumParticipantsInShard: number;
  transactionHcu: number;
  depthHcu: number;
  transactionHeadroom: number;
  depthHeadroom: number;
  withinTransactionLimit: boolean;
  withinDepthLimit: boolean;
  withinPublishedLimits: boolean;
  includesBegin: boolean;
};

export type HistoricalShardWidth = {
  shard: number;
  participants: number;
};

export type ShardedSnapshotBatchPlan = {
  shards: number[];
  participantsPerShard: number[];
  estimate: ShardedSnapshotHcuEstimate;
};

function requireBatchShape(participantsPerShard: number[]): void {
  if (
    participantsPerShard.length < 1 ||
    participantsPerShard.length > SNAPSHOT_BATCH_LIMITS.maxShards ||
    participantsPerShard.some(
      (participants) =>
        !Number.isSafeInteger(participants) ||
        participants < 0 ||
        participants > SNAPSHOT_BATCH_LIMITS.maxSeatsPerShard,
    )
  ) {
    throw new Error("participants per shard must contain 1 to 24 integers between 0 and 24");
  }
}

/**
 * Conservative upper bound for `_snapshotOneShard`.
 *
 * Two per-participant trivial encryptions are charged: one for the round-1 previous-close zero
 * and one for an uninitialized close/previous weight. They are not both needed on normal later
 * rounds, but keeping them in the bound makes the permissionless helper safe without relying on
 * handle deduplication.
 */
export function estimateShardedSnapshotBatchHcu(
  participantsPerShard: number[],
  includeBegin = false,
): ShardedSnapshotHcuEstimate {
  requireBatchShape(participantsPerShard);

  const costs = SNAPSHOT_HCU_COSTS;
  const shardCount = participantsPerShard.length;
  const totalParticipants = participantsPerShard.reduce((sum, participants) => sum + participants, 0);
  const maximumParticipantsInShard = Math.max(...participantsPerShard);
  const perShardBase = costs.trivialEncrypt + costs.addEuint64NonScalar;
  const perParticipant = costs.minEuint64NonScalar + costs.addEuint64NonScalar + costs.trivialEncrypt * 2;
  const beginHcu = includeBegin ? costs.trivialEncrypt : 0;
  const transactionHcu = beginHcu + shardCount * perShardBase + totalParticipants * perParticipant;
  const depthHcu =
    beginHcu +
    costs.minEuint64NonScalar +
    costs.trivialEncrypt * 2 +
    costs.addEuint64NonScalar * (maximumParticipantsInShard + shardCount);

  return {
    participantsPerShard,
    shardCount,
    totalParticipants,
    maximumParticipantsInShard,
    transactionHcu,
    depthHcu,
    transactionHeadroom: ZAMA_HCU_LIMITS.transaction - transactionHcu,
    depthHeadroom: ZAMA_HCU_LIMITS.depth - depthHcu,
    withinTransactionLimit: transactionHcu <= ZAMA_HCU_LIMITS.transaction,
    withinDepthLimit: depthHcu <= ZAMA_HCU_LIMITS.depth,
    withinPublishedLimits: transactionHcu <= ZAMA_HCU_LIMITS.transaction && depthHcu <= ZAMA_HCU_LIMITS.depth,
    includesBegin: includeBegin,
  };
}

function normalizeHistoricalWidths(
  sourceWidths: readonly HistoricalShardWidth[] | readonly number[],
): HistoricalShardWidth[] {
  const normalized = sourceWidths.map((entry, index) =>
    typeof entry === "number" ? { shard: index, participants: entry } : { ...entry },
  );
  const seen = new Set<number>();
  for (const entry of normalized) {
    if (!Number.isSafeInteger(entry.shard) || entry.shard < 0 || entry.shard >= SNAPSHOT_BATCH_LIMITS.maxShards) {
      throw new Error("historical shard ids must be unique integers between 0 and 23");
    }
    if (seen.has(entry.shard)) throw new Error(`duplicate historical shard ${entry.shard}`);
    seen.add(entry.shard);
    if (
      !Number.isSafeInteger(entry.participants) ||
      entry.participants < 0 ||
      entry.participants > SNAPSHOT_BATCH_LIMITS.maxSeatsPerShard
    ) {
      throw new Error("historical shard widths must be integers between 0 and 24");
    }
  }
  return normalized.filter((entry) => entry.participants > 0).sort((left, right) => left.shard - right.shard);
}

/**
 * Greedily packs the non-empty historical shards into the largest safe batches.
 *
 * The first batch includes the begin-fusion's measured 32-HCU overhead. Empty shards are
 * intentionally omitted: the pool marks historically empty shards processed during begin,
 * so adding them would only consume HCU without changing the snapshot.
 */
export function planShardedSnapshotBatches(
  sourceWidths: readonly HistoricalShardWidth[] | readonly number[],
): ShardedSnapshotBatchPlan[] {
  const remaining = normalizeHistoricalWidths(sourceWidths);
  const plans: ShardedSnapshotBatchPlan[] = [];

  while (remaining.length > 0) {
    const shards: HistoricalShardWidth[] = [];
    while (shards.length < SNAPSHOT_BATCH_LIMITS.maxShards && remaining.length > 0) {
      const candidate = [...shards, remaining[0]];
      const estimate = estimateShardedSnapshotBatchHcu(
        candidate.map((entry) => entry.participants),
        plans.length === 0,
      );
      if (!estimate.withinPublishedLimits) break;
      shards.push(remaining.shift()!);
    }
    if (shards.length === 0) {
      throw new Error("historical shard width cannot fit within published snapshot HCU limits");
    }
    const estimate = estimateShardedSnapshotBatchHcu(
      shards.map((entry) => entry.participants),
      plans.length === 0,
    );
    plans.push({
      shards: shards.map((entry) => entry.shard),
      participantsPerShard: shards.map((entry) => entry.participants),
      estimate,
    });
  }

  return plans;
}

/** Number of snapshot transactions for a round with these historical source widths. */
export function snapshotRoundTransactionCount(
  sourceWidths: readonly HistoricalShardWidth[] | readonly number[],
): number {
  const plans = planShardedSnapshotBatches(sourceWidths);
  return plans.length === 0 ? 2 : plans.length;
}

/** Full round count: snapshot stage plus 3 draw/finalize/member/finalize steps, manager and 3 deliveries. */
export function shardedRoundTransactionCount(
  sourceWidths: readonly HistoricalShardWidth[] | readonly number[],
  prizeSlots = 3,
): number {
  if (!Number.isSafeInteger(prizeSlots) || prizeSlots < 0) throw new Error("prizeSlots must be non-negative");
  return snapshotRoundTransactionCount(sourceWidths) + prizeSlots * 3 + 1 + prizeSlots;
}
