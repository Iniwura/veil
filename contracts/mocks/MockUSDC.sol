// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This is not USDC and is not a production cUSDC substitute.
// solhint-disable use-natspec, gas-custom-errors

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Test-only six-decimal ERC-20 with explicit minting and no transfer fees.
contract MockUSDC is ERC20 {
    constructor() ERC20("TEST Mock USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
