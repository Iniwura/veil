// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions. Revisit before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-indexed-events, immutable-vars-naming

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984YieldAsset {
    function isOperator(address holder, address spender) external view returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

interface IVeilPrizeSink {
    function recordPrize(uint256 roundId, euint64 amount) external;
}

/// @title VeilYieldSource
/// @notice Confidential strategy-adapter boundary for UNVEIL prize yield.
/// @dev Sepolia uses a controlled strategy operator that transfers real demo assets here. Production deployment can
///      point this boundary at a reviewed confidential yield strategy without giving that strategy draw control.
contract VeilYieldSource is ZamaEthereumConfig {
    address public immutable strategyOperator;
    IERC7984YieldAsset public immutable asset;
    address public prizeVault;

    euint64 private unallocatedYield;

    event PrizeVaultConfigured(address indexed prizeVault);
    event YieldAccrued();
    event YieldAllocated(uint256 indexed roundId);

    modifier onlyStrategy() {
        require(msg.sender == strategyOperator, "Only strategy");
        _;
    }

    constructor(address asset_, address strategyOperator_) {
        require(asset_ != address(0), "Invalid asset");
        require(strategyOperator_ != address(0), "Invalid strategy");
        strategyOperator = strategyOperator_;
        asset = IERC7984YieldAsset(asset_);

        unallocatedYield = FHE.asEuint64(0);
        FHE.allowThis(unallocatedYield);
    }

    /// @notice One-time wiring to the confidential prize vault.
    function configurePrizeVault(address prizeVault_) external onlyStrategy {
        require(prizeVault == address(0), "Prize vault configured");
        require(prizeVault_ != address(0), "Invalid prize vault");
        prizeVault = prizeVault_;
        emit PrizeVaultConfigured(prizeVault_);
    }

    /// @notice Credits only confidential assets actually transferred from the configured strategy operator.
    function accrueYield(externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyStrategy {
        require(asset.isOperator(msg.sender, address(this)), "Yield source not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);
        unallocatedYield = FHE.add(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        emit YieldAccrued();
    }

    /// @notice Permissionlessly routes all currently realized confidential yield to a finalized round.
    /// @dev The caller cannot choose or learn the amount. PrizeVault verifies that the round has a finalized winner.
    function allocateAllToRound(uint256 roundId) external {
        require(prizeVault != address(0), "Prize vault not configured");

        euint64 allocation = unallocatedYield;
        FHE.allowTransient(allocation, address(asset));
        euint64 transferred = asset.confidentialTransfer(prizeVault, allocation);

        unallocatedYield = FHE.sub(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        FHE.allowTransient(transferred, prizeVault);
        IVeilPrizeSink(prizeVault).recordPrize(roundId, transferred);

        emit YieldAllocated(roundId);
    }
}
