// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// UNVEIL V4 keeps the V3 confidential custody and prize economics while replacing the
// single linear draw roster with a 24 x 24 sharded snapshot and two-stage encrypted draw.
// solhint-disable use-natspec, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, immutable-vars-naming, named-parameters-mapping
// solhint-disable gas-struct-packing, max-states-count, function-max-lines

import {FHE, eaddress, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

import {VeilShardedDraw} from "./draw/VeilShardedDraw.sol";

interface IVeilStrategyManagerV4 {
    function pool() external view returns (address);

    function principalAsset() external view returns (address);

    function recordPrincipalDeposit(address account, euint64 transferred) external;

    function requestPrincipalWithdrawal(
        address account,
        euint64 permittedAmount
    ) external returns (uint256 requestId, euint64 acceptedAmount, euint64 actualTransferred, euint64 queuedAmount);

    function cancelPrincipalWithdrawal(uint256 requestId) external returns (euint64 canceledAmount);
}

/// @title VeilPoolV4
/// @notice Confidential prize-savings pool with a 576-seat sharded draw topology.
/// @dev Each round snapshots one 24-seat shard per transaction. Prize selection then performs a
///      weighted encrypted shard draw followed by a weighted encrypted member draw inside that shard.
contract VeilPoolV4 is VeilShardedDraw {
    uint8 public constant PRIZE_SLOTS = 3;
    uint64 public constant SEAT_LEASE = 30 days;

    error InvalidAsset();
    error InvalidDrawPeriod();
    error ScheduleOverflow();
    error NotOwner();
    error ManagerAlreadyConfigured();
    error InvalidManager();
    error InvalidManagerPool();
    error InvalidManagerAsset();
    error ManagerNotConfigured();
    error PoolNotOperator();
    error NotJoined();
    error NotSeated();
    error NotRequestOwner();
    error OnlyManager();
    error UnknownRequest();
    error RequestCanceled();
    error RequestAlreadyCanceled();
    error DrawStillOpen();
    error RoundAlreadyAdvanced();
    error RoundNotSnapshotting();
    error SnapshotNotBegun();
    error SnapshotAlreadyFinalized();
    error ShardsPending();
    error RoundNotDrawing();
    error RoundNotFinalizing();
    error UnknownRound();
    error InvalidRound();

    enum DrawState {
        NONE,
        SNAPSHOTTED,
        DRAWN,
        FINALIZED,
        CANCELLED,
        SKIPPED
    }

    enum DrawAvailability {
        OPEN,
        READY,
        INSUFFICIENT_PARTICIPANTS
    }

    struct Position {
        euint64 balance;
        bool active;
    }

    struct DrawRecord {
        uint64 snapshotBlock;
        uint16 participantCount;
        DrawState state;
    }

    address public immutable owner;
    IERC7984 public immutable asset;
    uint64 public immutable drawPeriod;
    uint64 public immutable firstDrawOpensAt;

    address public strategyManager;
    bool public strategyManagerConfigured;

    mapping(address => Position) private positions;
    mapping(address => bool) public joined;
    mapping(address => euint64) private reservedWithdrawals;

    mapping(uint256 => address) public withdrawalRequestAccount;
    mapping(uint256 => euint64) private withdrawalRequestReserved;
    mapping(uint256 => bool) public withdrawalRequestCanceled;

    euint64 private encryptedTotalWeight;
    uint256 public nextRoundId = 1;
    uint64 public nextDrawOpensAt;
    uint64 public nextDrawClosesAt;
    uint256 public unsettledRoundCount;

    mapping(uint256 => DrawRecord) private draws;

    event StrategyManagerConfigured(address indexed manager);
    event PlayerJoined(address indexed player);
    event DepositRecorded(address indexed player);
    event WithdrawalRecorded(address indexed player, uint256 indexed requestId);
    event DrawWindowOpened(uint256 indexed roundId, uint64 opensAt, uint64 closesAt);
    event RoundSnapshotBegun(uint256 indexed roundId, uint64 snapshotBlock);
    event RoundSnapshotted(uint256 indexed roundId, uint16 participantCount, uint64 snapshotBlock);
    event RoundSkipped(uint256 indexed roundId, uint16 participantCount, uint64 snapshotBlock);
    event RoundFinalized(uint256 indexed roundId, uint8 winningPrizeCount);
    event RoundCancelled(uint256 indexed roundId);

    constructor(IERC7984 asset_, uint64 drawPeriod_) {
        if (address(asset_) == address(0)) revert InvalidAsset();
        if (drawPeriod_ == 0) revert InvalidDrawPeriod();
        if (block.timestamp > type(uint64).max - drawPeriod_) revert ScheduleOverflow();

        owner = msg.sender;
        asset = asset_;
        drawPeriod = drawPeriod_;
        firstDrawOpensAt = uint64(block.timestamp);

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
        _updateNextDrawWindow();
    }

    function configureStrategyManager(address manager_) external {
        if (msg.sender != owner) revert NotOwner();
        if (strategyManagerConfigured) revert ManagerAlreadyConfigured();
        if (manager_ == address(0)) revert InvalidManager();
        if (IVeilStrategyManagerV4(manager_).pool() != address(this)) revert InvalidManagerPool();
        if (IVeilStrategyManagerV4(manager_).principalAsset() != address(asset)) revert InvalidManagerAsset();

        strategyManager = manager_;
        strategyManagerConfigured = true;
        emit StrategyManagerConfigured(manager_);
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        if (!strategyManagerConfigured) revert ManagerNotConfigured();
        if (!asset.isOperator(msg.sender, address(this))) revert PoolNotOperator();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 transferred = asset.confidentialTransferFrom(msg.sender, strategyManager, requested);
        FHE.allowTransient(transferred, strategyManager);
        IVeilStrategyManagerV4(strategyManager).recordPrincipalDeposit(msg.sender, transferred);

        if (!joined[msg.sender]) {
            positions[msg.sender].balance = FHE.asEuint64(0);
            reservedWithdrawals[msg.sender] = FHE.asEuint64(0);
            positions[msg.sender].active = true;
            joined[msg.sender] = true;
            emit PlayerJoined(msg.sender);
        }

        _acquireOrRenewShardedSeat(msg.sender);

        positions[msg.sender].balance = FHE.add(positions[msg.sender].balance, transferred);
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, transferred);

        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(reservedWithdrawals[msg.sender]);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allow(positions[msg.sender].balance, msg.sender);
        FHE.allow(reservedWithdrawals[msg.sender], msg.sender);
        emit DepositRecorded(msg.sender);
    }

    function renewDrawSeat() external {
        if (!joined[msg.sender]) revert NotJoined();
        _acquireOrRenewShardedSeat(msg.sender);
    }

    function leaveDrawSeat() external {
        if (!seated[msg.sender]) revert NotSeated();
        _releaseShardedSeat(msg.sender);
    }

    function pruneExpiredSeats(uint8 shard) external {
        _pruneExpiredShardedSeats(shard);
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (uint256 requestId) {
        if (!strategyManagerConfigured) revert ManagerNotConfigured();
        if (!joined[msg.sender]) revert NotJoined();

        _sealShardedAccountState(msg.sender);

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 permitted = FHE.select(FHE.le(requested, positions[msg.sender].balance), requested, FHE.asEuint64(0));
        FHE.allowTransient(permitted, strategyManager);

        euint64 acceptedAmount;
        euint64 queuedAmount;
        (requestId, acceptedAmount, , queuedAmount) = IVeilStrategyManagerV4(strategyManager)
            .requestPrincipalWithdrawal(msg.sender, permitted);

        positions[msg.sender].balance = FHESafeMath.saturatingSub(positions[msg.sender].balance, acceptedAmount);
        encryptedTotalWeight = FHESafeMath.saturatingSub(encryptedTotalWeight, acceptedAmount);
        reservedWithdrawals[msg.sender] = FHESafeMath.saturatingAdd(reservedWithdrawals[msg.sender], queuedAmount);
        withdrawalRequestAccount[requestId] = msg.sender;
        withdrawalRequestReserved[requestId] = queuedAmount;

        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allowThis(reservedWithdrawals[msg.sender]);
        FHE.allowThis(withdrawalRequestReserved[requestId]);
        FHE.allow(positions[msg.sender].balance, msg.sender);
        FHE.allow(reservedWithdrawals[msg.sender], msg.sender);
        emit WithdrawalRecorded(msg.sender, requestId);
    }

    function cancelWithdrawal(uint256 requestId) external returns (euint64 canceledAmount) {
        if (!strategyManagerConfigured) revert ManagerNotConfigured();
        if (withdrawalRequestAccount[requestId] != msg.sender) revert NotRequestOwner();
        canceledAmount = IVeilStrategyManagerV4(strategyManager).cancelPrincipalWithdrawal(requestId);
    }

    function onManagerWithdrawalPaid(uint256 requestId, euint64 amount) external {
        if (msg.sender != strategyManager) revert OnlyManager();
        address account = withdrawalRequestAccount[requestId];
        if (account == address(0)) revert UnknownRequest();
        if (withdrawalRequestCanceled[requestId]) revert RequestCanceled();

        euint64 requestRemaining = withdrawalRequestReserved[requestId];
        euint64 applied = FHE.select(FHE.le(amount, requestRemaining), amount, FHE.asEuint64(0));
        withdrawalRequestReserved[requestId] = FHESafeMath.saturatingSub(requestRemaining, applied);
        reservedWithdrawals[account] = FHESafeMath.saturatingSub(reservedWithdrawals[account], applied);

        FHE.allowThis(withdrawalRequestReserved[requestId]);
        FHE.allowThis(reservedWithdrawals[account]);
        FHE.allow(reservedWithdrawals[account], account);
    }

    function onManagerWithdrawalCanceled(uint256 requestId, euint64 amount) external {
        if (msg.sender != strategyManager) revert OnlyManager();
        address account = withdrawalRequestAccount[requestId];
        if (account == address(0)) revert UnknownRequest();
        if (withdrawalRequestCanceled[requestId]) revert RequestAlreadyCanceled();

        _sealShardedAccountState(account);

        euint64 requestRemaining = withdrawalRequestReserved[requestId];
        euint64 restored = FHE.select(FHE.le(amount, requestRemaining), amount, FHE.asEuint64(0));
        withdrawalRequestReserved[requestId] = FHESafeMath.saturatingSub(requestRemaining, restored);
        reservedWithdrawals[account] = FHESafeMath.saturatingSub(reservedWithdrawals[account], restored);
        positions[account].balance = FHESafeMath.saturatingAdd(positions[account].balance, restored);
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, restored);
        withdrawalRequestCanceled[requestId] = true;

        FHE.allowThis(withdrawalRequestReserved[requestId]);
        FHE.allowThis(reservedWithdrawals[account]);
        FHE.allowThis(positions[account].balance);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allow(reservedWithdrawals[account], account);
        FHE.allow(positions[account].balance, account);
    }

    function encryptedBalanceOf() external view returns (euint64) {
        if (!joined[msg.sender]) revert NotJoined();
        return positions[msg.sender].balance;
    }

    function encryptedReservedWithdrawalOf() external view returns (euint64) {
        if (!joined[msg.sender]) revert NotJoined();
        return reservedWithdrawals[msg.sender];
    }

    function getEncryptedTotalWeight() external view returns (euint64) {
        return encryptedTotalWeight;
    }

    /// @notice Begins the current closed round and immediately opens scheduling for the next round.
    /// @dev Individual shard snapshots remain permissionless and can be completed over multiple transactions.
    function beginSnapshotRound() external returns (uint256 roundId) {
        if (block.timestamp < nextDrawClosesAt) revert DrawStillOpen();

        roundId = nextRoundId;
        DrawRecord storage draw = draws[roundId];
        if (draw.state != DrawState.NONE) revert RoundAlreadyAdvanced();

        _beginShardedSnapshot(roundId);
        draw.snapshotBlock = uint64(block.number);
        draw.state = DrawState.SNAPSHOTTED;
        unchecked {
            ++unsettledRoundCount;
            ++nextRoundId;
        }
        _updateNextDrawWindow();

        emit RoundSnapshotBegun(roundId, draw.snapshotBlock);
    }

    function snapshotRoundShard(uint256 roundId, uint8 shard) external {
        if (draws[roundId].state != DrawState.SNAPSHOTTED) revert RoundNotSnapshotting();
        _snapshotOneShard(roundId, shard);
    }

    /// @notice Completes a 24-shard snapshot or marks the round skipped when fewer than two mature seats exist.
    function completeSnapshotRound(uint256 roundId) external {
        DrawRecord storage draw = draws[roundId];
        if (draw.state != DrawState.SNAPSHOTTED) revert RoundNotSnapshotting();

        (, , uint16 participantCount, uint8 processedShardCount, bool begun, bool finalized) =
            getShardedSnapshotRound(roundId);
        if (!begun) revert SnapshotNotBegun();
        if (finalized) revert SnapshotAlreadyFinalized();
        if (processedShardCount != SHARD_COUNT) revert ShardsPending();

        draw.participantCount = participantCount;
        if (participantCount < 2) {
            draw.state = DrawState.SKIPPED;
            unchecked {
                --unsettledRoundCount;
            }
            emit RoundSkipped(roundId, participantCount, draw.snapshotBlock);
            return;
        }

        _finalizeShardedSnapshot(roundId);
        emit RoundSnapshotted(roundId, participantCount, draw.snapshotBlock);
    }

    function drawPrizeShard(uint256 roundId, uint8 prizeIndex) public override {
        if (draws[roundId].state != DrawState.SNAPSHOTTED) revert RoundNotDrawing();
        super.drawPrizeShard(roundId, prizeIndex);
    }

    function finalizePrizeShard(
        uint256 roundId,
        uint8 prizeIndex,
        uint8 shard,
        bytes calldata decryptionProof
    ) public override {
        if (draws[roundId].state != DrawState.SNAPSHOTTED) revert RoundNotDrawing();
        super.finalizePrizeShard(roundId, prizeIndex, shard, decryptionProof);
    }

    function drawPrizeMember(uint256 roundId, uint8 prizeIndex) public override {
        DrawState state = draws[roundId].state;
        if (state != DrawState.SNAPSHOTTED && state != DrawState.DRAWN) revert RoundNotDrawing();
        super.drawPrizeMember(roundId, prizeIndex);
        _syncDrawnState(roundId);
    }

    function finalizePrizeMember(
        uint256 roundId,
        uint8 prizeIndex,
        bytes calldata abiEncodedClearWinner,
        bytes calldata decryptionProof
    ) public override {
        DrawState state = draws[roundId].state;
        if (state != DrawState.SNAPSHOTTED && state != DrawState.DRAWN) revert RoundNotFinalizing();
        super.finalizePrizeMember(roundId, prizeIndex, abiEncodedClearWinner, decryptionProof);
        _syncRoundFinalization(roundId);
    }

    function getDrawInfo(
        uint256 roundId
    )
        external
        view
        returns (
            uint64 snapshotBlock,
            uint16 participantCount,
            uint8 drawnPrizeCount,
            uint8 finalizedPrizeCount,
            uint8 winningPrizeCount,
            DrawState state
        )
    {
        DrawRecord storage draw = draws[roundId];
        if (draw.state == DrawState.NONE) revert UnknownRound();
        (drawnPrizeCount, finalizedPrizeCount, winningPrizeCount) = _prizeCounts(roundId);
        return (
            draw.snapshotBlock,
            draw.participantCount,
            drawnPrizeCount,
            finalizedPrizeCount,
            winningPrizeCount,
            draw.state
        );
    }

    function getDrawState(uint256 roundId) external view returns (DrawState) {
        return draws[roundId].state;
    }

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        return _encryptedShardedSnapshotWeightOf(roundId, msg.sender);
    }

    function getEncryptedPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (eaddress) {
        return getEncryptedPrizeMember(roundId, prizeIndex);
    }

    function getPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (address) {
        return getPrizeMember(roundId, prizeIndex);
    }

    function getPrizeStatus(
        uint256 roundId,
        uint8 prizeIndex
    ) external view returns (bool drawn, bool finalized, address winner) {
        (, , , drawn, finalized, winner) = getShardedPrizeStatus(roundId, prizeIndex);
    }

    function isDrawReady() public view returns (bool) {
        return block.timestamp >= nextDrawClosesAt;
    }

    function isDrawTimeReady() public view returns (bool) {
        return isDrawReady();
    }

    function canAdvanceDraw() public view returns (bool) {
        return isDrawReady();
    }

    function getDrawAvailability() public view returns (DrawAvailability) {
        return isDrawReady() ? DrawAvailability.READY : DrawAvailability.OPEN;
    }

    function hasUnsettledRounds() public view returns (bool) {
        return unsettledRoundCount != 0;
    }

    function isDrawOverdue() public view returns (bool) {
        return hasUnsettledRounds() && isDrawTimeReady();
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
            bool ready,
            bool canAdvance,
            bool insufficientParticipants,
            bool overdue
        )
    {
        return (
            nextRoundId,
            unsettledRoundCount,
            nextDrawOpensAt,
            nextDrawClosesAt,
            isDrawTimeReady(),
            isDrawReady(),
            canAdvanceDraw(),
            false,
            isDrawOverdue()
        );
    }

    function _syncDrawnState(uint256 roundId) private {
        DrawRecord storage draw = draws[roundId];
        if (draw.state != DrawState.SNAPSHOTTED) return;

        for (uint8 prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
            (, , , bool winnerDrawn, , ) = getShardedPrizeStatus(roundId, prizeIndex);
            if (!winnerDrawn) return;
        }
        draw.state = DrawState.DRAWN;
    }

    function _syncRoundFinalization(uint256 roundId) private {
        DrawRecord storage draw = draws[roundId];
        uint8 finalizedPrizeCount;
        uint8 winningPrizeCount;

        for (uint8 prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
            (, , , , bool winnerFinalized, address winner) = getShardedPrizeStatus(roundId, prizeIndex);
            if (winnerFinalized) {
                unchecked {
                    ++finalizedPrizeCount;
                    if (winner != address(0)) ++winningPrizeCount;
                }
            }
        }

        if (finalizedPrizeCount != PRIZE_SLOTS) return;

        unchecked {
            --unsettledRoundCount;
        }
        if (winningPrizeCount == 0) {
            draw.state = DrawState.CANCELLED;
            emit RoundCancelled(roundId);
        } else {
            draw.state = DrawState.FINALIZED;
            emit RoundFinalized(roundId, winningPrizeCount);
        }
    }

    function _prizeCounts(
        uint256 roundId
    ) private view returns (uint8 drawnPrizeCount, uint8 finalizedPrizeCount, uint8 winningPrizeCount) {
        for (uint8 prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
            (, , , bool winnerDrawn, bool winnerFinalized, address winner) = getShardedPrizeStatus(roundId, prizeIndex);
            if (winnerDrawn) ++drawnPrizeCount;
            if (winnerFinalized) {
                ++finalizedPrizeCount;
                if (winner != address(0)) ++winningPrizeCount;
            }
        }
    }

    function _updateNextDrawWindow() private {
        nextDrawOpensAt = _scheduledDrawOpensAt(nextRoundId);
        nextDrawClosesAt = nextDrawOpensAt + drawPeriod;
        emit DrawWindowOpened(nextRoundId, nextDrawOpensAt, nextDrawClosesAt);
    }

    function _scheduledDrawOpensAt(uint256 roundId) private view returns (uint64) {
        if (roundId == 0) revert InvalidRound();
        uint256 opensAt = uint256(firstDrawOpensAt) + ((roundId - 1) * uint256(drawPeriod));
        if (opensAt > type(uint64).max - uint256(drawPeriod)) revert ScheduleOverflow();
        return uint64(opensAt);
    }

    function _rosterCurrentWeight(address account) internal view override returns (euint64) {
        return positions[account].balance;
    }

    function _rosterNextRoundId() internal view override returns (uint256) {
        return nextRoundId;
    }

    function _rosterLatestClosedRoundId() internal view override returns (uint256) {
        uint256 firstClose = uint256(firstDrawOpensAt) + uint256(drawPeriod);
        if (block.timestamp < firstClose) return 0;
        return (block.timestamp - uint256(firstDrawOpensAt)) / uint256(drawPeriod);
    }

    function _rosterScheduledDrawClosesAt(uint256 roundId) internal view override returns (uint64) {
        return _scheduledDrawOpensAt(roundId) + drawPeriod;
    }
}
