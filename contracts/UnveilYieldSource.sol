// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Competition-build lint suppressions. Revisit before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-indexed-events, immutable-vars-naming

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984YieldAsset {
    function isOperator(address holder, address spender) external view returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

interface IUnveilRoundSource {
    function nextRoundId() external view returns (uint256);

    function getDrawInfo(
        uint256 roundId
    ) external view returns (uint64 snapshotBlock, uint8 participantCount, uint8 state);
}

interface IUnveilPrizeSink {
    function recordPrize(uint256 roundId, euint64 amount) external;
}

/// @title UnveilYieldSource
/// @notice Confidential strategy-adapter boundary for UNVEIL prize yield.
/// @dev Sepolia uses a controlled strategy operator that transfers real cUSDC demo assets here. Production deployment
///      can point this boundary at a reviewed confidential yield strategy without giving that strategy draw control.
///      Realized yield is assigned to rounds in strict sequence, so permissionless keepers cannot redirect it.
contract UnveilYieldSource is ZamaEthereumConfig {
    address public immutable strategyOperator;
    IERC7984YieldAsset public immutable asset;
    IUnveilRoundSource public immutable pool;
    address public prizeVault;

    uint256 public yieldRoundId = 1;
    bool public yieldReady;
    euint64 private unallocatedYield;

    event PrizeVaultConfigured(address indexed prizeVault);
    event YieldAccrued(uint256 indexed roundId);
    event YieldSealed(uint256 indexed roundId);
    event YieldAllocated(uint256 indexed roundId);
    event CancelledYieldCarried(uint256 indexed fromRoundId, uint256 indexed toRoundId);

    modifier onlyStrategy() {
        require(msg.sender == strategyOperator, "Only strategy");
        _;
    }

    constructor(address asset_, address pool_, address strategyOperator_) {
        require(asset_ != address(0), "Invalid asset");
        require(pool_ != address(0), "Invalid pool");
        require(strategyOperator_ != address(0), "Invalid strategy");
        strategyOperator = strategyOperator_;
        asset = IERC7984YieldAsset(asset_);
        pool = IUnveilRoundSource(pool_);

        unallocatedYield = FHE.asEuint64(0);
        FHE.allowThis(unallocatedYield);
    }

    function configurePrizeVault(address prizeVault_) external onlyStrategy {
        require(prizeVault == address(0), "Prize vault configured");
        require(prizeVault_ != address(0), "Invalid prize vault");
        prizeVault = prizeVault_;
        emit PrizeVaultConfigured(prizeVault_);
    }

    function accrueYield(externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyStrategy {
        require(!yieldReady, "Yield already sealed");
        require(asset.isOperator(msg.sender, address(this)), "Yield source not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);
        unallocatedYield = FHE.add(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        emit YieldAccrued(yieldRoundId);
    }

    function sealRoundYield() external onlyStrategy {
        require(!yieldReady, "Yield already sealed");
        require(yieldRoundId < pool.nextRoundId(), "Round still open");
        yieldReady = true;
        emit YieldSealed(yieldRoundId);
    }

    function allocateRoundYield(uint256 roundId) external {
        require(prizeVault != address(0), "Prize vault not configured");
        require(roundId == yieldRoundId, "Wrong yield round");
        require(yieldReady, "Yield not ready");

        (, , uint8 state) = pool.getDrawInfo(roundId);
        require(state == 3, "Round not finalized");

        euint64 allocation = unallocatedYield;
        FHE.allowTransient(allocation, address(asset));
        euint64 transferred = asset.confidentialTransfer(prizeVault, allocation);

        unallocatedYield = FHE.sub(unallocatedYield, transferred);
        FHE.allowThis(unallocatedYield);

        FHE.allowTransient(transferred, prizeVault);
        IUnveilPrizeSink(prizeVault).recordPrize(roundId, transferred);

        unchecked {
            yieldRoundId = roundId + 1;
        }
        yieldReady = false;
        emit YieldAllocated(roundId);
    }

    function carryCancelledYield(uint256 roundId) external {
        require(roundId == yieldRoundId, "Wrong yield round");
        require(yieldReady, "Yield not ready");

        (, , uint8 state) = pool.getDrawInfo(roundId);
        require(state == 4, "Round not cancelled");

        unchecked {
            yieldRoundId = roundId + 1;
        }
        yieldReady = false;
        emit CancelledYieldCarried(roundId, yieldRoundId);
    }
}
