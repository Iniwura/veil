// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. These ACL-granting views must never be added to the production manager.
// solhint-disable use-natspec, immutable-vars-naming

import {FHE, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";

import {VeilDepositBatcher} from "../strategy/VeilDepositBatcher.sol";
import {VeilWithdrawalBatcher} from "../strategy/VeilWithdrawalBatcher.sol";
import {VeilStrategyManagerV2} from "../strategy/VeilStrategyManagerV2.sol";

/// @title VeilStrategyManagerV2TestHarness
/// @notice Test-only manager exposing selected encrypted handles to the caller for assertions.
contract VeilStrategyManagerV2TestHarness is VeilStrategyManagerV2 {
    euint64 public lastPrincipalLiability;
    euint64 public lastBuffer;
    euint64 public lastTargetBuffer;
    euint64 public lastInvestable;
    euint64 public lastUncoveredPrincipal;
    euint128 public lastRequiredShares;
    euint64 public lastShareBalance;
    euint64 public lastSafeSurplusShares;
    euint64 public lastManagerBatchDeposit;
    uint256 public lastConservativeValue;
    uint256 public lastShareScale;

    constructor(
        address pool_,
        IERC7984ERC20Wrapper principalAsset_,
        IERC7984ERC20Wrapper strategyShareAsset_,
        VeilDepositBatcher depositBatcher_,
        VeilWithdrawalBatcher withdrawalBatcher_,
        IERC4626 vault_,
        uint16 bufferReserveBps_,
        uint16 valuationHaircutBps_
    )
        VeilStrategyManagerV2(
            pool_,
            principalAsset_,
            strategyShareAsset_,
            depositBatcher_,
            withdrawalBatcher_,
            vault_,
            bufferReserveBps_,
            valuationHaircutBps_
        )
    {}

    /// @dev Grants only the calling test account access to this snapshot of the encrypted
    /// accounting handles. No such method exists on the production manager.
    function exposeAccountingForTest() external {
        euint64 liability = _principalLiability;
        euint64 buffer = principalAsset.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(buffer)) buffer = FHE.asEuint64(0);
        euint64 target = _targetBuffer();
        euint64 investable = _investableBuffer();
        euint64 uncovered = _uncoveredPrincipal(buffer);
        (uint256 conservativeValue, uint256 shareScale) = _conservativeValuation();
        euint128 required = _requiredShares(uncovered, shareScale, conservativeValue);
        euint64 shareBalance = strategyShareAsset.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(shareBalance)) shareBalance = FHE.asEuint64(0);
        euint64 safeSurplus = _safeSurplusShares();

        lastPrincipalLiability = liability;
        lastBuffer = buffer;
        lastTargetBuffer = target;
        lastInvestable = investable;
        lastUncoveredPrincipal = uncovered;
        lastRequiredShares = required;
        lastShareBalance = shareBalance;
        lastSafeSurplusShares = safeSurplus;
        lastConservativeValue = conservativeValue;
        lastShareScale = shareScale;

        FHE.allowThis(liability);
        FHE.allowThis(buffer);
        FHE.allowThis(target);
        FHE.allowThis(investable);
        FHE.allowThis(uncovered);
        FHE.allowThis(required);
        FHE.allowThis(shareBalance);
        FHE.allowThis(safeSurplus);

        FHE.allow(liability, msg.sender);
        FHE.allow(buffer, msg.sender);
        FHE.allow(target, msg.sender);
        FHE.allow(investable, msg.sender);
        FHE.allow(uncovered, msg.sender);
        FHE.allow(required, msg.sender);
        FHE.allow(shareBalance, msg.sender);
        FHE.allow(safeSurplus, msg.sender);
    }

    function exposeManagerBatchDepositForTest(uint256 batchId) external {
        euint64 deposit = depositBatcher.deposits(batchId, address(this));
        lastManagerBatchDeposit = deposit;
        FHE.allowThis(deposit);
        FHE.allow(deposit, msg.sender);
    }
}
