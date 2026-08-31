// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, gas-struct-packing, max-states-count, named-parameters-mapping

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title VeilShardedRoster
/// @notice Bounded 24 x 24 draw-seat topology with shard-local historical checkpoints.
/// @dev Each shard stays at the V3 HCU-safe width while the aggregate active roster expands to 576 savers.
///      A mutation seals only the affected shard for already-closed rounds, preventing post-close backfills
///      without copying the other 23 shards.
abstract contract VeilShardedRoster is ZamaEthereumConfig {
    uint8 public constant SHARD_COUNT = 24;
    uint8 public constant SHARD_SIZE = 24;
    uint16 public constant MAX_ACTIVE_SAVERS = 576;
    uint64 public constant SHARDED_SEAT_LEASE = 30 days;

    struct ShardEpoch {
        uint256 startRoundId;
        uint256 endRoundId;
        uint8 participantCount;
    }

    mapping(uint8 => address[24]) private _shardPlayers;
    mapping(uint8 => uint8) public shardPlayerCount;
    mapping(address => uint8) private _seatIndexInShard;

    mapping(address => bool) public seated;
    mapping(address => uint8) public seatShard;
    mapping(address => uint64) public seatExpiresAt;
    mapping(address => uint256) public seatEligibleFromRoundId;
    uint16 public playerCount;
    uint8 private _nextShardHint;

    mapping(uint8 => uint256) public shardLastSealedRoundId;
    mapping(uint8 => uint256) public shardStateEpochCount;
    mapping(uint8 => mapping(uint256 => ShardEpoch)) private _shardStateEpochs;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => address))) private _shardStateEpochPlayers;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => euint64))) private _shardStateEpochWeights;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => uint64))) private _shardStateEpochSeatExpiresAt;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => uint256))) private _shardStateEpochSeatEligibleFromRoundId;

    event ShardedSeatRenewed(
        address indexed player,
        uint8 indexed shard,
        uint64 expiresAt,
        uint256 eligibleFromRoundId
    );
    event ShardedSeatReleased(address indexed player, uint8 indexed shard);
    event ShardStateSealed(
        uint8 indexed shard,
        uint256 indexed epochId,
        uint256 startRoundId,
        uint256 endRoundId,
        uint8 participantCount
    );

    function getShardPlayer(uint8 shard, uint8 index) public view returns (address) {
        _requireShard(shard);
        require(index < shardPlayerCount[shard], "Invalid shard index");
        return _shardPlayers[shard][index];
    }

    function seatIndexInShard(address account) public view returns (uint8) {
        require(seated[account], "Not seated");
        return _seatIndexInShard[account];
    }

    function getShardEpoch(
        uint8 shard,
        uint256 epochId
    ) public view returns (uint256 startRoundId, uint256 endRoundId, uint8 participantCount) {
        _requireShard(shard);
        ShardEpoch storage epoch = _shardStateEpochs[shard][epochId];
        return (epoch.startRoundId, epoch.endRoundId, epoch.participantCount);
    }

    function _acquireOrRenewShardedSeat(address account) internal {
        require(account != address(0), "Invalid account");
        uint8 shard;

        if (seated[account]) {
            shard = seatShard[account];
            _sealShardCurrentStateForClosedRounds(shard);
        } else {
            bool preservingMaturity = seatEligibleFromRoundId[account] != 0;
            if (preservingMaturity) {
                // A positive post-withdrawal attestation must return to the same shard. Moving
                // shards would make the previous-close term in min(previous, current) resolve to
                // zero and silently erase an otherwise mature participant. If that shard is full,
                // defer activation until a slot is available rather than weakening fairness.
                shard = seatShard[account];
                _requireShard(shard);
            } else {
                shard = _findAvailableShard();
            }
            _sealShardCurrentStateForClosedRounds(shard);
            if (shardPlayerCount[shard] == SHARD_SIZE) _pruneExpiredSeatsInShard(shard);
            require(shardPlayerCount[shard] < SHARD_SIZE, "Draw roster full");

            uint8 index = shardPlayerCount[shard];
            _shardPlayers[shard][index] = account;
            _seatIndexInShard[account] = index;
            seated[account] = true;
            seatShard[account] = shard;
            // A withdrawal releases the live roster slot while its encrypted post-withdrawal
            // balance is attested. Preserve that account's prior eligibility boundary when the
            // KMS proves the balance is still positive; fresh joins still mature from the next
            // round after acquisition.
            if (seatEligibleFromRoundId[account] == 0) {
                seatEligibleFromRoundId[account] = _rosterNextRoundId() + 1;
            }
            unchecked {
                shardPlayerCount[shard] = index + 1;
                playerCount++;
            }
            _nextShardHint = shard + 1 == SHARD_COUNT ? 0 : shard + 1;
        }

        uint256 leaseEnd = block.timestamp + SHARDED_SEAT_LEASE;
        require(leaseEnd <= type(uint64).max, "Lease overflow");
        uint64 expiresAt = uint64(leaseEnd);
        uint64 nextWindowClose = _rosterScheduledDrawClosesAt(_rosterNextRoundId() + 1);
        if (expiresAt < nextWindowClose) expiresAt = nextWindowClose;
        seatExpiresAt[account] = expiresAt;

        emit ShardedSeatRenewed(account, shard, expiresAt, seatEligibleFromRoundId[account]);
    }

    function _releaseShardedSeat(address account) internal {
        _releaseShardedSeat(account, false);
    }

    /// @dev Releases the live slot while retaining the maturity boundary for a pending
    ///      post-withdrawal KMS attestation. The account is not seated and consumes no capacity.
    function _releaseShardedSeatPreservingMaturity(address account) internal {
        _releaseShardedSeat(account, true);
    }

    function _releaseShardedSeat(address account, bool preserveEligibility) private {
        require(seated[account], "Not seated");
        uint8 shard = seatShard[account];
        _sealShardCurrentStateForClosedRounds(shard);
        _removeSeatFromShard(account, shard, preserveEligibility);
    }

    function _clearShardedSeatEligibility(address account) internal {
        seatEligibleFromRoundId[account] = 0;
        delete seatShard[account];
    }

    function _pruneExpiredShardedSeats(uint8 shard) internal {
        _requireShard(shard);
        if (!_shardHasExpiredSeat(shard)) return;
        _sealShardCurrentStateForClosedRounds(shard);
        _pruneExpiredSeatsInShard(shard);
    }

    /// @dev Call before changing the encrypted balance of a seated account.
    function _sealShardedAccountState(address account) internal {
        if (seated[account]) _sealShardCurrentStateForClosedRounds(seatShard[account]);
    }

    function _sealShardCurrentStateForClosedRounds(uint8 shard) internal {
        _requireShard(shard);
        uint256 latestClosedRoundId = _rosterLatestClosedRoundId();
        uint256 lastSealedRoundId = shardLastSealedRoundId[shard];
        if (latestClosedRoundId <= lastSealedRoundId) return;

        uint256 epochId = shardStateEpochCount[shard] + 1;
        ShardEpoch storage epoch = _shardStateEpochs[shard][epochId];
        epoch.startRoundId = lastSealedRoundId + 1;
        epoch.endRoundId = latestClosedRoundId;
        epoch.participantCount = shardPlayerCount[shard];

        for (uint8 i = 0; i < epoch.participantCount; i++) {
            address account = _shardPlayers[shard][i];
            _shardStateEpochPlayers[shard][epochId][i] = account;
            _shardStateEpochWeights[shard][epochId][i] = _rosterCurrentWeight(account);
            _shardStateEpochSeatExpiresAt[shard][epochId][i] = seatExpiresAt[account];
            _shardStateEpochSeatEligibleFromRoundId[shard][epochId][i] = seatEligibleFromRoundId[account];
            FHE.allowThis(_shardStateEpochWeights[shard][epochId][i]);
        }

        shardStateEpochCount[shard] = epochId;
        shardLastSealedRoundId[shard] = latestClosedRoundId;
        emit ShardStateSealed(shard, epochId, epoch.startRoundId, epoch.endRoundId, epoch.participantCount);
    }

    function _historicalShardPlayerAt(
        uint256 roundId,
        uint8 shard,
        uint8 index
    ) internal view returns (address account, uint64 expiresAt, euint64 weight, uint256 eligibleFromRoundId) {
        _requireShard(shard);
        uint256 epochId = _shardEpochForRound(shard, roundId);
        uint8 sourceParticipantCount =
            epochId == 0 ? shardPlayerCount[shard] : _shardStateEpochs[shard][epochId].participantCount;
        require(index < sourceParticipantCount, "Invalid historical index");

        if (epochId == 0) {
            account = _shardPlayers[shard][index];
            expiresAt = seatExpiresAt[account];
            weight = _rosterCurrentWeight(account);
            eligibleFromRoundId = seatEligibleFromRoundId[account];
        } else {
            account = _shardStateEpochPlayers[shard][epochId][index];
            expiresAt = _shardStateEpochSeatExpiresAt[shard][epochId][index];
            weight = _shardStateEpochWeights[shard][epochId][index];
            eligibleFromRoundId = _shardStateEpochSeatEligibleFromRoundId[shard][epochId][index];
        }
    }

    function _historicalShardWeightOf(uint256 roundId, uint8 shard, address account) internal returns (euint64) {
        if (roundId == 0) return FHE.asEuint64(0);
        uint256 epochId = _shardEpochForRound(shard, roundId);
        uint8 sourceParticipantCount =
            epochId == 0 ? shardPlayerCount[shard] : _shardStateEpochs[shard][epochId].participantCount;

        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            address candidate = epochId == 0 ? _shardPlayers[shard][i] : _shardStateEpochPlayers[shard][epochId][i];
            if (candidate != account) continue;
            return epochId == 0 ? _rosterCurrentWeight(account) : _shardStateEpochWeights[shard][epochId][i];
        }
        return FHE.asEuint64(0);
    }

    function _historicalShardParticipantCount(
        uint256 roundId,
        uint8 shard,
        uint64 closesAt
    ) internal view returns (uint8 count) {
        uint256 epochId = _shardEpochForRound(shard, roundId);
        uint8 sourceParticipantCount =
            epochId == 0 ? shardPlayerCount[shard] : _shardStateEpochs[shard][epochId].participantCount;

        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            address account = epochId == 0 ? _shardPlayers[shard][i] : _shardStateEpochPlayers[shard][epochId][i];
            uint64 expiresAt = epochId == 0 ? seatExpiresAt[account] : _shardStateEpochSeatExpiresAt[shard][epochId][i];
            uint256 eligibleFromRoundId =
                epochId == 0
                    ? seatEligibleFromRoundId[account]
                    : _shardStateEpochSeatEligibleFromRoundId[shard][epochId][i];
            if (expiresAt >= closesAt && eligibleFromRoundId != 0 && eligibleFromRoundId <= roundId) count++;
        }
    }

    function _shardEpochForRound(uint8 shard, uint256 roundId) internal view returns (uint256) {
        uint256 low = 1;
        uint256 high = shardStateEpochCount[shard];
        while (low <= high) {
            uint256 middle = low + ((high - low) / 2);
            ShardEpoch storage epoch = _shardStateEpochs[shard][middle];
            if (roundId < epoch.startRoundId) high = middle - 1;
            else if (roundId > epoch.endRoundId) low = middle + 1;
            else return middle;
        }
        return 0;
    }

    function _findAvailableShard() private view returns (uint8 shard) {
        for (uint8 offset = 0; offset < SHARD_COUNT; offset++) {
            shard = uint8((uint16(_nextShardHint) + uint16(offset)) % uint16(SHARD_COUNT));
            if (shardPlayerCount[shard] < SHARD_SIZE || _shardHasExpiredSeat(shard)) return shard;
        }
        revert("Draw roster full");
    }

    function _shardHasExpiredSeat(uint8 shard) private view returns (bool) {
        uint8 count = shardPlayerCount[shard];
        for (uint8 i = 0; i < count; i++) {
            if (seatExpiresAt[_shardPlayers[shard][i]] < block.timestamp) return true;
        }
        return false;
    }

    function _pruneExpiredSeatsInShard(uint8 shard) private {
        uint8 i = 0;
        while (i < shardPlayerCount[shard]) {
            address account = _shardPlayers[shard][i];
            if (seatExpiresAt[account] < block.timestamp) _removeSeatFromShard(account, shard, false);
            else {
                unchecked {
                    i++;
                }
            }
        }
    }

    function _removeSeatFromShard(address account, uint8 shard, bool preserveEligibility) private {
        uint8 index = _seatIndexInShard[account];
        uint8 lastIndex = shardPlayerCount[shard] - 1;
        if (index != lastIndex) {
            address moved = _shardPlayers[shard][lastIndex];
            _shardPlayers[shard][index] = moved;
            _seatIndexInShard[moved] = index;
        }

        _shardPlayers[shard][lastIndex] = address(0);
        delete _seatIndexInShard[account];
        seated[account] = false;
        if (!preserveEligibility) delete seatShard[account];
        seatExpiresAt[account] = 0;
        if (!preserveEligibility) seatEligibleFromRoundId[account] = 0;
        unchecked {
            shardPlayerCount[shard]--;
            playerCount--;
        }
        emit ShardedSeatReleased(account, shard);
    }

    function _requireShard(uint8 shard) private pure {
        require(shard < SHARD_COUNT, "Invalid shard");
    }

    function _rosterCurrentWeight(address account) internal view virtual returns (euint64);

    function _rosterNextRoundId() internal view virtual returns (uint256);

    function _rosterLatestClosedRoundId() internal view virtual returns (uint256);

    function _rosterScheduledDrawClosesAt(uint256 roundId) internal view virtual returns (uint64);
}
