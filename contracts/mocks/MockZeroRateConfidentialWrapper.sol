// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This deliberately unusable wrapper exercises fail-closed valuation.
// solhint-disable use-natspec, max-line-length

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MockZeroRateConfidentialWrapper is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_
    ) ERC7984("TEST Zero Rate Confidential", "t-zero", "test-only://zero-rate") ERC7984ERC20Wrapper(underlying_) {}

    function rate() public pure override returns (uint256) {
        return 0;
    }
}
