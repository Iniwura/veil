// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, named-parameters-mapping, immutable-vars-naming
// solhint-disable gas-strict-inequalities, gas-increment-by-one

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {VeilShardedDraw} from "../draw/VeilShardedDraw.sol";

contract VeilShardedDrawHarness is VeilShardedDraw {
    mapping(address => euint64) private _weights;

    uint64 public immutable drawPeriod;
    uint64 public immutable firstDrawOpensAt;
    uint256 public nextRoundId = 1;

    constructor(uint64 drawPeriod_) {
        require(drawPeriod_ > 0, "Invalid draw period");
        require(block.timestamp <= type(uint64).max - drawPeriod_, "Schedule overflow");
        drawPeriod = drawPeriod_;
        firstDrawOpensAt = uint64(block.timestamp);
    }

    function acquire(address account) external {
        _acquireOrRenewShardedSeat(account);
    }

    /// @dev Test-only bounded seeding helper. Call before the first draw close.
    function acquireManyWithWeight(address[] calldata accounts, uint64 weight) external {
        require(accounts.length <= SHARD_COUNT, "Batch too large");
        require(_rosterLatestClosedRoundId() == 0, "Seed only before first close");

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            _acquireOrRenewShardedSeat(account);
            _weights[account] = FHE.asEuint64(weight);
            FHE.allowThis(_weights[account]);
            FHE.allow(_weights[account], account);
        }
    }

    function release(address account) external {
        _releaseShardedSeat(account);
    }

    function setWeight(address account, uint64 weight) external {
        _sealShardedAccountState(account);
        _weights[account] = FHE.asEuint64(weight);
        FHE.allowThis(_weights[account]);
        FHE.allow(_weights[account], account);
    }

    function setNextRoundId(uint256 roundId) external {
        require(roundId > 0, "Invalid round");
        nextRoundId = roundId;
    }

    function beginSnapshot(uint256 roundId) external {
        _beginShardedSnapshot(roundId);
    }

    function beginSnapshotRound() external returns (uint256 roundId) {
        roundId = nextRoundId;
        _beginShardedSnapshot(roundId);
        unchecked {
            ++nextRoundId;
        }
    }

    function snapshotShard(uint256 roundId, uint8 shard) external {
        _snapshotOneShard(roundId, shard);
    }

    function snapshotRoundShard(uint256 roundId, uint8 shard) external {
        _snapshotOneShard(roundId, shard);
    }

    function finalizeSnapshot(uint256 roundId) external {
        _finalizeShardedSnapshot(roundId);
    }

    function completeSnapshotRound(uint256 roundId) external {
        _finalizeShardedSnapshot(roundId);
    }

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        return _encryptedShardedSnapshotWeightOf(roundId, msg.sender);
    }

    function _rosterCurrentWeight(address account) internal view override returns (euint64) {
        return _weights[account];
    }

    function _rosterNextRoundId() internal view override returns (uint256) {
        return nextRoundId;
    }

    function _rosterLatestClosedRoundId() internal view override returns (uint256) {
        uint256 firstClose = uint256(firstDrawOpensAt) + uint256(drawPeriod);
        if (block.timestamp < firstClose) return 0;
        return (block.timestamp - uint256(firstDrawOpensAt)) / uint256(drawPeriod);
    }

    function _rosterScheduledDrawClosesAt(uint256 roundId) internal view override returns (uint64) {
        require(roundId > 0, "Invalid round");
        uint256 opensAt = uint256(firstDrawOpensAt) + ((roundId - 1) * uint256(drawPeriod));
        require(opensAt <= type(uint64).max - uint256(drawPeriod), "Schedule overflow");
        return uint64(opensAt + uint256(drawPeriod));
    }
}
