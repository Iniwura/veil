// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-strict-inequalities, immutable-vars-naming
// solhint-disable code-complexity, gas-increment-by-one

interface IVeilSnapshotBatchTarget {
    function nextRoundId() external view returns (uint256);

    function beginSnapshotRound() external returns (uint256 roundId);

    function snapshotRoundShard(uint256 roundId, uint8 shard) external;

    function completeSnapshotRound(uint256 roundId) external;

    function shardPlayerCount(uint8 shard) external view returns (uint8);

    function shardStateEpochCount(uint8 shard) external view returns (uint256);

    function getShardEpoch(
        uint8 shard,
        uint256 epochId
    ) external view returns (uint256 startRoundId, uint256 endRoundId, uint8 participantCount);
}

/// @title VeilSnapshotBatcher
/// @notice Permissionless atomic orchestration for measured sharded snapshot batches.
/// @dev This helper preserves the deployed pool bytecode. It derives each shard's historical
///      source width, applies both published HCU limits, and then forwards all shard calls in
///      one transaction. The target pool still enforces round and duplicate-shard invariants.
contract VeilSnapshotBatcher {
    uint8 public constant MAX_SHARDS_PER_BATCH = 24;
    uint8 public constant MAX_SEATS_PER_SHARD = 24;

    uint256 private constant TRANSACTION_HCU_LIMIT = 20_000_000;
    uint256 private constant DEPTH_HCU_LIMIT = 5_000_000;
    uint256 private constant MIN_EUINT64_NON_SCALAR_HCU = 219_000;
    uint256 private constant ADD_EUINT64_NON_SCALAR_HCU = 162_000;
    uint256 private constant TRIVIAL_ENCRYPT_HCU = 32;

    error InvalidTarget();
    error EmptyBatch();
    error BatchTooLarge();
    error InvalidShard(uint8 shard);
    error DuplicateShard(uint8 shard);
    error RoundIdMismatch(uint256 expectedRoundId, uint256 actualRoundId);
    error SnapshotBatchTransactionHcuExceeded(uint256 estimatedHcu);
    error SnapshotBatchDepthHcuExceeded(uint256 estimatedHcu);

    IVeilSnapshotBatchTarget public immutable pool;

    constructor(IVeilSnapshotBatchTarget target_) {
        if (address(target_) == address(0)) revert InvalidTarget();
        pool = target_;
    }

    function snapshotShards(uint256 roundId, uint8[] calldata shards) external {
        _snapshotShards(roundId, shards, 0);
    }

    /// @notice Begins the next round and snapshots its first batch atomically.
    /// @dev The returned round id is the pool's pre-increment nextRoundId. A failed batch rolls back the begin.
    function beginAndSnapshotShards(uint8[] calldata shards) external returns (uint256 roundId) {
        roundId = _beginSnapshotRound();
        _snapshotShards(roundId, shards, TRIVIAL_ENCRYPT_HCU);
    }

    /// @notice Begins, snapshots, and completes a round atomically when one batch covers all remaining shards.
    /// @dev A full round with additional unprocessed shards reverts at completeSnapshotRound and rolls back all work.
    function beginSnapshotShardsAndComplete(uint8[] calldata shards) external returns (uint256 roundId) {
        roundId = _beginSnapshotRound();
        _snapshotShards(roundId, shards, TRIVIAL_ENCRYPT_HCU);
        pool.completeSnapshotRound(roundId);
    }

    /// @notice Snapshots the final batch and completes the round atomically.
    /// @dev The target's completeSnapshotRound check ensures this call can only succeed for a final batch.
    function snapshotShardsAndComplete(uint256 roundId, uint8[] calldata shards) external {
        _snapshotShards(roundId, shards, 0);
        pool.completeSnapshotRound(roundId);
    }

    function _beginSnapshotRound() private returns (uint256 roundId) {
        roundId = pool.nextRoundId();
        uint256 begunRoundId = pool.beginSnapshotRound();
        if (begunRoundId != roundId) revert RoundIdMismatch(roundId, begunRoundId);
    }

    function _snapshotShards(uint256 roundId, uint8[] calldata shards, uint256 extraHcu) private {
        uint256 shardCount = shards.length;
        if (shardCount == 0) revert EmptyBatch();
        if (shardCount > MAX_SHARDS_PER_BATCH) revert BatchTooLarge();

        uint256 estimatedTransactionHcu = extraHcu + shardCount * (TRIVIAL_ENCRYPT_HCU + ADD_EUINT64_NON_SCALAR_HCU);
        uint8 maximumParticipants;
        uint256 seen;

        for (uint256 i = 0; i < shardCount; i++) {
            uint8 shard = shards[i];
            if (shard >= MAX_SHARDS_PER_BATCH) revert InvalidShard(shard);

            uint256 bit = uint256(1) << shard;
            if ((seen & bit) != 0) revert DuplicateShard(shard);
            seen |= bit;

            uint8 participants = _historicalSourceParticipantCount(roundId, shard);
            estimatedTransactionHcu +=
                uint256(participants) *
                (MIN_EUINT64_NON_SCALAR_HCU + ADD_EUINT64_NON_SCALAR_HCU + TRIVIAL_ENCRYPT_HCU * 2);
            if (participants > maximumParticipants) maximumParticipants = participants;
        }

        if (estimatedTransactionHcu > TRANSACTION_HCU_LIMIT) {
            revert SnapshotBatchTransactionHcuExceeded(estimatedTransactionHcu);
        }

        uint256 estimatedDepthHcu =
            extraHcu +
                MIN_EUINT64_NON_SCALAR_HCU +
                TRIVIAL_ENCRYPT_HCU * 2 +
                ADD_EUINT64_NON_SCALAR_HCU * (uint256(maximumParticipants) + shardCount);
        if (estimatedDepthHcu > DEPTH_HCU_LIMIT) {
            revert SnapshotBatchDepthHcuExceeded(estimatedDepthHcu);
        }

        for (uint256 i = 0; i < shardCount; i++) {
            pool.snapshotRoundShard(roundId, shards[i]);
        }
    }

    function _historicalSourceParticipantCount(uint256 roundId, uint8 shard) private view returns (uint8) {
        uint256 epochCount = pool.shardStateEpochCount(shard);
        uint256 low = 1;
        uint256 high = epochCount;

        while (low <= high) {
            uint256 middle = low + ((high - low) / 2);
            (uint256 startRoundId, uint256 endRoundId, uint8 participantCount) = pool.getShardEpoch(shard, middle);
            if (roundId < startRoundId) {
                high = middle - 1;
            } else if (roundId > endRoundId) {
                low = middle + 1;
            } else {
                return participantCount;
            }
        }

        return pool.shardPlayerCount(shard);
    }
}
