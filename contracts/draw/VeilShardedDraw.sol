// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-struct-packing
// solhint-disable named-parameters-mapping

import {FHE, ebool, eaddress, euint8, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {VeilShardedSnapshot} from "./VeilShardedSnapshot.sol";

/// @title VeilShardedDraw
/// @notice Two-stage encrypted weighted selection for a 24 x 24 sharded saver roster.
/// @dev Stage one selects one of 24 shards by its encrypted mature weight. After a KMS proof reveals only
///      that shard index, stage two selects one saver inside that shard using the same encrypted weighted rule.
///      Each FHE scan is therefore bounded at 24 entries even when all 576 active seats are occupied.
abstract contract VeilShardedDraw is VeilShardedSnapshot {
    uint8 public constant SHARDED_PRIZE_SLOTS = 3;

    struct ShardedPrizeResult {
        euint8 encryptedShard;
        uint8 shard;
        eaddress encryptedWinner;
        address winner;
        bool shardDrawn;
        bool shardFinalized;
        bool winnerDrawn;
        bool winnerFinalized;
    }

    mapping(uint256 => mapping(uint8 => ShardedPrizeResult)) private _shardedPrizeResults;

    event PrizeShardDrawn(uint256 indexed roundId, uint8 indexed prizeIndex, euint8 encryptedShard);
    event PrizeShardFinalized(uint256 indexed roundId, uint8 indexed prizeIndex, uint8 indexed shard);
    event PrizeMemberDrawn(uint256 indexed roundId, uint8 indexed prizeIndex, eaddress encryptedWinner);
    event PrizeMemberFinalized(uint256 indexed roundId, uint8 indexed prizeIndex, address indexed winner);

    function drawPrizeShard(uint256 roundId, uint8 prizeIndex) public virtual {
        _requirePrizeIndex(prizeIndex);
        (, , , , , bool snapshotFinalized) = getShardedSnapshotRound(roundId);
        require(snapshotFinalized, "Snapshot not finalized");

        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(!prize.shardDrawn, "Prize shard already drawn");

        euint64 target = _weightedTarget(_encryptedShardedSnapshotTotal(roundId));
        prize.encryptedShard = _selectShard(roundId, target);
        prize.shardDrawn = true;

        FHE.allowThis(prize.encryptedShard);
        FHE.makePubliclyDecryptable(prize.encryptedShard);
        emit PrizeShardDrawn(roundId, prizeIndex, prize.encryptedShard);
    }

    function finalizePrizeShard(
        uint256 roundId,
        uint8 prizeIndex,
        uint8 shard,
        bytes calldata decryptionProof
    ) public virtual {
        _requirePrizeIndex(prizeIndex);
        require(shard < SHARD_COUNT, "Invalid shard");

        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.shardDrawn, "Prize shard not drawn");
        require(!prize.shardFinalized, "Prize shard already finalized");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(prize.encryptedShard);
        FHE.checkSignatures(handles, abi.encode(shard), decryptionProof);

        prize.shard = shard;
        prize.shardFinalized = true;
        emit PrizeShardFinalized(roundId, prizeIndex, shard);
    }

    function drawPrizeMember(uint256 roundId, uint8 prizeIndex) public virtual {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.shardFinalized, "Prize shard not finalized");
        require(!prize.winnerDrawn, "Prize member already drawn");

        uint8 shard = prize.shard;
        euint64 target = _weightedTarget(_encryptedSnapshotShardTotal(roundId, shard));
        prize.encryptedWinner = _selectMember(roundId, shard, target);
        prize.winnerDrawn = true;

        FHE.allowThis(prize.encryptedWinner);
        FHE.makePubliclyDecryptable(prize.encryptedWinner);
        emit PrizeMemberDrawn(roundId, prizeIndex, prize.encryptedWinner);
    }

    function finalizePrizeMember(
        uint256 roundId,
        uint8 prizeIndex,
        bytes calldata abiEncodedClearWinner,
        bytes calldata decryptionProof
    ) public virtual {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.winnerDrawn, "Prize member not drawn");
        require(!prize.winnerFinalized, "Prize member already finalized");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(prize.encryptedWinner);
        FHE.checkSignatures(handles, abiEncodedClearWinner, decryptionProof);

        address clearWinner = abi.decode(abiEncodedClearWinner, (address));
        prize.winner = clearWinner;
        prize.winnerFinalized = true;
        emit PrizeMemberFinalized(roundId, prizeIndex, clearWinner);
    }

    function getShardedPrizeStatus(
        uint256 roundId,
        uint8 prizeIndex
    )
        public
        view
        returns (
            bool shardDrawn,
            bool shardFinalized,
            uint8 shard,
            bool winnerDrawn,
            bool winnerFinalized,
            address winner
        )
    {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        return (
            prize.shardDrawn,
            prize.shardFinalized,
            prize.shard,
            prize.winnerDrawn,
            prize.winnerFinalized,
            prize.winner
        );
    }

    function getEncryptedPrizeShard(uint256 roundId, uint8 prizeIndex) public view returns (euint8) {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.shardDrawn, "Prize shard unavailable");
        return prize.encryptedShard;
    }

    function getEncryptedPrizeMember(uint256 roundId, uint8 prizeIndex) public view returns (eaddress) {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.winnerDrawn, "Prize member unavailable");
        return prize.encryptedWinner;
    }

    function getPrizeMember(uint256 roundId, uint8 prizeIndex) public view returns (address) {
        _requirePrizeIndex(prizeIndex);
        ShardedPrizeResult storage prize = _shardedPrizeResults[roundId][prizeIndex];
        require(prize.winnerFinalized, "Prize member not finalized");
        return prize.winner;
    }

    function _weightedTarget(euint64 encryptedTotalWeight) private returns (euint64) {
        euint64 randomValue = FHE.randEuint64();
        euint128 product = FHE.mul(FHE.asEuint128(randomValue), FHE.asEuint128(encryptedTotalWeight));
        return FHE.asEuint64(FHE.shr(product, 64));
    }

    function _selectShard(uint256 roundId, euint64 target) private returns (euint8 selectedShard) {
        euint64 cumulative = FHE.asEuint64(0);
        ebool selected = FHE.asEbool(false);
        selectedShard = FHE.asEuint8(0);

        for (uint8 shard = 0; shard < SHARD_COUNT; shard++) {
            cumulative = FHE.add(cumulative, _encryptedSnapshotShardTotal(roundId, shard));
            ebool crossesTarget = FHE.lt(target, cumulative);
            ebool chooseThisShard = FHE.and(crossesTarget, FHE.not(selected));
            selectedShard = FHE.select(chooseThisShard, FHE.asEuint8(shard), selectedShard);
            selected = FHE.or(selected, crossesTarget);
        }
    }

    function _selectMember(
        uint256 roundId,
        uint8 shard,
        euint64 target
    ) private returns (eaddress winner) {
        uint8 participantCount = _snapshotShardParticipantCount(roundId, shard);
        euint64 cumulative = FHE.asEuint64(0);
        ebool selected = FHE.asEbool(false);
        winner = FHE.asEaddress(address(0));

        for (uint8 index = 0; index < participantCount; index++) {
            cumulative = FHE.add(cumulative, _snapshotWeightAt(roundId, shard, index));
            ebool crossesTarget = FHE.lt(target, cumulative);
            ebool chooseThisPlayer = FHE.and(crossesTarget, FHE.not(selected));
            winner = FHE.select(chooseThisPlayer, FHE.asEaddress(_snapshotPlayerAt(roundId, shard, index)), winner);
            selected = FHE.or(selected, crossesTarget);
        }
    }

    function _requirePrizeIndex(uint8 prizeIndex) private pure {
        require(prizeIndex < SHARDED_PRIZE_SLOTS, "Invalid prize index");
    }
}
