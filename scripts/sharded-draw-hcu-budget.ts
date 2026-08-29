import { V3_MAX_PLAYERS, ZAMA_HCU_LIMITS, estimateBlindDrawHcu, type BlindDrawHcuEstimate } from "./draw-hcu-budget";

export const V4_SHARD_SIZE = V3_MAX_PLAYERS;
export const V4_SHARD_COUNT = V3_MAX_PLAYERS;
export const V4_ACTIVE_SAVER_CAPACITY = V4_SHARD_SIZE * V4_SHARD_COUNT;

export type ShardedDrawHcuEstimate = {
  shardSelection: BlindDrawHcuEstimate;
  memberSelection: BlindDrawHcuEstimate;
  maximumTransactionHcu: number;
  maximumDepthHcu: number;
  transactionHeadroom: number;
  depthHeadroom: number;
  withinPublishedLimits: boolean;
};

export function estimateTwoStageShardedDrawHcu(
  shardCount = V4_SHARD_COUNT,
  shardSize = V4_SHARD_SIZE,
): ShardedDrawHcuEstimate {
  const shardSelection = estimateBlindDrawHcu(shardCount);
  const memberSelection = estimateBlindDrawHcu(shardSize);
  const maximumTransactionHcu = Math.max(shardSelection.transactionHcu, memberSelection.transactionHcu);
  const maximumDepthHcu = Math.max(shardSelection.depthHcu, memberSelection.depthHcu);

  return {
    shardSelection,
    memberSelection,
    maximumTransactionHcu,
    maximumDepthHcu,
    transactionHeadroom: ZAMA_HCU_LIMITS.transaction - maximumTransactionHcu,
    depthHeadroom: ZAMA_HCU_LIMITS.depth - maximumDepthHcu,
    withinPublishedLimits:
      shardSelection.withinTransactionLimit &&
      shardSelection.withinDepthLimit &&
      memberSelection.withinTransactionLimit &&
      memberSelection.withinDepthLimit,
  };
}
