// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Slice 1 implementation: route timing is deliberately separate from economic accounting.
// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming, gas-strict-inequalities

import {BatcherConfidential} from "@openzeppelin/confidential-contracts/finance/BatcherConfidential.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Shared permissionless age gate for the Slice 1 confidential routes.
/// @dev OpenZeppelin's batcher has no timing policy. The next batch starts its age window only
///      after the previous dispatch succeeds; callback settlement never changes this timestamp.
abstract contract VeilTimedBatcher is BatcherConfidential, ZamaEthereumConfig {
    uint64 public immutable minimumBatchAge;
    uint64 public currentBatchOpenedAt;

    constructor(
        IERC7984ERC20Wrapper fromToken_,
        IERC7984ERC20Wrapper toToken_,
        uint64 minimumBatchAge_
    ) BatcherConfidential(fromToken_, toToken_) ZamaEthereumConfig() {
        require(block.timestamp <= type(uint64).max, "Timestamp overflow");
        minimumBatchAge = minimumBatchAge_;
        currentBatchOpenedAt = uint64(block.timestamp);
    }

    /// @notice Dispatches the current batch after the configured accumulation age.
    /// @dev Anyone may dispatch once mature. The base implementation advances currentBatchId.
    function dispatchBatch() public virtual override {
        require(block.timestamp >= uint256(currentBatchOpenedAt) + minimumBatchAge, "Batch not mature");
        super.dispatchBatch();
        currentBatchOpenedAt = uint64(block.timestamp);
    }
}
