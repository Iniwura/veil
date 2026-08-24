// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. Simulated donations are not market yield.
// solhint-disable use-natspec, gas-custom-errors

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockYieldVault4626
/// @notice Test-only standards-based ERC-4626 vault over MockUSDC.
/// @dev `donate` increases the public share price without minting shares. Failure toggles only
///      exist to exercise route cancellation and are not production controls.
contract MockYieldVault4626 is ERC4626 {
    using SafeERC20 for IERC20;

    bool public depositFailure;
    bool public redeemFailure;

    constructor(IERC20 asset_) ERC20("TEST Mock Yield Vault Share", "tMYVS") ERC4626(asset_) {}

    function donate(uint256 amount) external {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
    }

    function setDepositFailure(bool enabled) external {
        depositFailure = enabled;
    }

    function setRedeemFailure(bool enabled) external {
        redeemFailure = enabled;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        require(!depositFailure, "TEST deposit failure");
        return super.deposit(assets, receiver);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        require(!redeemFailure, "TEST redeem failure");
        return super.redeem(shares, receiver, owner);
    }
}
