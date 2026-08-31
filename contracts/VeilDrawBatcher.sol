// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, immutable-vars-naming

interface IVeilDrawBatchTarget {
    function finalizePrizeShard(
        uint256 roundId,
        uint8 prizeIndex,
        uint8 shard,
        bytes calldata decryptionProof
    ) external;

    function drawPrizeMember(uint256 roundId, uint8 prizeIndex) external;
}

/// @title VeilDrawBatcher
/// @notice Combines proof-gated shard finalization and the dependent member draw atomically.
/// @dev The KMS/public proof is still supplied between the two stages; only the two on-chain
///      calls are fused. The target pool remains the authority for all lifecycle checks.
contract VeilDrawBatcher {
    error InvalidTarget();

    IVeilDrawBatchTarget public immutable pool;

    constructor(IVeilDrawBatchTarget target_) {
        if (address(target_) == address(0)) revert InvalidTarget();
        pool = target_;
    }

    function finalizePrizeShardAndDrawMember(
        uint256 roundId,
        uint8 prizeIndex,
        uint8 shard,
        bytes calldata decryptionProof
    ) external {
        pool.finalizePrizeShard(roundId, prizeIndex, shard, decryptionProof);
        pool.drawPrizeMember(roundId, prizeIndex);
    }
}
