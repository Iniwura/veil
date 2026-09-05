// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Slice 1 implementation: this route is not an UNVEIL manager and has no manager-only callback.
// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";

import {VeilTimedBatcher} from "./VeilTimedBatcher.sol";

/// @title VeilDepositBatcher
/// @notice Routes a confidential wrapped underlying asset into ERC-4626 shares.
/// @dev All addresses are immutable. The v1 route is one synchronous ERC-4626 deposit after
///      the wrapper's asynchronous aggregate unwrap has been proven.
contract VeilDepositBatcher is VeilTimedBatcher {
    using SafeERC20 for IERC20;

    error DepositPreviewMismatch(uint256 expectedShares, uint256 actualShares);
    error DepositToTokenRateChanged(uint256 expectedRate, uint256 actualRate);

    IERC4626 public immutable vault;

    constructor(
        IERC7984ERC20Wrapper fromToken_,
        IERC7984ERC20Wrapper toToken_,
        IERC4626 vault_,
        uint64 minimumBatchAge_
    ) VeilTimedBatcher(fromToken_, toToken_, minimumBatchAge_) {
        require(address(vault_) != address(0), "Invalid vault");
        require(fromToken_.underlying() == vault_.asset(), "Invalid from asset");
        require(toToken_.underlying() == address(vault_), "Invalid to asset");

        vault = vault_;
        IERC20(vault_.asset()).forceApprove(address(vault_), type(uint256).max);
    }

    function routeDescription() public pure override returns (string memory) {
        return "UNVEIL confidential underlying to ERC4626 shares";
    }

    /// @dev `amount` is the cleartext amount in fromToken wrapper units. The underlying route
    /// amount is wrapper units multiplied by the wrapper's fixed rate.
    function _executeRoute(uint256, uint256 amount) internal override returns (ExecuteOutcome) {
        uint256 rate = fromToken().rate();
        if (rate == 0 || amount > type(uint256).max / rate) return ExecuteOutcome.Cancel;

        uint256 rawUnderlying = amount * rate;
        uint256 toTokenRate;
        try toToken().rate() returns (uint256 rate_) {
            toTokenRate = rate_;
        } catch {
            return ExecuteOutcome.Cancel;
        }
        if (toTokenRate == 0) return ExecuteOutcome.Cancel;

        uint256 expectedShares;
        try vault.previewDeposit(rawUnderlying) returns (uint256 previewedShares) {
            expectedShares = previewedShares;
        } catch {
            return ExecuteOutcome.Cancel;
        }
        if (expectedShares < toTokenRate) return ExecuteOutcome.Cancel;

        uint256 actualShares;
        try vault.deposit(rawUnderlying, address(this)) returns (uint256 shares) {
            actualShares = shares;
        } catch {
            return ExecuteOutcome.Cancel;
        }

        // Reverting here is intentional. The external deposit has already moved assets, so a
        // mismatched non-standard vault must roll back the entire callback rather than be
        // misreported as a recoverable Cancel by BatcherConfidential.
        if (actualShares != expectedShares) revert DepositPreviewMismatch(expectedShares, actualShares);

        uint256 actualToTokenRate = toToken().rate();
        if (actualToTokenRate != toTokenRate) {
            revert DepositToTokenRateChanged(toTokenRate, actualToTokenRate);
        }
        return ExecuteOutcome.Complete;
    }
}
