// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST ONLY: configuration-boundary fixture; it has no custody or strategy behavior.
// solhint-disable use-natspec, immutable-vars-naming
contract MockVeilStrategyManagerConfig {
    address public immutable pool;
    address public immutable principalAsset;

    constructor(address pool_, address principalAsset_) {
        pool = pool_;
        principalAsset = principalAsset_;
    }
}
