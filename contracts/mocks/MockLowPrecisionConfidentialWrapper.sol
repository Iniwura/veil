// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This is a rate-conversion fixture, not a Zama official asset.
// solhint-disable use-natspec, max-line-length

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title MockLowPrecisionConfidentialWrapper
/// @notice Test-only low-precision wrapper proving route rate conversion is not hardcoded to one.
contract MockLowPrecisionConfidentialWrapper is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_
    )
        ERC7984("TEST Low Precision Confidential", "t-low", "test-only://low-precision")
        ERC7984ERC20Wrapper(underlying_)
    {}

    function _maxDecimals() internal pure override returns (uint8) {
        return 3;
    }
}
