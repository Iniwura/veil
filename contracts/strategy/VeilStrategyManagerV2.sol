// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Slice 2A intentionally has no governance or prize-transfer surface.
// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming, gas-strict-inequalities
// solhint-disable named-parameters-mapping

import {FHE, ebool, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

import {VeilDepositBatcher} from "./VeilDepositBatcher.sol";
import {VeilWithdrawalBatcher} from "./VeilWithdrawalBatcher.sol";

/// @title VeilStrategyManagerV2
/// @notice Slice 2A strategy custody and conservative confidential solvency accounting.
/// @dev The immutable pool is the only principal-liability writer. Strategy shares and liquid
///      principal balances are read from the configured ERC7984 wrappers, never shadowed.
contract VeilStrategyManagerV2 is ReentrancyGuardTransient, ZamaEthereumConfig {
    uint128 internal constant BPS = 10_000;
    uint8 internal constant FINALIZED_BATCH_STATE = 2;
    uint8 internal constant CANCELED_BATCH_STATE = 3;

    error InvalidAddress();
    error InvalidBps();
    error InvalidHaircut();
    error InvalidRoute();
    error OnlyPool();
    error UnauthorizedCiphertext();
    error UnknownManagerBatch(uint256 batchId);
    error ManagerBatchAlreadyResolved(uint256 batchId);
    error BatchNotResolvable(uint256 batchId, uint8 state);

    address public immutable pool;
    IERC7984ERC20Wrapper public immutable principalAsset;
    IERC7984ERC20Wrapper public immutable strategyShareAsset;
    VeilDepositBatcher public immutable depositBatcher;
    VeilWithdrawalBatcher public immutable withdrawalBatcher;
    IERC4626 public immutable vault;
    uint16 public immutable bufferReserveBps;
    uint16 public immutable valuationHaircutBps;

    euint64 internal _principalLiability;
    mapping(uint256 batchId => bool recognized) private _managerDepositBatches;
    mapping(uint256 batchId => bool resolved) private _managerDepositBatchResolved;

    event PrincipalDepositRecorded(address indexed account);
    event DepositBatchInvested(uint256 indexed batchId);
    event DepositBatchResolved(uint256 indexed batchId, uint8 indexed state);

    constructor(
        address pool_,
        IERC7984ERC20Wrapper principalAsset_,
        IERC7984ERC20Wrapper strategyShareAsset_,
        VeilDepositBatcher depositBatcher_,
        VeilWithdrawalBatcher withdrawalBatcher_,
        IERC4626 vault_,
        uint16 bufferReserveBps_,
        uint16 valuationHaircutBps_
    ) ZamaEthereumConfig() {
        if (
            pool_ == address(0) ||
            address(principalAsset_) == address(0) ||
            address(strategyShareAsset_) == address(0) ||
            address(depositBatcher_) == address(0) ||
            address(withdrawalBatcher_) == address(0) ||
            address(vault_) == address(0)
        ) {
            revert InvalidAddress();
        }
        if (bufferReserveBps_ > BPS) revert InvalidBps();
        if (valuationHaircutBps_ >= BPS) revert InvalidHaircut();

        if (
            address(depositBatcher_.fromToken()) != address(principalAsset_) ||
            address(depositBatcher_.toToken()) != address(strategyShareAsset_) ||
            address(withdrawalBatcher_.fromToken()) != address(strategyShareAsset_) ||
            address(withdrawalBatcher_.toToken()) != address(principalAsset_) ||
            address(depositBatcher_.vault()) != address(vault_) ||
            address(withdrawalBatcher_.vault()) != address(vault_) ||
            principalAsset_.underlying() != vault_.asset() ||
            strategyShareAsset_.underlying() != address(vault_)
        ) {
            revert InvalidRoute();
        }

        pool = pool_;
        principalAsset = principalAsset_;
        strategyShareAsset = strategyShareAsset_;
        depositBatcher = depositBatcher_;
        withdrawalBatcher = withdrawalBatcher_;
        vault = vault_;
        bufferReserveBps = bufferReserveBps_;
        valuationHaircutBps = valuationHaircutBps_;

        _principalLiability = FHE.asEuint64(0);
        FHE.allowThis(_principalLiability);
    }

    /// @notice Returns the encrypted aggregate principal liability handle.
    /// @dev This does not grant any caller decryption permission.
    function principalLiability() external view returns (euint64) {
        return _principalLiability;
    }

    function managerDepositBatch(uint256 batchId) external view returns (bool) {
        return _managerDepositBatches[batchId];
    }

    function managerDepositBatchResolved(uint256 batchId) external view returns (bool) {
        return _managerDepositBatchResolved[batchId];
    }

    /// @notice Records the exact encrypted amount transferred by the immutable pool.
    /// @dev The pool must transiently allow this ciphertext to the manager in the same
    /// transaction that moved the confidential asset into manager custody.
    function recordPrincipalDeposit(address account, euint64 transferred) external {
        if (msg.sender != pool) revert OnlyPool();
        if (!FHE.isAllowed(transferred, address(this))) revert UnauthorizedCiphertext();

        _principalLiability = FHESafeMath.saturatingAdd(_principalLiability, transferred);
        FHE.allowThis(_principalLiability);
        emit PrincipalDepositRecorded(account);
    }

    /// @notice Invests the encrypted excess above the immutable buffer reserve.
    /// @dev The caller supplies no amount. The amount is derived from live confidential
    /// balances and is joined to the current permissionless deposit batch.
    function investExcess() external nonReentrant {
        uint256 batchId = depositBatcher.currentBatchId();
        euint64 investable = _investableBuffer();

        // The token call checks that its caller can use the encrypted amount. This transient
        // allowance is deliberately scoped to the manager transaction.
        FHE.allowTransient(investable, address(this));
        FHE.allowTransient(investable, address(principalAsset));
        principalAsset.confidentialTransferAndCall(address(depositBatcher), investable, "");

        _managerDepositBatches[batchId] = true;
        emit DepositBatchInvested(batchId);
    }

    /// @notice Permissionlessly claims or refunds one manager-recognized deposit batch.
    /// @dev No caller-supplied amount is accepted. The configured ERC7984 share wrapper or
    /// principal wrapper remains the authoritative balance after the operation.
    function resolveDepositBatch(uint256 batchId) external nonReentrant {
        if (!_managerDepositBatches[batchId]) revert UnknownManagerBatch(batchId);
        if (_managerDepositBatchResolved[batchId]) revert ManagerBatchAlreadyResolved(batchId);

        uint8 state = uint8(depositBatcher.batchState(batchId));
        if (state == FINALIZED_BATCH_STATE) {
            depositBatcher.claim(batchId, address(this));
        } else if (state == CANCELED_BATCH_STATE) {
            depositBatcher.quit(batchId);
        } else {
            revert BatchNotResolvable(batchId, state);
        }

        _managerDepositBatchResolved[batchId] = true;
        emit DepositBatchResolved(batchId, state);
    }

    function _targetBuffer() internal returns (euint64) {
        euint128 liability128 = FHE.asEuint128(_principalLiability);
        euint128 scaled = FHE.mul(liability128, uint128(bufferReserveBps));
        euint128 rounded = FHE.add(scaled, BPS - 1);
        return FHE.asEuint64(FHE.div(rounded, BPS));
    }

    function _investableBuffer() internal returns (euint64) {
        euint64 buffer = principalAsset.confidentialBalanceOf(address(this));
        return FHESafeMath.saturatingSub(buffer, _targetBuffer());
    }

    function _uncoveredPrincipal(euint64 buffer) internal returns (euint64) {
        return FHESafeMath.saturatingSub(_principalLiability, buffer);
    }

    /// @dev Returns (conservative assets represented by one confidential share unit,
    /// shareScale). A zero first value is the fail-closed valuation sentinel.
    function _conservativeValuation() internal view returns (uint256, uint256) {
        uint8 shareDecimals;
        uint256 shareRate;
        uint256 principalRate;

        try strategyShareAsset.decimals() returns (uint8 decimals_) {
            shareDecimals = decimals_;
        } catch {
            return (0, 0);
        }
        // The euint128 required-share numerator must safely hold uint64 * shareScale.
        if (shareDecimals > 19) return (0, 0);

        uint256 shareScale = 10 ** uint256(shareDecimals);
        try strategyShareAsset.rate() returns (uint256 rate_) {
            shareRate = rate_;
        } catch {
            return (0, 0);
        }
        if (shareRate == 0 || shareScale > type(uint256).max / shareRate) return (0, 0);

        uint256 rawShareProbe = shareScale * shareRate;
        uint256 rawAssetsForProbe;
        try vault.previewRedeem(rawShareProbe) returns (uint256 assets_) {
            rawAssetsForProbe = assets_;
        } catch {
            return (0, 0);
        }

        try principalAsset.rate() returns (uint256 rate_) {
            principalRate = rate_;
        } catch {
            return (0, 0);
        }
        if (principalRate == 0) return (0, 0);

        uint256 assetUnitsForProbe = rawAssetsForProbe / principalRate;
        uint256 haircutFactor = uint256(BPS) - valuationHaircutBps;
        if (assetUnitsForProbe > type(uint256).max / haircutFactor) return (0, 0);

        uint256 conservativeAssetsForProbe = (assetUnitsForProbe * haircutFactor) / BPS;
        if (conservativeAssetsForProbe == 0 || conservativeAssetsForProbe > type(uint128).max) {
            return (0, 0);
        }
        return (conservativeAssetsForProbe, shareScale);
    }

    /// @dev Calculates ceil(uncovered * shareScale / conservativeValue) without adding
    /// conservativeValue - 1 to the encrypted numerator, which avoids an encrypted overflow.
    function _requiredShares(
        euint64 uncovered,
        uint256 shareScale,
        uint256 conservativeValue
    ) internal returns (euint128) {
        if (
            conservativeValue == 0 ||
            shareScale == 0 ||
            shareScale > type(uint64).max ||
            conservativeValue > type(uint128).max
        ) {
            return FHE.asEuint128(0);
        }

        euint128 product = FHE.mul(FHE.asEuint128(uncovered), uint128(shareScale));
        euint128 quotient = FHE.div(product, uint128(conservativeValue));
        euint128 remainder = FHE.rem(product, uint128(conservativeValue));
        ebool hasRemainder = FHE.ne(remainder, FHE.asEuint128(0));
        return FHE.add(quotient, FHE.asEuint128(hasRemainder));
    }

    function _safeSurplusShares() internal returns (euint64) {
        (uint256 conservativeValue, uint256 shareScale) = _conservativeValuation();
        if (conservativeValue == 0) return FHE.asEuint64(0);

        euint64 buffer = principalAsset.confidentialBalanceOf(address(this));
        euint64 uncovered = _uncoveredPrincipal(buffer);
        euint128 required = _requiredShares(uncovered, shareScale, conservativeValue);
        euint128 shareBalance = FHE.asEuint128(strategyShareAsset.confidentialBalanceOf(address(this)));
        euint128 reserved = FHE.min(shareBalance, required);
        return FHE.asEuint64(FHE.sub(shareBalance, reserved));
    }
}
