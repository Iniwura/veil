// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This is an ERC7984 wrapper for a local fixture, not a Zama official asset.
// solhint-disable use-natspec, max-line-length

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title MockYieldVaultShareConfidentialWrapper
/// @notice Test-only confidential wrapper around MockYieldVault4626 shares.
contract MockYieldVaultShareConfidentialWrapper is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_
    )
        ERC7984("TEST Mock Yield Vault Shares Confidential", "t-cMYVS", "test-only://mock-vault-shares")
        ERC7984ERC20Wrapper(underlying_)
    {}
}
