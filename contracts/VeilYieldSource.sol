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
/// @notice Confidentially accounts for realized yield before allocating it to round prizes.
/// @dev The owner represents the strategy adapter in V0.2. Every credited unit must be backed by an actual
///      confidential asset transfer into this contract. A production strategy can replace this adapter boundary.
contract VeilYieldSource is ZamaEthereumConfig {
    address public immutable owner;
    IERC7984YieldAsset public immutable asset;
    address public prizeVault;

    euint64 private unallocatedYield;

    event PrizeVaultConfigured(address indexed prizeVault);
    event YieldAccrued();
    event YieldAllocated(uint256 indexed roundId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address asset_) {
        require(asset_ != address(0), "Invalid asset");
        owner = msg.sender;
        asset = IERC7984YieldAsset(asset_);

        unallocatedYield = FHE.asEuint64(0);
        FHE.allowThis(unallocatedYield);
    }

    /// @notice One-time wiring to the confidential prize vault.
    function configurePrizeVault(address prizeVault_) external onlyOwner {
        require(prizeVault == address(0), "Prize vault configured");
        require(prizeVault_ != address(0), "Invalid prize vault");
        prizeVault = prizeVault_;
        emit PrizeVaultConfigured(prizeVault_);
    }

    /// @notice Credits only confidential assets actually transferred from the strategy adapter.
    function accrueYield(externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyOwner {
        require(asset.isOperator(msg.sender, address(this)), "Yield source not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);
        unallocatedYield = FHE.add(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        emit YieldAccrued();
    }

    /// @notice Allocates the full requested amount or zero when realized yield is insufficient.
    function allocateToRound(
        uint256 roundId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner {
        require(prizeVault != address(0), "Prize vault not configured");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // Preserve ERC-7984-style all-or-zero behavior against VEIL's own encrypted
        // yield accounting. Never clamp an oversized request to the remaining yield.
        euint64 permitted = FHE.select(
            FHE.le(requested, unallocatedYield),
            requested,
            FHE.asEuint64(0)
        );

        FHE.allowTransient(permitted, address(asset));
        euint64 transferred = asset.confidentialTransfer(prizeVault, permitted);
        unallocatedYield = FHE.sub(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        FHE.allowTransient(transferred, prizeVault);
        IVeilPrizeSink(prizeVault).recordPrize(roundId, transferred);

        emit YieldAllocated(roundId);
    }
}
