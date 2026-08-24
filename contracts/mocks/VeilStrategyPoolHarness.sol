// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TEST/DEMO ONLY. This harness models the future VeilPoolV2 custody boundary.
// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

import {VeilStrategyManagerV2} from "../strategy/VeilStrategyManagerV2.sol";

/// @title VeilStrategyPoolHarness
/// @notice Test-only pool boundary that records the actual confidential transfer result.
contract VeilStrategyPoolHarness is ZamaEthereumConfig {
    IERC7984 public immutable principalAsset;
    address public immutable deployer;
    address public manager;
    bool public managerConfigured;
    mapping(address account => euint64 active) private _activePositions;
    mapping(address account => euint64 reserved) private _reservedWithdrawals;
    mapping(uint256 requestId => address account) private _withdrawalRequestAccounts;

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

        euint64 active = FHESafeMath.saturatingAdd(_activePositions[account], transferred);
        _activePositions[account] = active;
        FHE.allowThis(active);
        FHE.allow(active, account);
    }

    /// @dev Future VeilPoolV2 boundary: restrict the input to the user's active position, then
    ///      let the manager decide instant-or-queue without exposing the confidential amount.
    function requestWithdrawal(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (uint256 requestId) {
        require(managerConfigured, "Manager not configured");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 active = _activePositions[msg.sender];
        if (!FHE.isInitialized(active)) active = FHE.asEuint64(0);
        euint64 permitted = FHE.select(FHE.ge(active, requested), requested, FHE.asEuint64(0));
        FHE.allowTransient(permitted, manager);

        euint64 accepted;
        euint64 queuedAmount;
        (requestId, accepted, , queuedAmount) = VeilStrategyManagerV2(manager).requestPrincipalWithdrawal(
            msg.sender,
            permitted
        );

        euint64 newActive = FHESafeMath.saturatingSub(active, accepted);
        euint64 newReserved = FHESafeMath.saturatingAdd(_reservedWithdrawals[msg.sender], queuedAmount);
        _activePositions[msg.sender] = newActive;
        _reservedWithdrawals[msg.sender] = newReserved;
        _withdrawalRequestAccounts[requestId] = msg.sender;
        FHE.allowThis(newActive);
        FHE.allowThis(newReserved);
        FHE.allow(newActive, msg.sender);
        FHE.allow(newReserved, msg.sender);
    }

    /// @dev The user-facing pool would authenticate the caller before forwarding cancellation.
    function cancelWithdrawal(uint256 requestId) external returns (euint64 canceledAmount) {
        require(_withdrawalRequestAccounts[requestId] == msg.sender, "Not request owner");
        canceledAmount = VeilStrategyManagerV2(manager).cancelPrincipalWithdrawal(requestId);
    }

    /// @dev Called only by the immutable strategy manager after an actual queued payout.
    function onManagerWithdrawalPaid(uint256 requestId, euint64 amount) external {
        require(msg.sender == manager, "Only manager");
        address account = _withdrawalRequestAccounts[requestId];
        require(account != address(0), "Unknown request");
        euint64 reserved = FHESafeMath.saturatingSub(_reservedWithdrawals[account], amount);
        _reservedWithdrawals[account] = reserved;
        FHE.allowThis(reserved);
        FHE.allow(reserved, account);
    }

    /// @dev Called only by the immutable strategy manager after an allowed cancellation.
    function onManagerWithdrawalCanceled(uint256 requestId, euint64 amount) external {
        require(msg.sender == manager, "Only manager");
        address account = _withdrawalRequestAccounts[requestId];
        require(account != address(0), "Unknown request");
        euint64 reserved = FHESafeMath.saturatingSub(_reservedWithdrawals[account], amount);
        euint64 active = FHESafeMath.saturatingAdd(_activePositions[account], amount);
        _reservedWithdrawals[account] = reserved;
        _activePositions[account] = active;
        FHE.allowThis(reserved);
        FHE.allowThis(active);
        FHE.allow(reserved, account);
        FHE.allow(active, account);
    }

    function activePosition(address account) external view returns (euint64) {
        return _activePositions[account];
    }

    function reservedWithdrawal(address account) external view returns (euint64) {
        return _reservedWithdrawals[account];
    }

    /// @dev TEST/DEMO ONLY ACL helper; production VeilPoolV2 must not expose this.
    function exposePositionsForTest(address account) external returns (euint64 active, euint64 reserved) {
        active = _activePositions[account];
        reserved = _reservedWithdrawals[account];
        if (!FHE.isInitialized(active)) active = FHE.asEuint64(0);
        if (!FHE.isInitialized(reserved)) reserved = FHE.asEuint64(0);
        FHE.allowThis(active);
        FHE.allowThis(reserved);
        FHE.allow(active, msg.sender);
        FHE.allow(reserved, msg.sender);
    }
}
