// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-struct-packing
// solhint-disable named-parameters-mapping, gas-indexed-events, gas-strict-inequalities

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {VeilShardedRoster} from "./VeilShardedRoster.sol";

/// @title VeilShardedSnapshot
/// @notice Permissionless round checkpointing split into HCU-bounded 24-seat shard transactions.
/// @dev A shard snapshot uses the same boundary-maturity rule as V3:
///      min(weight at the previous scheduled close, weight at this scheduled close).
///      Shards with no publicly eligible seats for the closed round are resolved implicitly as zero,
///      so sparse rounds do not require 24 empty checkpoint transactions. Every shard that can carry
///      mature encrypted weight is still processed independently and remains bounded at 24 seats.
abstract contract VeilShardedSnapshot is VeilShardedRoster {
    struct SnapshotShard {
        uint8 participantCount;
        euint64 encryptedTotalWeight;
        bool processed;
    }

    struct ShardedSnapshotRound {
        uint64 startedBlock;
        uint64 finalizedBlock;
        uint16 participantCount;
        uint8 processedShardCount;
        euint64 encryptedTotalWeight;
        bool begun;
        bool finalized;
    }

    mapping(uint256 => ShardedSnapshotRound) private _snapshotRounds;
    mapping(uint256 => mapping(uint8 => SnapshotShard)) private _snapshotShards;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => address))) private _snapshotPlayers;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint64))) private _snapshotWeights;
    mapping(uint256 => mapping(address => bool)) private _snapshotIncluded;
    mapping(uint256 => mapping(address => uint8)) private _snapshotShardByAccount;
    mapping(uint256 => mapping(address => uint8)) private _snapshotIndexByAccount;
    mapping(uint256 => uint32) private _snapshotRequiredShardBitmap;
    mapping(uint256 => uint8) private _snapshotRequiredShardCount;

    event ShardedSnapshotBegun(uint256 indexed roundId, uint64 startedBlock);
    event ShardSnapshotted(uint256 indexed roundId, uint8 indexed shard, uint8 participantCount);
    event ShardedSnapshotFinalized(uint256 indexed roundId, uint16 participantCount, uint64 finalizedBlock);

    function getShardedSnapshotRound(
        uint256 roundId
    )
        public
        view
        returns (
            uint64 startedBlock,
            uint64 finalizedBlock,
            uint16 participantCount,
            uint8 processedShardCount,
            bool begun,
            bool finalized
        )
    {
        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        return (
            round.startedBlock,
            round.finalizedBlock,
            round.participantCount,
            round.processedShardCount,
            round.begun,
            round.finalized
        );
    }

    function getSnapshotRequirements(uint256 roundId) public view returns (uint8 requiredShardCount, uint32 requiredShardBitmap) {
        return (_snapshotRequiredShardCount[roundId], _snapshotRequiredShardBitmap[roundId]);
    }

    function getSnapshotShard(
        uint256 roundId,
        uint8 shard
    ) public view returns (uint8 participantCount, bool processed) {
        require(shard < SHARD_COUNT, "Invalid shard");
        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        if (round.begun && !_snapshotShardRequired(roundId, shard)) return (0, true);
        SnapshotShard storage snapshot = _snapshotShards[roundId][shard];
        return (snapshot.participantCount, snapshot.processed);
    }

    function getSnapshotPlayer(uint256 roundId, uint8 shard, uint8 index) public view returns (address) {
        require(shard < SHARD_COUNT, "Invalid shard");
        SnapshotShard storage snapshot = _snapshotShards[roundId][shard];
        require(snapshot.processed, "Shard not snapshotted");
        require(index < snapshot.participantCount, "Invalid snapshot index");
        return _snapshotPlayers[roundId][shard][index];
    }

    function _beginShardedSnapshot(uint256 roundId) internal {
        require(roundId > 0, "Invalid round");
        uint64 closesAt = _rosterScheduledDrawClosesAt(roundId);
        require(block.timestamp >= closesAt, "Draw still open");

        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        require(!round.begun, "Snapshot already begun");

        (uint8 requiredShardCount, uint32 requiredShardBitmap) = _requiredShardsForRound(roundId, closesAt);
        _snapshotRequiredShardCount[roundId] = requiredShardCount;
        _snapshotRequiredShardBitmap[roundId] = requiredShardBitmap;

        round.startedBlock = uint64(block.number);
        round.processedShardCount = SHARD_COUNT - requiredShardCount;
        round.begun = true;
        round.encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(round.encryptedTotalWeight);

        emit ShardedSnapshotBegun(roundId, round.startedBlock);
    }

    function _snapshotOneShard(uint256 roundId, uint8 shard) internal {
        require(shard < SHARD_COUNT, "Invalid shard");
        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        require(round.begun, "Snapshot not begun");
        require(!round.finalized, "Snapshot finalized");
        require(_snapshotShardRequired(roundId, shard), "Shard not required");

        SnapshotShard storage snapshot = _snapshotShards[roundId][shard];
        require(!snapshot.processed, "Shard already snapshotted");

        uint8 sourceParticipantCount = _historicalShardSourceParticipantCount(roundId, shard);
        uint64 closesAt = _rosterScheduledDrawClosesAt(roundId);
        (uint8 snapshotParticipantCount, euint64 shardTotalWeight) = _buildShardSnapshot(
            roundId,
            shard,
            sourceParticipantCount,
            closesAt
        );

        snapshot.participantCount = snapshotParticipantCount;
        snapshot.encryptedTotalWeight = shardTotalWeight;
        snapshot.processed = true;
        round.encryptedTotalWeight = FHE.add(round.encryptedTotalWeight, shardTotalWeight);
        round.participantCount += snapshotParticipantCount;
        unchecked {
            round.processedShardCount++;
        }

        FHE.allowThis(snapshot.encryptedTotalWeight);
        FHE.allowThis(round.encryptedTotalWeight);
        emit ShardSnapshotted(roundId, shard, snapshotParticipantCount);
    }

    function _requiredShardsForRound(uint256 roundId, uint64 closesAt) private view returns (uint8 count, uint32 bitmap) {
        for (uint8 shard = 0; shard < SHARD_COUNT; shard++) {
            if (_historicalShardParticipantCount(roundId, shard, closesAt) == 0) continue;
            bitmap |= uint32(1) << shard;
            unchecked {
                count++;
            }
        }
    }

    function _snapshotShardRequired(uint256 roundId, uint8 shard) private view returns (bool) {
        return (_snapshotRequiredShardBitmap[roundId] & (uint32(1) << shard)) != 0;
    }

    function _historicalShardSourceParticipantCount(uint256 roundId, uint8 shard) private view returns (uint8) {
        uint256 epochId = _shardEpochForRound(shard, roundId);
        if (epochId == 0) return shardPlayerCount[shard];
        (, , uint8 participantCount) = getShardEpoch(shard, epochId);
        return participantCount;
    }

    function _buildShardSnapshot(
        uint256 roundId,
        uint8 shard,
        uint8 sourceParticipantCount,
        uint64 closesAt
    ) private returns (uint8 snapshotParticipantCount, euint64 shardTotalWeight) {
        shardTotalWeight = FHE.asEuint64(0);

        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            (address account, euint64 matureWeight, bool eligible) = _matureHistoricalWeight(
                roundId,
                shard,
                i,
                closesAt
            );
            if (!eligible) continue;

            _recordSnapshotParticipant(roundId, shard, snapshotParticipantCount, account, matureWeight);
            shardTotalWeight = FHE.add(shardTotalWeight, matureWeight);
            unchecked {
                snapshotParticipantCount++;
            }
        }
    }

    function _matureHistoricalWeight(
        uint256 roundId,
        uint8 shard,
        uint8 sourceIndex,
        uint64 closesAt
    ) private returns (address account, euint64 matureWeight, bool eligible) {
        uint64 expiresAt;
        euint64 closeWeight;
        uint256 eligibleFromRoundId;
        (account, expiresAt, closeWeight, eligibleFromRoundId) = _historicalShardPlayerAt(roundId, shard, sourceIndex);

        if (expiresAt < closesAt || eligibleFromRoundId == 0 || eligibleFromRoundId > roundId) {
            return (account, closeWeight, false);
        }

        euint64 previousCloseWeight =
            roundId == 1 ? FHE.asEuint64(0) : _historicalShardWeightOf(roundId - 1, shard, account);
        matureWeight = FHE.min(previousCloseWeight, closeWeight);
        eligible = true;
    }

    function _recordSnapshotParticipant(
        uint256 roundId,
        uint8 shard,
        uint8 snapshotIndex,
        address account,
        euint64 matureWeight
    ) private {
        _snapshotPlayers[roundId][shard][snapshotIndex] = account;
        _snapshotWeights[roundId][shard][snapshotIndex] = matureWeight;
        _snapshotIncluded[roundId][account] = true;
        _snapshotShardByAccount[roundId][account] = shard;
        _snapshotIndexByAccount[roundId][account] = snapshotIndex;

        FHE.allowThis(_snapshotWeights[roundId][shard][snapshotIndex]);
        FHE.allow(_snapshotWeights[roundId][shard][snapshotIndex], account);
    }

    function _finalizeShardedSnapshot(uint256 roundId) internal {
        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        require(round.begun, "Snapshot not begun");
        require(!round.finalized, "Snapshot finalized");
        require(round.processedShardCount == SHARD_COUNT, "Shards pending");
        require(round.participantCount >= 2, "Need 2 mature seats");

        round.finalizedBlock = uint64(block.number);
        round.finalized = true;
        emit ShardedSnapshotFinalized(roundId, round.participantCount, round.finalizedBlock);
    }

    function _encryptedSnapshotShardTotal(uint256 roundId, uint8 shard) internal view returns (euint64) {
        if (!_snapshotShardRequired(roundId, shard)) return FHE.asEuint64(0);
        SnapshotShard storage snapshot = _snapshotShards[roundId][shard];
        require(snapshot.processed, "Shard not snapshotted");
        return snapshot.encryptedTotalWeight;
    }

    function _encryptedShardedSnapshotTotal(uint256 roundId) internal view returns (euint64) {
        ShardedSnapshotRound storage round = _snapshotRounds[roundId];
        require(round.finalized, "Snapshot not finalized");
        return round.encryptedTotalWeight;
    }

    function _encryptedShardedSnapshotWeightOf(uint256 roundId, address account) internal view returns (euint64) {
        require(_snapshotIncluded[roundId][account], "Not in round");
        uint8 shard = _snapshotShardByAccount[roundId][account];
        uint8 index = _snapshotIndexByAccount[roundId][account];
        return _snapshotWeights[roundId][shard][index];
    }

    function _snapshotShardParticipantCount(uint256 roundId, uint8 shard) internal view returns (uint8) {
        require(shard < SHARD_COUNT, "Invalid shard");
        if (!_snapshotShardRequired(roundId, shard)) return 0;
        SnapshotShard storage snapshot = _snapshotShards[roundId][shard];
        require(snapshot.processed, "Shard not snapshotted");
        return snapshot.participantCount;
    }

    function _snapshotPlayerAt(uint256 roundId, uint8 shard, uint8 index) internal view returns (address) {
        require(index < _snapshotShardParticipantCount(roundId, shard), "Invalid snapshot index");
        return _snapshotPlayers[roundId][shard][index];
    }

    function _snapshotWeightAt(uint256 roundId, uint8 shard, uint8 index) internal view returns (euint64) {
        require(index < _snapshotShardParticipantCount(roundId, shard), "Invalid snapshot index");
        return _snapshotWeights[roundId][shard][index];
    }
}
