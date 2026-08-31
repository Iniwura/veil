// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable immutable-vars-naming, no-complex-fallback, named-parameters-mapping
// solhint-disable gas-indexed-events

import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IVeilPoolV4HelperTarget {
    function onSeatAttestationFinalized(address account, bool balancePositive) external;
    function requestSeatAttestation(address account) external;

    function nextRoundId() external view returns (uint256);
    function nextDrawOpensAt() external view returns (uint64);
    function nextDrawClosesAt() external view returns (uint64);
    function unsettledRoundCount() external view returns (uint256);
    function shardPlayerCount(uint8 shard) external view returns (uint8);
    function getShardPlayer(uint8 shard, uint8 index) external view returns (address);
    function seatExpiresAt(address account) external view returns (uint64);
    function seatEligibleFromRoundId(address account) external view returns (uint256);
}

/// @notice V4 seat-attestation keeper and frontend read-model.
/// @dev The pool submits an encrypted `balance > 0` predicate. Anyone can later provide the
///      KMS proof; only that boolean is revealed and the pool performs the seat mutation.
contract VeilPoolV4Helper is ZamaEthereumConfig {
    enum DrawAvailability {
        OPEN,
        SNAPSHOT_REQUIRED,
        INSUFFICIENT_PARTICIPANTS
    }

    error OnlyPool();
    error NoPendingAttestation();
    error AttestationRequestMismatch(uint256 expectedRequestId, uint256 suppliedRequestId);

    IVeilPoolV4HelperTarget public immutable pool;

    mapping(address => ebool) private pendingBalancePositive;
    mapping(address => uint256) public pendingSeatAttestationRequestId;
    uint256 public nextSeatAttestationRequestId = 1;

    event SeatAttestationRequested(address indexed account, uint256 indexed requestId);
    event SeatAttestationFinalized(address indexed account, uint256 indexed requestId, bool balancePositive);

    constructor(IVeilPoolV4HelperTarget pool_) {
        require(address(pool_) != address(0), "Invalid pool");
        pool = pool_;
    }

    /// @notice Bounds a deposit against the encrypted per-account and aggregate capacities.
    function boundDeposit(
        euint64 requested,
        euint64 balance,
        euint64 totalWeight
    ) external returns (euint64 permitted) {
        if (msg.sender != address(pool)) revert OnlyPool();
        euint64 maxValue = FHE.asEuint64(type(uint64).max);
        euint64 remainingBalance = FHE.sub(maxValue, balance);
        euint64 remainingTotalWeight = FHE.sub(maxValue, totalWeight);
        permitted = FHE.min(requested, FHE.min(remainingBalance, remainingTotalWeight));
        FHE.allowTransient(permitted, address(pool));
    }

    function requestSeatAttestation(address account, euint64 balance) external {
        if (msg.sender != address(pool)) revert OnlyPool();

        ebool balancePositive = FHE.gt(balance, FHE.asEuint64(0));
        FHE.allowThis(balancePositive);
        FHE.makePubliclyDecryptable(balancePositive);

        uint256 requestId = nextSeatAttestationRequestId;
        unchecked {
            nextSeatAttestationRequestId = requestId + 1;
        }
        pendingBalancePositive[account] = balancePositive;
        pendingSeatAttestationRequestId[account] = requestId;
        emit SeatAttestationRequested(account, requestId);
    }

    /// @notice Permissionless keeper trigger for a fresh encrypted balance predicate.
    /// @dev The pool remains the only contract that can read the encrypted balance; this helper
    ///      merely lets a keeper refresh a lease without another saver wallet transaction.
    function refreshSeatAttestation(address account) external {
        pool.requestSeatAttestation(account);
    }

    /// @notice Invalidates a pending predicate when a saver explicitly releases their seat.
    /// @dev Prevents an attestation requested before the release from reactivating the seat later.
    function cancelSeatAttestation(address account) external {
        if (msg.sender != address(pool)) revert OnlyPool();
        pendingBalancePositive[account] = ebool.wrap(0);
        delete pendingSeatAttestationRequestId[account];
    }

    function encryptedSeatAttestationOf(address account) external view returns (ebool) {
        if (pendingSeatAttestationRequestId[account] == 0) revert NoPendingAttestation();
        return pendingBalancePositive[account];
    }

    /// @notice Permissionless KMS callback for the latest balance predicate of an account.
    function finalizeSeatAttestation(
        address account,
        uint256 requestId,
        bool balancePositive,
        bytes calldata decryptionProof
    ) external {
        uint256 expectedRequestId = pendingSeatAttestationRequestId[account];
        if (expectedRequestId == 0) revert NoPendingAttestation();
        if (requestId != expectedRequestId) revert AttestationRequestMismatch(expectedRequestId, requestId);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(pendingBalancePositive[account]);
        FHE.checkSignatures(handles, abi.encode(balancePositive), decryptionProof);

        pendingBalancePositive[account] = ebool.wrap(0);
        delete pendingSeatAttestationRequestId[account];
        pool.onSeatAttestationFinalized(account, balancePositive);
        emit SeatAttestationFinalized(account, requestId, balancePositive);
    }

    /// @notice Conservative read-model for the scheduled round.
    /// @dev Public metadata can prove that fewer than two seats are mature, but cannot prove
    ///      positive encrypted weight. `SNAPSHOT_REQUIRED` is deliberately not `READY`.
    function getDrawAvailability() public view returns (DrawAvailability) {
        if (block.timestamp < pool.nextDrawClosesAt()) return DrawAvailability.OPEN;
        return _hasTwoMatureSeats() ? DrawAvailability.SNAPSHOT_REQUIRED : DrawAvailability.INSUFFICIENT_PARTICIPANTS;
    }

    function isDrawTimeReady() public view returns (bool) {
        return block.timestamp >= pool.nextDrawClosesAt();
    }

    function getDrawSchedule()
        external
        view
        returns (
            uint256 currentRoundId,
            uint256 unsettledRounds,
            uint64 opensAt,
            uint64 closesAt,
            bool timeReady,
            bool snapshotRequired,
            bool canAdvance,
            bool insufficientParticipants,
            bool overdue
        )
    {
        DrawAvailability availability = getDrawAvailability();
        bool timeReady_ = isDrawTimeReady();
        return (
            pool.nextRoundId(),
            pool.unsettledRoundCount(),
            pool.nextDrawOpensAt(),
            pool.nextDrawClosesAt(),
            timeReady_,
            availability == DrawAvailability.SNAPSHOT_REQUIRED,
            timeReady_,
            availability == DrawAvailability.INSUFFICIENT_PARTICIPANTS,
            pool.unsettledRoundCount() != 0 && timeReady_
        );
    }

    function _hasTwoMatureSeats() private view returns (bool) {
        uint256 roundId = pool.nextRoundId();
        uint64 closesAt = pool.nextDrawClosesAt();
        uint8 matureCount;

        for (uint8 shard = 0; shard < 24; shard++) {
            uint8 participantCount = pool.shardPlayerCount(shard);
            for (uint8 index = 0; index < participantCount; index++) {
                address account = pool.getShardPlayer(shard, index);
                if (
                    pool.seatExpiresAt(account) >= closesAt &&
                    pool.seatEligibleFromRoundId(account) != 0 &&
                    pool.seatEligibleFromRoundId(account) <= roundId
                ) {
                    unchecked {
                        matureCount++;
                    }
                    if (matureCount >= 2) return true;
                }
            }
        }
        return false;
    }
}
