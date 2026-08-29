// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// UNVEIL V3 keeps the confidential custody boundary from V2 while tightening draw economics:
// one full-round maturity, three independently drawn prize slots, and an HCU-safe bounded roster.
// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, immutable-vars-naming, named-parameters-mapping
// solhint-disable gas-custom-errors, gas-struct-packing, max-states-count, function-max-lines

import {FHE, ebool, eaddress, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

interface IVeilStrategyManagerV3 {
    function pool() external view returns (address);

    function principalAsset() external view returns (address);

    function recordPrincipalDeposit(address account, euint64 transferred) external;

    function requestPrincipalWithdrawal(
        address account,
        euint64 permittedAmount
    ) external returns (uint256 requestId, euint64 acceptedAmount, euint64 actualTransferred, euint64 queuedAmount);

    function cancelPrincipalWithdrawal(uint256 requestId) external returns (euint64 canceledAmount);
}

/// @title VeilPoolV3
/// @notice Confidential prize-savings pool with mature encrypted ticket power and three prize slots.
/// @dev A round uses min(balance at the previous scheduled close, balance at this scheduled close)
///      as its encrypted ticket power. This makes new principal wait through a full draw period and
///      prevents a last-second deposit from receiving immediate draw power.
contract VeilPoolV3 is ZamaEthereumConfig {
    // The current Zama HCU table places the V2 linear BlindDraw depth above the published 5M
    // sequential limit at 30+ seats. Twenty-four leaves meaningful execution headroom.
    uint8 public constant MAX_PLAYERS = 24;
    uint8 public constant PRIZE_SLOTS = 3;
    uint64 public constant SEAT_LEASE = 30 days;

    enum DrawState {
        NONE,
        SNAPSHOTTED,
        DRAWN,
        FINALIZED,
        CANCELLED,
        SKIPPED
    }

    struct Position {
        euint64 balance;
        bool active;
    }

    struct PrizeResult {
        eaddress encryptedWinner;
        address winner;
        bool drawn;
        bool finalized;
    }

    struct Draw {
        uint64 snapshotBlock;
        uint8 participantCount;
        uint8 drawnPrizeCount;
        uint8 finalizedPrizeCount;
        uint8 winningPrizeCount;
        euint64 encryptedTotalWeight;
        DrawState state;
    }

    enum DrawAvailability {
        OPEN,
        READY,
        INSUFFICIENT_PARTICIPANTS
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

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public seated;
    mapping(address => uint64) public seatExpiresAt;
    mapping(address => uint256) public seatEligibleFromRoundId;
    uint8 public playerCount;

    euint64 private encryptedTotalWeight;
    uint256 public nextRoundId = 1;
    uint64 public nextDrawOpensAt;
    uint64 public nextDrawClosesAt;
    uint256 public lastSealedRoundId;
    uint256 public stateEpochCount;
    uint256 public unsettledRoundCount;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => PrizeResult)) private drawPrizeResults;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    struct StateEpoch {
        uint256 startRoundId;
        uint256 endRoundId;
        uint8 participantCount;
    }

    mapping(uint256 => StateEpoch) private stateEpochs;
    mapping(uint256 => mapping(uint8 => address)) private stateEpochPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private stateEpochWeights;
    mapping(uint256 => mapping(uint8 => uint64)) private stateEpochSeatExpiresAt;
    mapping(uint256 => mapping(uint8 => uint256)) private stateEpochSeatEligibleFromRoundId;

    event StrategyManagerConfigured(address indexed manager);
    event PlayerJoined(address indexed player);
    event DrawSeatRenewed(address indexed player, uint64 expiresAt, uint256 eligibleFromRoundId);
    event DrawSeatReleased(address indexed player);
    event DepositRecorded(address indexed player);
    event WithdrawalRecorded(address indexed player, uint256 indexed requestId);
    event DrawWindowOpened(uint256 indexed roundId, uint64 opensAt, uint64 closesAt);
    event RoundSnapshotted(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event RoundSkipped(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event BlindDrawPrizeCompleted(uint256 indexed roundId, uint8 indexed prizeIndex, eaddress encryptedWinner);
    event PrizeWinnerFinalized(uint256 indexed roundId, uint8 indexed prizeIndex, address indexed winner);
    event RoundFinalized(uint256 indexed roundId, uint8 winningPrizeCount);
    event RoundCancelled(uint256 indexed roundId);

    constructor(IERC7984 asset_, uint64 drawPeriod_) ZamaEthereumConfig() {
        require(address(asset_) != address(0), "Invalid asset");
        require(drawPeriod_ > 0, "Invalid draw period");
        require(block.timestamp <= type(uint64).max - drawPeriod_, "Schedule overflow");
        owner = msg.sender;
        asset = asset_;
        drawPeriod = drawPeriod_;
        firstDrawOpensAt = uint64(block.timestamp);

        _updateNextDrawWindow();

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
        emit DrawWindowOpened(nextRoundId, nextDrawOpensAt, nextDrawClosesAt);
    }

    function configureStrategyManager(address manager_) external {
        require(msg.sender == owner, "Not owner");
        require(!strategyManagerConfigured, "Manager already configured");
        require(manager_ != address(0), "Invalid manager");
        require(IVeilStrategyManagerV3(manager_).pool() == address(this), "Invalid manager pool");
        require(IVeilStrategyManagerV3(manager_).principalAsset() == address(asset), "Invalid manager asset");

        strategyManager = manager_;
        strategyManagerConfigured = true;
        emit StrategyManagerConfigured(manager_);
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(strategyManagerConfigured, "Manager not configured");
        require(asset.isOperator(msg.sender, address(this)), "Pool not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 transferred = asset.confidentialTransferFrom(msg.sender, strategyManager, requested);
        FHE.allowTransient(transferred, strategyManager);
        IVeilStrategyManagerV3(strategyManager).recordPrincipalDeposit(msg.sender, transferred);

        _sealCurrentStateForClosedRounds();

        if (!joined[msg.sender]) {
            positions[msg.sender].balance = FHE.asEuint64(0);
            reservedWithdrawals[msg.sender] = FHE.asEuint64(0);
            positions[msg.sender].active = true;
            joined[msg.sender] = true;
            emit PlayerJoined(msg.sender);
        }

        _acquireOrRenewSeat(msg.sender);

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
        require(joined[msg.sender], "Not joined");
        _sealCurrentStateForClosedRounds();
        _acquireOrRenewSeat(msg.sender);
    }

    function leaveDrawSeat() external {
        require(seated[msg.sender], "Not seated");
        _sealCurrentStateForClosedRounds();
        _removeSeat(msg.sender);
    }

    function pruneExpiredSeats() external {
        _sealCurrentStateForClosedRounds();
        _pruneExpiredSeats();
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (uint256 requestId) {
        require(strategyManagerConfigured, "Manager not configured");
        require(joined[msg.sender], "Not joined");

        _sealCurrentStateForClosedRounds();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 permitted = FHE.select(FHE.le(requested, positions[msg.sender].balance), requested, FHE.asEuint64(0));
        FHE.allowTransient(permitted, strategyManager);

        euint64 acceptedAmount;
        euint64 queuedAmount;
        (requestId, acceptedAmount, , queuedAmount) = IVeilStrategyManagerV3(strategyManager)
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
        require(strategyManagerConfigured, "Manager not configured");
        require(withdrawalRequestAccount[requestId] == msg.sender, "Not request owner");
        canceledAmount = IVeilStrategyManagerV3(strategyManager).cancelPrincipalWithdrawal(requestId);
    }

    function onManagerWithdrawalPaid(uint256 requestId, euint64 amount) external {
        require(msg.sender == strategyManager, "Only manager");
        address account = withdrawalRequestAccount[requestId];
        require(account != address(0), "Unknown request");
        require(!withdrawalRequestCanceled[requestId], "Request canceled");

        euint64 requestRemaining = withdrawalRequestReserved[requestId];
        euint64 applied = FHE.select(FHE.le(amount, requestRemaining), amount, FHE.asEuint64(0));
        withdrawalRequestReserved[requestId] = FHESafeMath.saturatingSub(requestRemaining, applied);
        reservedWithdrawals[account] = FHESafeMath.saturatingSub(reservedWithdrawals[account], applied);

        FHE.allowThis(withdrawalRequestReserved[requestId]);
        FHE.allowThis(reservedWithdrawals[account]);
        FHE.allow(reservedWithdrawals[account], account);
    }

    function onManagerWithdrawalCanceled(uint256 requestId, euint64 amount) external {
        require(msg.sender == strategyManager, "Only manager");
        address account = withdrawalRequestAccount[requestId];
        require(account != address(0), "Unknown request");
        require(!withdrawalRequestCanceled[requestId], "Request already canceled");

        _sealCurrentStateForClosedRounds();

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
        require(joined[msg.sender], "Not joined");
        return positions[msg.sender].balance;
    }

    function encryptedReservedWithdrawalOf() external view returns (euint64) {
        require(joined[msg.sender], "Not joined");
        return reservedWithdrawals[msg.sender];
    }

    function getEncryptedTotalWeight() external view returns (euint64) {
        return encryptedTotalWeight;
    }

    function getPlayer(uint8 index) external view returns (address) {
        require(index < playerCount, "Invalid index");
        return players[index];
    }

    function snapshotRound() external returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        roundId = nextRoundId;
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.NONE, "Round already snapshotted");
        euint64 snapshotTotalWeight = FHE.asEuint64(0);
        uint8 snapshotParticipantCount;
        uint256 epochId = _stateEpochForRound(roundId);
        uint8 sourceParticipantCount = epochId == 0 ? playerCount : stateEpochs[epochId].participantCount;

        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            (address account, uint64 expiresAt, euint64 closeWeight, uint256 eligibleFromRoundId) = _historicalPlayerAt(
                epochId,
                i
            );
            if (expiresAt < nextDrawClosesAt || eligibleFromRoundId == 0 || eligibleFromRoundId > roundId) continue;

            euint64 previousCloseWeight = roundId == 1 ? FHE.asEuint64(0) : _historicalWeightOf(roundId - 1, account);
            euint64 matureWeight = FHE.min(previousCloseWeight, closeWeight);

            drawPlayers[roundId][snapshotParticipantCount] = account;
            drawWeights[roundId][snapshotParticipantCount] = matureWeight;
            drawPlayerIndex[roundId][account] = snapshotParticipantCount;
            drawParticipantIncluded[roundId][account] = true;
            snapshotTotalWeight = FHE.add(snapshotTotalWeight, matureWeight);

            FHE.allowThis(drawWeights[roundId][snapshotParticipantCount]);
            FHE.allow(drawWeights[roundId][snapshotParticipantCount], account);
            snapshotParticipantCount++;
        }

        require(snapshotParticipantCount >= 2, "Need 2 mature seats");
        unchecked {
            nextRoundId++;
        }
        _updateNextDrawWindow();

        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = snapshotParticipantCount;
        draw.state = DrawState.SNAPSHOTTED;
        unsettledRoundCount++;
        draw.encryptedTotalWeight = snapshotTotalWeight;
        FHE.allowThis(draw.encryptedTotalWeight);
        emit RoundSnapshotted(roundId, draw.participantCount, draw.snapshotBlock);
    }

    function cancelInsufficientRound() external returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        roundId = nextRoundId;
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.NONE, "Round already advanced");
        uint64 roundClosesAt = nextDrawClosesAt;
        uint8 participantCount = _historicalParticipantCount(roundId, roundClosesAt);
        require(participantCount < 2, "Enough mature seats");

        unchecked {
            nextRoundId++;
        }
        _updateNextDrawWindow();

        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = participantCount;
        draw.state = DrawState.SKIPPED;
        emit RoundSkipped(roundId, draw.participantCount, draw.snapshotBlock);
    }

    function isDrawReady() public view returns (bool) {
        return getDrawAvailability() == DrawAvailability.READY;
    }

    function isDrawTimeReady() public view returns (bool) {
        return block.timestamp >= nextDrawClosesAt;
    }

    function canAdvanceDraw() public view returns (bool) {
        return getDrawAvailability() != DrawAvailability.OPEN;
    }

    function getDrawAvailability() public view returns (DrawAvailability) {
        if (!isDrawTimeReady()) return DrawAvailability.OPEN;
        return
            _historicalParticipantCount(nextRoundId, nextDrawClosesAt) >= 2
                ? DrawAvailability.READY
                : DrawAvailability.INSUFFICIENT_PARTICIPANTS;
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
            getDrawAvailability() == DrawAvailability.INSUFFICIENT_PARTICIPANTS,
            isDrawOverdue()
        );
    }

    function blindDrawPrize(uint256 roundId, uint8 prizeIndex) external {
        require(prizeIndex < PRIZE_SLOTS, "Invalid prize index");
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.SNAPSHOTTED, "Round not drawing");
        PrizeResult storage prize = drawPrizeResults[roundId][prizeIndex];
        require(!prize.drawn, "Prize already drawn");

        euint64 randomValue = FHE.randEuint64();
        euint128 product = FHE.mul(FHE.asEuint128(randomValue), FHE.asEuint128(draw.encryptedTotalWeight));
        euint64 target = FHE.asEuint64(FHE.shr(product, 64));
        eaddress winner = _selectPrizeWinner(roundId, draw.participantCount, target);

        prize.encryptedWinner = winner;
        prize.drawn = true;
        draw.drawnPrizeCount++;
        FHE.allowThis(prize.encryptedWinner);
        FHE.makePubliclyDecryptable(prize.encryptedWinner);
        if (draw.drawnPrizeCount == PRIZE_SLOTS) draw.state = DrawState.DRAWN;
        emit BlindDrawPrizeCompleted(roundId, prizeIndex, prize.encryptedWinner);
    }

    function _selectPrizeWinner(
        uint256 roundId,
        uint8 participantCount,
        euint64 target
    ) private returns (eaddress winner) {
        euint64 cumulative = FHE.asEuint64(0);
        winner = FHE.asEaddress(address(0));
        ebool selected = FHE.asEbool(false);

        for (uint8 i = 0; i < participantCount; i++) {
            cumulative = FHE.add(cumulative, drawWeights[roundId][i]);
            ebool crossesTarget = FHE.lt(target, cumulative);
            ebool chooseThisPlayer = FHE.and(crossesTarget, FHE.not(selected));
            winner = FHE.select(chooseThisPlayer, FHE.asEaddress(drawPlayers[roundId][i]), winner);
            selected = FHE.or(selected, crossesTarget);
        }
    }

    function finalizePrizeWinner(
        uint256 roundId,
        uint8 prizeIndex,
        bytes calldata abiEncodedClearWinner,
        bytes calldata decryptionProof
    ) external {
        require(prizeIndex < PRIZE_SLOTS, "Invalid prize index");
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.SNAPSHOTTED || draw.state == DrawState.DRAWN, "Round not finalizing");
        PrizeResult storage prize = drawPrizeResults[roundId][prizeIndex];
        require(prize.drawn, "Prize not drawn");
        require(!prize.finalized, "Prize already finalized");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(prize.encryptedWinner);
        FHE.checkSignatures(handles, abiEncodedClearWinner, decryptionProof);

        address clearWinner = abi.decode(abiEncodedClearWinner, (address));
        prize.winner = clearWinner;
        prize.finalized = true;
        draw.finalizedPrizeCount++;
        if (clearWinner != address(0)) draw.winningPrizeCount++;
        emit PrizeWinnerFinalized(roundId, prizeIndex, clearWinner);

        if (draw.finalizedPrizeCount != PRIZE_SLOTS) return;

        unsettledRoundCount--;
        if (draw.winningPrizeCount == 0) {
            draw.state = DrawState.CANCELLED;
            emit RoundCancelled(roundId);
        } else {
            draw.state = DrawState.FINALIZED;
            emit RoundFinalized(roundId, draw.winningPrizeCount);
        }
    }

    function getDrawInfo(
        uint256 roundId
    )
        external
        view
        returns (
            uint64 snapshotBlock,
            uint8 participantCount,
            uint8 drawnPrizeCount,
            uint8 finalizedPrizeCount,
            uint8 winningPrizeCount,
            DrawState state
        )
    {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        return (
            draw.snapshotBlock,
            draw.participantCount,
            draw.drawnPrizeCount,
            draw.finalizedPrizeCount,
            draw.winningPrizeCount,
            draw.state
        );
    }

    function getDrawState(uint256 roundId) external view returns (DrawState) {
        return draws[roundId].state;
    }

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return drawWeights[roundId][drawPlayerIndex[roundId][msg.sender]];
    }

    function getEncryptedPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (eaddress) {
        require(prizeIndex < PRIZE_SLOTS, "Invalid prize index");
        PrizeResult storage prize = drawPrizeResults[roundId][prizeIndex];
        require(prize.drawn, "Winner unavailable");
        return prize.encryptedWinner;
    }

    function getPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (address) {
        require(prizeIndex < PRIZE_SLOTS, "Invalid prize index");
        PrizeResult storage prize = drawPrizeResults[roundId][prizeIndex];
        require(prize.finalized, "Winner not finalized");
        return prize.winner;
    }

    function getPrizeStatus(
        uint256 roundId,
        uint8 prizeIndex
    ) external view returns (bool drawn, bool finalized, address winner) {
        require(prizeIndex < PRIZE_SLOTS, "Invalid prize index");
        PrizeResult storage prize = drawPrizeResults[roundId][prizeIndex];
        return (prize.drawn, prize.finalized, prize.winner);
    }

    function getSnapshotPlayer(uint256 roundId, uint8 index) external view returns (address) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        require(index < draw.participantCount, "Invalid index");
        return drawPlayers[roundId][index];
    }

    function _updateNextDrawWindow() private {
        nextDrawOpensAt = _scheduledDrawOpensAt(nextRoundId);
        nextDrawClosesAt = nextDrawOpensAt + drawPeriod;
        emit DrawWindowOpened(nextRoundId, nextDrawOpensAt, nextDrawClosesAt);
    }

    function _scheduledDrawOpensAt(uint256 roundId) private view returns (uint64) {
        require(roundId > 0, "Invalid round");
        uint256 opensAt = uint256(firstDrawOpensAt) + ((roundId - 1) * uint256(drawPeriod));
        require(opensAt <= type(uint64).max - uint256(drawPeriod), "Schedule overflow");
        return uint64(opensAt);
    }

    function _scheduledDrawClosesAt(uint256 roundId) private view returns (uint64) {
        return _scheduledDrawOpensAt(roundId) + drawPeriod;
    }

    function _latestClosedRoundId() private view returns (uint256) {
        uint256 firstClose = uint256(firstDrawOpensAt) + uint256(drawPeriod);
        if (block.timestamp < firstClose) return 0;
        return (block.timestamp - uint256(firstDrawOpensAt)) / uint256(drawPeriod);
    }

    function _sealCurrentStateForClosedRounds() private {
        uint256 latestClosedRoundId = _latestClosedRoundId();
        if (latestClosedRoundId <= lastSealedRoundId) return;

        uint256 epochId = stateEpochCount + 1;
        StateEpoch storage epoch = stateEpochs[epochId];
        epoch.startRoundId = lastSealedRoundId + 1;
        epoch.endRoundId = latestClosedRoundId;
        epoch.participantCount = playerCount;

        for (uint8 i = 0; i < playerCount; i++) {
            address account = players[i];
            stateEpochPlayers[epochId][i] = account;
            stateEpochWeights[epochId][i] = positions[account].balance;
            stateEpochSeatExpiresAt[epochId][i] = seatExpiresAt[account];
            stateEpochSeatEligibleFromRoundId[epochId][i] = seatEligibleFromRoundId[account];
            FHE.allowThis(stateEpochWeights[epochId][i]);
        }

        stateEpochCount = epochId;
        lastSealedRoundId = latestClosedRoundId;
    }

    function _stateEpochForRound(uint256 roundId) private view returns (uint256) {
        uint256 low = 1;
        uint256 high = stateEpochCount;
        while (low <= high) {
            uint256 middle = low + ((high - low) / 2);
            StateEpoch storage epoch = stateEpochs[middle];
            if (roundId < epoch.startRoundId) high = middle - 1;
            else if (roundId > epoch.endRoundId) low = middle + 1;
            else return middle;
        }
        return 0;
    }

    function _historicalPlayerAt(
        uint256 epochId,
        uint8 index
    ) private view returns (address account, uint64 expiresAt, euint64 weight, uint256 eligibleFromRoundId) {
        if (epochId == 0) {
            account = players[index];
            expiresAt = seatExpiresAt[account];
            weight = positions[account].balance;
            eligibleFromRoundId = seatEligibleFromRoundId[account];
        } else {
            account = stateEpochPlayers[epochId][index];
            expiresAt = stateEpochSeatExpiresAt[epochId][index];
            weight = stateEpochWeights[epochId][index];
            eligibleFromRoundId = stateEpochSeatEligibleFromRoundId[epochId][index];
        }
    }

    function _historicalWeightOf(uint256 roundId, address account) private returns (euint64) {
        if (roundId == 0) return FHE.asEuint64(0);
        uint256 epochId = _stateEpochForRound(roundId);
        uint8 sourceParticipantCount = epochId == 0 ? playerCount : stateEpochs[epochId].participantCount;
        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            address candidate = epochId == 0 ? players[i] : stateEpochPlayers[epochId][i];
            if (candidate != account) continue;
            return epochId == 0 ? positions[account].balance : stateEpochWeights[epochId][i];
        }
        return FHE.asEuint64(0);
    }

    function _historicalParticipantCount(uint256 roundId, uint64 closesAt) private view returns (uint8 count) {
        uint256 epochId = _stateEpochForRound(roundId);
        uint8 sourceParticipantCount = epochId == 0 ? playerCount : stateEpochs[epochId].participantCount;
        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            address account = epochId == 0 ? players[i] : stateEpochPlayers[epochId][i];
            uint64 expiresAt = epochId == 0 ? seatExpiresAt[account] : stateEpochSeatExpiresAt[epochId][i];
            uint256 eligibleFromRoundId =
                epochId == 0 ? seatEligibleFromRoundId[account] : stateEpochSeatEligibleFromRoundId[epochId][i];
            if (expiresAt >= closesAt && eligibleFromRoundId != 0 && eligibleFromRoundId <= roundId) count++;
        }
    }

    function _acquireOrRenewSeat(address account) private {
        if (!seated[account]) {
            _pruneExpiredSeats();
            require(playerCount < MAX_PLAYERS, "Draw roster full");
            players[playerCount] = account;
            playerIndex[account] = playerCount;
            seated[account] = true;
            seatEligibleFromRoundId[account] = nextRoundId + 1;
            unchecked {
                playerCount++;
            }
        }

        uint64 expiresAt = uint64(block.timestamp + SEAT_LEASE);
        uint64 nextWindowClose = _scheduledDrawClosesAt(nextRoundId + 1);
        if (expiresAt < nextWindowClose) expiresAt = nextWindowClose;
        seatExpiresAt[account] = expiresAt;
        emit DrawSeatRenewed(account, expiresAt, seatEligibleFromRoundId[account]);
    }

    function _pruneExpiredSeats() private {
        uint8 i = 0;
        while (i < playerCount) {
            address account = players[i];
            if (seatExpiresAt[account] < block.timestamp) {
                _removeSeat(account);
            } else {
                unchecked {
                    i++;
                }
            }
        }
    }

    function _removeSeat(address account) private {
        uint8 index = playerIndex[account];
        uint8 lastIndex = playerCount - 1;
        if (index != lastIndex) {
            address moved = players[lastIndex];
            players[index] = moved;
            playerIndex[moved] = index;
        }
        players[lastIndex] = address(0);
        delete playerIndex[account];
        seated[account] = false;
        seatExpiresAt[account] = 0;
        seatEligibleFromRoundId[account] = 0;
        unchecked {
            playerCount--;
        }
        emit DrawSeatReleased(account);
    }
}
