// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This harness models the future VeilPoolV2 custody boundary.
// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {VeilStrategyManagerV2} from "../strategy/VeilStrategyManagerV2.sol";

/// @title VeilStrategyPoolHarness
/// @notice Test-only pool boundary that records the actual confidential transfer result.
contract VeilStrategyPoolHarness is ZamaEthereumConfig {
    IERC7984 public immutable principalAsset;
    address public immutable deployer;
    address public manager;
    bool public managerConfigured;

    constructor(IERC7984 principalAsset_) ZamaEthereumConfig() {
        require(address(principalAsset_) != address(0), "Invalid asset");
        principalAsset = principalAsset_;
        deployer = msg.sender;
    }

    function configureManager(address manager_) external {
        require(msg.sender == deployer, "Not deployer");
        require(!managerConfigured, "Manager already configured");
        require(manager_ != address(0), "Invalid manager");
        manager = manager_;
        managerConfigured = true;
    }

    /// @dev The caller must have made this harness an ERC7984 operator for account.
    function depositFor(
        address account,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64 transferred) {
        require(managerConfigured, "Manager not configured");
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(principalAsset));
        transferred = principalAsset.confidentialTransferFrom(account, manager, requested);
        FHE.allowTransient(transferred, manager);
        VeilStrategyManagerV2(manager).recordPrincipalDeposit(account, transferred);
    }
}
