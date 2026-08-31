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
