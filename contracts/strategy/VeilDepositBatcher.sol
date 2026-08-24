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
        return "TEST/DEMO confidential underlying to ERC4626 shares";
    }

    /// @dev `amount` is the cleartext amount in fromToken wrapper units. The underlying route
    /// amount is wrapper units multiplied by the wrapper's fixed rate.
    function _executeRoute(uint256, uint256 amount) internal override returns (ExecuteOutcome) {
        uint256 rate = fromToken().rate();
        if (rate == 0 || amount > type(uint256).max / rate) return ExecuteOutcome.Cancel;

        uint256 rawUnderlying = amount * rate;
        try vault.deposit(rawUnderlying, address(this)) returns (uint256) {
            return ExecuteOutcome.Complete;
        } catch {
            return ExecuteOutcome.Cancel;
        }
    }
}
