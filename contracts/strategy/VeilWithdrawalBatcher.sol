// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Slice 1 implementation: this route is not an UNVEIL manager and has no manager-only callback.
// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";

import {VeilTimedBatcher} from "./VeilTimedBatcher.sol";

/// @title VeilWithdrawalBatcher
/// @notice Routes confidential ERC-4626 shares back into the confidential underlying wrapper.
/// @dev The batcher owns the plain shares during route execution and redeems them to itself.
contract VeilWithdrawalBatcher is VeilTimedBatcher {
    IERC4626 public immutable vault;

    constructor(
        IERC7984ERC20Wrapper fromToken_,
        IERC7984ERC20Wrapper toToken_,
        IERC4626 vault_,
        uint64 minimumBatchAge_
    ) VeilTimedBatcher(fromToken_, toToken_, minimumBatchAge_) {
        require(address(vault_) != address(0), "Invalid vault");
        require(fromToken_.underlying() == address(vault_), "Invalid from asset");
        require(toToken_.underlying() == vault_.asset(), "Invalid to asset");

        vault = vault_;
    }

    function routeDescription() public pure override returns (string memory) {
        return "TEST/DEMO confidential ERC4626 shares to underlying";
    }

    /// @dev `amount` is the cleartext amount in fromToken wrapper units.
    function _executeRoute(uint256, uint256 amount) internal override returns (ExecuteOutcome) {
        uint256 rate = fromToken().rate();
        if (rate == 0 || amount > type(uint256).max / rate) return ExecuteOutcome.Cancel;

        uint256 rawShares = amount * rate;
        try vault.redeem(rawShares, address(this), address(this)) returns (uint256) {
            return ExecuteOutcome.Complete;
        } catch {
            return ExecuteOutcome.Cancel;
        }
    }
}
