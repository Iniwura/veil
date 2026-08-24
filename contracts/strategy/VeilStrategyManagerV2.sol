// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Slice 2B intentionally has no governance or prize-transfer surface.
// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming, gas-strict-inequalities
// solhint-disable gas-struct-packing, function-max-lines
// solhint-disable named-parameters-mapping

import {FHE, ebool, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {BatcherConfidential} from "@openzeppelin/confidential-contracts/finance/BatcherConfidential.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

import {VeilDepositBatcher} from "./VeilDepositBatcher.sol";
import {VeilWithdrawalBatcher} from "./VeilWithdrawalBatcher.sol";

interface IVeilStrategyWithdrawalPool {
    function onManagerWithdrawalPaid(uint256 requestId, euint64 amount) external;

    function onManagerWithdrawalCanceled(uint256 requestId, euint64 amount) external;
}

/// @title VeilStrategyManagerV2
/// @notice Slice 2B strategy custody, confidential principal withdrawals, and solvency accounting.
/// @dev The immutable pool is the only principal-liability writer. Strategy shares and liquid
///      principal balances are read from the configured ERC7984 wrappers, never shadowed.
contract VeilStrategyManagerV2 is ReentrancyGuardTransient, ZamaEthereumConfig {
    uint128 internal constant BPS = 10_000;

    error InvalidAddress();
    error InvalidBps();
    error InvalidHaircut();
    error InvalidRoute();
    error OnlyPool();
    error UnauthorizedCiphertext();
    error UnknownManagerBatch(uint256 batchId);
    error ManagerBatchAlreadyResolved(uint256 batchId);
    error BatchNotResolvable(uint256 batchId, uint8 state);
    error InvalidValuation();
    error WithdrawalRequestNotFound(uint256 requestId);
    error WithdrawalRequestClosed(uint256 requestId);
    error WithdrawalRequestAlreadyClassified(uint256 requestId);
    error WithdrawalRequestNotClassified(uint256 requestId);
    error WithdrawalRequestNotQueued(uint256 requestId);
    error WithdrawalRequestNotHead(uint256 requestId, uint256 expectedRequestId);
    error WithdrawalRequestCommitted(uint256 requestId);
    error WithdrawalNotComplete(uint256 requestId);
    error WithdrawalQueueNotBlocked(uint256 requestId);
    error UnknownManagerWithdrawalBatch(uint256 batchId);
    error ManagerWithdrawalBatchAlreadyResolved(uint256 batchId);
    error WithdrawalBatchNotResolvable(uint256 batchId, uint8 state);
    error WithdrawalBatchOutstanding(uint256 batchId);

    address public immutable pool;
    IERC7984ERC20Wrapper public immutable principalAsset;
    IERC7984ERC20Wrapper public immutable strategyShareAsset;
    VeilDepositBatcher public immutable depositBatcher;
    VeilWithdrawalBatcher public immutable withdrawalBatcher;
    IERC4626 public immutable vault;
    uint16 public immutable bufferReserveBps;
    uint16 public immutable valuationHaircutBps;

    euint64 internal _principalLiability;
    euint64 internal _queuedWithdrawalTotal;
    mapping(uint256 batchId => bool recognized) private _managerDepositBatches;
    mapping(uint256 batchId => bool resolved) private _managerDepositBatchResolved;
    mapping(uint256 batchId => bool recognized) private _managerWithdrawalBatches;
    mapping(uint256 batchId => bool resolved) private _managerWithdrawalBatchResolved;
    mapping(uint256 batchId => uint256 fundingNonce) private _withdrawalBatchFundingNonce;
    mapping(uint256 queueSequence => uint256 requestId) private _withdrawalQueueRequests;

    struct WithdrawalRequest {
        address account;
        euint64 amount;
        euint64 remaining;
        euint64 paid;
        ebool completed;
        uint256 createdWithdrawalBatchId;
        uint256 createdWithdrawalFundingNonce;
        bool exists;
        bool canceled;
        bool settled;
        bool classified;
        bool queued;
        uint256 queueSequence;
    }

    mapping(uint256 requestId => WithdrawalRequest request) private _withdrawalRequests;
    uint256 public nextWithdrawalRequestId;
    uint256 public nextWithdrawalQueueSequence;
    uint256 public nextWithdrawalQueueSequenceToSettle;
    uint256 private _lastManagerWithdrawalBatchId;
    uint256 private _withdrawalFundingNonce;

    event PrincipalDepositRecorded(address indexed account);
    event DepositBatchInvested(uint256 indexed batchId);
    event DepositBatchResolved(uint256 indexed batchId, uint8 indexed state);
    event DepositBatchReclaimed(uint256 indexed batchId);
    event PrincipalWithdrawalRequested(uint256 indexed requestId, address indexed account);
    event WithdrawalRequestClassified(uint256 indexed requestId, bool indexed completed, uint256 indexed queueSequence);
    event WithdrawalSettlementAttempted(uint256 indexed requestId, address indexed account);
    event WithdrawalRequestSettled(uint256 indexed requestId, address indexed account);
    event WithdrawalRequestCanceled(uint256 indexed requestId, address indexed account);
    event WithdrawalQueueAdvanced(uint256 indexed requestId);
    event WithdrawalBatchFunded(uint256 indexed batchId);
    event WithdrawalBatchResolved(uint256 indexed batchId, uint8 indexed state);

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
        _queuedWithdrawalTotal = FHE.asEuint64(0);
        FHE.allowThis(_principalLiability);
        FHE.allowThis(_queuedWithdrawalTotal);
        nextWithdrawalRequestId = 1;
        nextWithdrawalQueueSequence = 1;
        nextWithdrawalQueueSequenceToSettle = 1;
    }

    /// @notice Returns the encrypted aggregate principal liability handle.
    /// @dev This does not grant any caller decryption permission.
    function principalLiability() external view returns (euint64) {
        return _principalLiability;
    }

    /// @notice Returns the encrypted subset of liability reserved for unpaid withdrawals.
    function queuedWithdrawalTotal() external view returns (euint64) {
        return _queuedWithdrawalTotal;
    }

    function managerDepositBatch(uint256 batchId) external view returns (bool) {
        return _managerDepositBatches[batchId];
    }

    function managerDepositBatchResolved(uint256 batchId) external view returns (bool) {
        return _managerDepositBatchResolved[batchId];
    }

    function managerWithdrawalBatch(uint256 batchId) external view returns (bool) {
        return _managerWithdrawalBatches[batchId];
    }

    function managerWithdrawalBatchResolved(uint256 batchId) external view returns (bool) {
        return _managerWithdrawalBatchResolved[batchId];
    }

    function lastManagerWithdrawalBatchId() external view returns (uint256) {
        return _lastManagerWithdrawalBatchId;
    }

    function withdrawalBatchFundingNonce(uint256 batchId) external view returns (uint256) {
        return _withdrawalBatchFundingNonce[batchId];
    }

    function withdrawalQueueRequest(uint256 queueSequence) external view returns (uint256) {
        return _withdrawalQueueRequests[queueSequence];
    }

    function withdrawalRequest(
        uint256 requestId
    )
        external
        view
        returns (
            address account,
            euint64 amount,
            euint64 remaining,
            euint64 paid,
            ebool completed,
            uint256 createdWithdrawalBatchId,
            uint256 createdWithdrawalFundingNonce,
            bool exists,
            bool canceled,
            bool settled
        )
    {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        return (
            request.account,
            request.amount,
            request.remaining,
            request.paid,
            request.completed,
            request.createdWithdrawalBatchId,
            request.createdWithdrawalFundingNonce,
            request.exists,
            request.canceled,
            request.settled
        );
    }

    function withdrawalRequestQueueState(
        uint256 requestId
    ) external view returns (bool classified, bool queued, uint256 queueSequence) {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        return (request.classified, request.queued, request.queueSequence);
    }

    /// @notice Returns whether a request is committed to a dispatched or completed strategy batch.
    function withdrawalRequestCommitted(uint256 requestId) external view returns (bool) {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        return _withdrawalRequestIsCommitted(request);
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

    /// @notice Creates an all-or-zero instant withdrawal or an encrypted queued request.
    /// @dev The immutable pool supplies an amount already restricted by the user's position.
    ///      The manager still caps it against aggregate liability and records only actual payout
    ///      as a liability reduction.
    function requestPrincipalWithdrawal(
        address account,
        euint64 permittedAmount
    )
        external
        nonReentrant
        returns (uint256 requestId, euint64 acceptedAmount, euint64 actualTransferred, euint64 queuedAmount)
    {
        if (msg.sender != pool) revert OnlyPool();
        if (!FHE.isAllowed(permittedAmount, address(this))) revert UnauthorizedCiphertext();

        euint64 unreservedLiability = FHESafeMath.saturatingSub(_principalLiability, _queuedWithdrawalTotal);
        FHE.allowThis(unreservedLiability);
        acceptedAmount = FHE.min(unreservedLiability, permittedAmount);
        euint64 buffer = _principalBuffer();
        ebool bufferCovers = FHE.ge(buffer, acceptedAmount);
        euint64 instantAmount = FHE.select(bufferCovers, acceptedAmount, FHE.asEuint64(0));

        FHE.allowThis(acceptedAmount);
        FHE.allowThis(instantAmount);
        FHE.allowTransient(instantAmount, address(principalAsset));
        actualTransferred = principalAsset.confidentialTransfer(account, instantAmount);
        queuedAmount = FHESafeMath.saturatingSub(acceptedAmount, actualTransferred);

        _principalLiability = FHESafeMath.saturatingSub(_principalLiability, actualTransferred);
        _queuedWithdrawalTotal = FHESafeMath.saturatingAdd(_queuedWithdrawalTotal, queuedAmount);
        FHE.allowThis(_principalLiability);
        FHE.allowThis(_queuedWithdrawalTotal);

        ebool completed = FHE.eq(queuedAmount, FHE.asEuint64(0));
        FHE.makePubliclyDecryptable(completed);
        FHE.allowThis(actualTransferred);
        FHE.allowThis(queuedAmount);
        FHE.allowThis(completed);

        requestId = nextWithdrawalRequestId;
        ++nextWithdrawalRequestId;
        _withdrawalRequests[requestId] = WithdrawalRequest({
            account: account,
            amount: queuedAmount,
            remaining: queuedAmount,
            paid: actualTransferred,
            completed: completed,
            createdWithdrawalBatchId: withdrawalBatcher.currentBatchId(),
            createdWithdrawalFundingNonce: _withdrawalFundingNonce,
            exists: true,
            canceled: false,
            settled: false,
            classified: false,
            queued: false,
            queueSequence: 0
        });

        FHE.allowTransient(acceptedAmount, pool);
        FHE.allowTransient(actualTransferred, pool);
        FHE.allowTransient(queuedAmount, pool);
        emit PrincipalWithdrawalRequested(requestId, account);
    }

    /// @notice Permissionlessly classifies the public completion predicate for a withdrawal.
    /// @dev Only a proven unpaid request receives a FIFO queue slot. Classification has no
    ///      financial effect and does not reveal the encrypted withdrawal amount.
    function classifyWithdrawal(uint256 requestId, bool completed, bytes calldata decryptionProof) external {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        if (!request.exists) revert WithdrawalRequestNotFound(requestId);
        if (request.classified) revert WithdrawalRequestAlreadyClassified(requestId);
        if (request.canceled || request.settled) revert WithdrawalRequestClosed(requestId);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(request.completed);
        FHE.checkSignatures(handles, abi.encode(completed), decryptionProof);

        request.classified = true;
        if (completed) {
            request.settled = true;
            emit WithdrawalRequestClassified(requestId, true, 0);
            return;
        }

        request.queued = true;
        request.queueSequence = nextWithdrawalQueueSequence;
        _withdrawalQueueRequests[nextWithdrawalQueueSequence] = requestId;
        ++nextWithdrawalQueueSequence;
        emit WithdrawalRequestClassified(requestId, false, request.queueSequence);
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

        BatcherConfidential.BatchState state = depositBatcher.batchState(batchId);
        if (state == BatcherConfidential.BatchState.Finalized) {
            depositBatcher.claim(batchId, address(this));
        } else if (state == BatcherConfidential.BatchState.Canceled) {
            depositBatcher.quit(batchId);
        } else {
            revert BatchNotResolvable(batchId, uint8(state));
        }

        _managerDepositBatchResolved[batchId] = true;
        emit DepositBatchResolved(batchId, uint8(state));
    }

    /// @notice Permissionlessly reclaims a manager-owned Pending deposit batch.
    /// @dev Pending reclaim is deliberately state-gated but cannot branch on encrypted need.
    ///      It is therefore conservative for solvency and may reduce yield availability if called
    ///      without a genuine queued-liquidity deficit.
    function reclaimPendingDepositBatch(uint256 batchId) external nonReentrant {
        if (!_managerDepositBatches[batchId]) revert UnknownManagerBatch(batchId);
        if (_managerDepositBatchResolved[batchId]) revert ManagerBatchAlreadyResolved(batchId);

        BatcherConfidential.BatchState state = depositBatcher.batchState(batchId);
        if (state != BatcherConfidential.BatchState.Pending) {
            revert BatchNotResolvable(batchId, uint8(state));
        }

        depositBatcher.quit(batchId);
        _managerDepositBatchResolved[batchId] = true;
        emit DepositBatchReclaimed(batchId);
    }

    /// @notice Permissionlessly funds the withdrawal route from live strategy shares.
    /// @dev The caller supplies no amount. Shares are derived from encrypted queued need and
    ///      conservative public valuation, then capped at the live manager share balance.
    function fundWithdrawalLiquidity() external nonReentrant {
        uint256 batchId = withdrawalBatcher.currentBatchId();
        if (
            _lastManagerWithdrawalBatchId != 0 &&
            !_managerWithdrawalBatchResolved[_lastManagerWithdrawalBatchId] &&
            _lastManagerWithdrawalBatchId != batchId
        ) {
            revert WithdrawalBatchOutstanding(_lastManagerWithdrawalBatchId);
        }

        (uint256 conservativeValue, uint256 shareScale) = _conservativeValuation();
        if (conservativeValue == 0 || shareScale == 0) revert InvalidValuation();

        euint64 buffer = _principalBuffer();
        euint64 liquidityNeed = FHESafeMath.saturatingSub(_queuedWithdrawalTotal, buffer);
        euint128 totalRequired = _requiredSharesForFunding(liquidityNeed, shareScale, conservativeValue);
        euint64 alreadyCommittedShares = withdrawalBatcher.deposits(batchId, address(this));
        if (!FHE.isInitialized(alreadyCommittedShares)) alreadyCommittedShares = FHE.asEuint64(0);
        FHE.allowThis(alreadyCommittedShares);
        euint128 alreadyCommittedShares128 = FHE.asEuint128(alreadyCommittedShares);
        euint128 coveredRequired = FHE.min(totalRequired, alreadyCommittedShares128);
        euint128 remainingRequired = FHE.sub(totalRequired, coveredRequired);
        euint64 shareBalance = _strategyShareBalance();
        euint128 capped = FHE.min(FHE.asEuint128(shareBalance), remainingRequired);
        euint64 withdrawalShares = FHE.asEuint64(capped);

        FHE.allowThis(withdrawalShares);
        FHE.allowTransient(withdrawalShares, address(this));
        FHE.allowTransient(withdrawalShares, address(strategyShareAsset));
        strategyShareAsset.confidentialTransferAndCall(address(withdrawalBatcher), withdrawalShares, "");

        ++_withdrawalFundingNonce;
        _withdrawalBatchFundingNonce[batchId] = _withdrawalFundingNonce;
        if (_lastManagerWithdrawalBatchId != batchId) {
            _lastManagerWithdrawalBatchId = batchId;
            _managerWithdrawalBatches[batchId] = true;
        }
        emit WithdrawalBatchFunded(batchId);
    }

    /// @notice Permissionlessly claims or refunds one manager-recognized withdrawal batch.
    function resolveWithdrawalBatch(uint256 batchId) external nonReentrant {
        if (!_managerWithdrawalBatches[batchId]) revert UnknownManagerWithdrawalBatch(batchId);
        if (_managerWithdrawalBatchResolved[batchId]) {
            revert ManagerWithdrawalBatchAlreadyResolved(batchId);
        }

        BatcherConfidential.BatchState state = withdrawalBatcher.batchState(batchId);
        if (state == BatcherConfidential.BatchState.Finalized) {
            withdrawalBatcher.claim(batchId, address(this));
        } else if (state == BatcherConfidential.BatchState.Canceled) {
            withdrawalBatcher.quit(batchId);
        } else {
            revert WithdrawalBatchNotResolvable(batchId, uint8(state));
        }

        _managerWithdrawalBatchResolved[batchId] = true;
        emit WithdrawalBatchResolved(batchId, uint8(state));
    }

    /// @notice Attempts an all-or-zero payout for the classified FIFO head request.
    /// @dev FIFO order is the order in which permissionless proofs classify genuinely unpaid
    ///      requests, not the order of public request IDs.
    function settleWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        _requireOpenWithdrawalRequest(requestId, request);
        _requireQueuedWithdrawalHead(requestId, request);

        euint64 buffer = _principalBuffer();
        euint64 outstanding = request.remaining;
        euint64 payout = FHE.select(FHE.ge(buffer, outstanding), outstanding, FHE.asEuint64(0));
        FHE.allowThis(payout);
        FHE.allowTransient(payout, address(principalAsset));
        euint64 actualTransferred = principalAsset.confidentialTransfer(request.account, payout);
        euint64 newRemaining = FHESafeMath.saturatingSub(outstanding, actualTransferred);
        euint64 newPaid = FHESafeMath.saturatingAdd(request.paid, actualTransferred);
        ebool completed = FHE.eq(newRemaining, FHE.asEuint64(0));
        FHE.makePubliclyDecryptable(completed);

        request.remaining = newRemaining;
        request.paid = newPaid;
        request.completed = completed;
        FHE.allowThis(actualTransferred);
        FHE.allowThis(newRemaining);
        FHE.allowThis(newPaid);
        FHE.allowThis(completed);

        _principalLiability = FHESafeMath.saturatingSub(_principalLiability, actualTransferred);
        _queuedWithdrawalTotal = FHESafeMath.saturatingSub(_queuedWithdrawalTotal, actualTransferred);
        FHE.allowThis(_principalLiability);
        FHE.allowThis(_queuedWithdrawalTotal);

        FHE.allowTransient(actualTransferred, pool);
        IVeilStrategyWithdrawalPool(pool).onManagerWithdrawalPaid(requestId, actualTransferred);
        emit WithdrawalSettlementAttempted(requestId, request.account);
    }

    /// @notice Proof-gated FIFO advancement that reveals only the encrypted completion boolean.
    function finalizeWithdrawal(uint256 requestId, bool completed, bytes calldata decryptionProof) external {
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        _requireOpenWithdrawalRequest(requestId, request);
        _requireQueuedWithdrawalHead(requestId, request);
        if (!completed) revert WithdrawalNotComplete(requestId);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(request.completed);
        FHE.checkSignatures(handles, abi.encode(completed), decryptionProof);

        request.settled = true;
        ++nextWithdrawalQueueSequenceToSettle;
        emit WithdrawalRequestSettled(requestId, request.account);
    }

    /// @notice Advances over one already-canceled FIFO entry without scanning history.
    /// @dev One request per call keeps queue maintenance bounded even after many cancellations.
    function advanceWithdrawalQueue() external {
        uint256 queueSequence = nextWithdrawalQueueSequenceToSettle;
        uint256 requestId = _withdrawalQueueRequests[queueSequence];
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        if (!request.exists || !request.queued || !request.canceled) revert WithdrawalQueueNotBlocked(queueSequence);
        ++nextWithdrawalQueueSequenceToSettle;
        emit WithdrawalQueueAdvanced(requestId);
    }

    /// @notice Cancels an uncommitted queued request through the immutable pool boundary.
    /// @dev The pool restores the user's reserved amount to active position atomically.
    function cancelPrincipalWithdrawal(uint256 requestId) external nonReentrant returns (euint64 canceledAmount) {
        if (msg.sender != pool) revert OnlyPool();
        WithdrawalRequest storage request = _withdrawalRequests[requestId];
        _requireOpenWithdrawalRequest(requestId, request);

        if (_withdrawalRequestIsCommitted(request)) revert WithdrawalRequestCommitted(requestId);

        canceledAmount = request.remaining;
        euint64 zero = FHE.asEuint64(0);
        request.remaining = zero;
        request.canceled = true;
        FHE.allowThis(zero);
        FHE.allowTransient(canceledAmount, pool);

        _queuedWithdrawalTotal = FHESafeMath.saturatingSub(_queuedWithdrawalTotal, canceledAmount);
        FHE.allowThis(_queuedWithdrawalTotal);
        if (request.classified && request.queued && request.queueSequence == nextWithdrawalQueueSequenceToSettle) {
            ++nextWithdrawalQueueSequenceToSettle;
        }
        IVeilStrategyWithdrawalPool(pool).onManagerWithdrawalCanceled(requestId, canceledAmount);
        emit WithdrawalRequestCanceled(requestId, request.account);
    }

    function _targetBuffer() internal returns (euint64) {
        euint128 liability128 = FHE.asEuint128(_principalLiability);
        euint128 scaled = FHE.mul(liability128, uint128(bufferReserveBps));
        euint128 rounded = FHE.add(scaled, BPS - 1);
        return FHE.asEuint64(FHE.div(rounded, BPS));
    }

    function _investableBuffer() internal returns (euint64) {
        euint64 buffer = _principalBuffer();
        euint64 normalTarget = _targetBuffer();
        euint64 liquidFloor = FHE.max(normalTarget, _queuedWithdrawalTotal);
        return FHESafeMath.saturatingSub(buffer, liquidFloor);
    }

    function _uncoveredPrincipal(euint64 buffer) internal returns (euint64) {
        return FHESafeMath.saturatingSub(_principalLiability, buffer);
    }

    function _principalBuffer() internal returns (euint64 buffer) {
        buffer = principalAsset.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(buffer)) buffer = FHE.asEuint64(0);
        FHE.allowThis(buffer);
    }

    function _strategyShareBalance() internal returns (euint64 balance) {
        balance = strategyShareAsset.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(balance)) balance = FHE.asEuint64(0);
        FHE.allowThis(balance);
    }

    function _requireOpenWithdrawalRequest(uint256 requestId, WithdrawalRequest storage request) internal view {
        if (!request.exists) revert WithdrawalRequestNotFound(requestId);
        if (request.canceled || request.settled) revert WithdrawalRequestClosed(requestId);
    }

    function _requireQueuedWithdrawalHead(uint256 requestId, WithdrawalRequest storage request) internal view {
        if (!request.classified) revert WithdrawalRequestNotClassified(requestId);
        if (!request.queued) revert WithdrawalRequestNotQueued(requestId);
        uint256 expectedRequestId = _withdrawalQueueRequests[nextWithdrawalQueueSequenceToSettle];
        if (request.queueSequence != nextWithdrawalQueueSequenceToSettle) {
            revert WithdrawalRequestNotHead(requestId, expectedRequestId);
        }
    }

    function _withdrawalRequestIsCommitted(WithdrawalRequest storage request) internal view returns (bool) {
        if (!request.exists) return false;
        if (_withdrawalBatchFundingNonce[request.createdWithdrawalBatchId] <= request.createdWithdrawalFundingNonce) {
            return false;
        }
        return withdrawalBatcher.batchState(request.createdWithdrawalBatchId) != BatcherConfidential.BatchState.Pending;
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
            revert InvalidValuation();
        }

        euint128 product = FHE.mul(FHE.asEuint128(uncovered), uint128(shareScale));
        euint128 quotient = FHE.div(product, uint128(conservativeValue));
        euint128 remainder = FHE.rem(product, uint128(conservativeValue));
        ebool hasRemainder = FHE.ne(remainder, FHE.asEuint128(0));
        return FHE.add(quotient, FHE.asEuint128(hasRemainder));
    }

    /// @dev The funding path uses ceil((uncovered * scale) / value) in its equivalent
    /// rounded-numerator form to keep the residual-balance circuit within the FHE depth limit.
    /// The public guard falls back to the remainder form when the rounded numerator could exceed
    /// uint128. This remains exact for every supported valuation.
    function _requiredSharesForFunding(
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
            revert InvalidValuation();
        }

        uint256 maximumProduct = uint256(type(uint64).max) * shareScale;
        if (conservativeValue - 1 > type(uint128).max - maximumProduct) {
            return _requiredShares(uncovered, shareScale, conservativeValue);
        }

        euint128 product = FHE.mul(FHE.asEuint128(uncovered), uint128(shareScale));
        euint128 roundedNumerator = FHE.add(product, uint128(conservativeValue - 1));
        return FHE.div(roundedNumerator, uint128(conservativeValue));
    }

    function _safeSurplusShares() internal returns (euint64) {
        (uint256 conservativeValue, uint256 shareScale) = _conservativeValuation();
        if (conservativeValue == 0) return FHE.asEuint64(0);

        euint64 buffer = _principalBuffer();
        euint64 uncovered = _uncoveredPrincipal(buffer);
        euint128 required = _requiredShares(uncovered, shareScale, conservativeValue);
        euint128 shareBalance = FHE.asEuint128(_strategyShareBalance());
        euint128 reserved = FHE.min(shareBalance, required);
        return FHE.asEuint64(FHE.sub(shareBalance, reserved));
    }
}
