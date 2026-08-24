// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions keep V0.5 readable while the economic model is still changing.
// Revisit these before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, immutable-vars-naming, named-parameters-mapping, gas-struct-packing
// solhint-disable max-states-count

import {FHE, ebool, eaddress, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984Asset {
    function isOperator(address holder, address spender) external view returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

/// @title VeilPool
/// @notice Privacy-first prize-pool foundation using confidential ERC-7984-style assets.
/// @dev Private positions and bounded BlindDraw seats are intentionally separate concepts. A position
///      remains withdrawable/decryptable even if its draw seat expires. Seats are leases so abandoned
///      or zero-weight accounts cannot permanently consume the 32-player bounded FHE draw roster.
contract VeilPool is ZamaEthereumConfig {
    uint8 public constant MAX_PLAYERS = 32;
    uint64 public constant SEAT_LEASE = 30 days;

    enum DrawState {
        NONE,
        SNAPSHOTTED,
        DRAWN,
        FINALIZED,
        CANCELLED
    }

    struct Position {
        euint64 balance;
        bool active;
    }

    struct Draw {
        uint64 snapshotBlock;
        uint8 participantCount;
        euint64 encryptedTotalWeight;
        eaddress encryptedWinner;
        address winner;
        DrawState state;
    }

    enum DrawAvailability {
        OPEN,
        READY,
        INSUFFICIENT_PARTICIPANTS
    }

    address public immutable owner;
    IERC7984Asset public immutable asset;
    uint64 public immutable drawPeriod;
    uint64 public immutable firstDrawOpensAt;

    mapping(address => Position) private positions;
    mapping(address => bool) public joined;

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public seated;
    mapping(address => uint64) public seatExpiresAt;
    uint8 public playerCount;

    euint64 private encryptedTotalWeight;
    uint256 public nextRoundId = 1;
    uint64 public nextDrawOpensAt;
    uint64 public nextDrawClosesAt;
    uint256 public lastSealedRoundId;
    uint256 public stateEpochCount;
    uint256 public unsettledRoundCount;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    // A state epoch is valid for a contiguous closed-round range. Epochs are created only when a
    // balance or seat mutation crosses a new close; unchanged periods are represented by one
    // range instead of one encrypted copy per round.
    struct StateEpoch {
        uint256 startRoundId;
        uint256 endRoundId;
        uint8 participantCount;
    }

    mapping(uint256 => StateEpoch) private stateEpochs;
    mapping(uint256 => mapping(uint8 => address)) private stateEpochPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private stateEpochWeights;
    mapping(uint256 => mapping(uint8 => uint64)) private stateEpochSeatExpiresAt;

    event PlayerJoined(address indexed player);
    event DrawSeatRenewed(address indexed player, uint64 expiresAt);
    event DrawSeatReleased(address indexed player);
    event DepositRecorded(address indexed player);
    event WithdrawalRecorded(address indexed player);
    event DrawWindowOpened(uint256 indexed roundId, uint64 opensAt, uint64 closesAt);
    event RoundSnapshotted(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event RoundSkipped(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event BlindDrawCompleted(uint256 indexed roundId, eaddress encryptedWinner);
    event WinnerFinalized(uint256 indexed roundId, address indexed winner);
    event RoundCancelled(uint256 indexed roundId);

    constructor(address asset_, uint64 drawPeriod_) {
        require(asset_ != address(0), "Invalid asset");
        require(drawPeriod_ > 0, "Invalid draw period");
        require(block.timestamp <= type(uint64).max - drawPeriod_, "Schedule overflow");
        owner = msg.sender;
        asset = IERC7984Asset(asset_);
        drawPeriod = drawPeriod_;
        firstDrawOpensAt = uint64(block.timestamp);

        _updateNextDrawWindow();

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);

        emit DrawWindowOpened(nextRoundId, nextDrawOpensAt, nextDrawClosesAt);
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(asset.isOperator(msg.sender, address(this)), "Pool not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        _sealCurrentStateForClosedRounds();

        if (!joined[msg.sender]) {
            positions[msg.sender].balance = FHE.asEuint64(0);
            positions[msg.sender].active = true;
            joined[msg.sender] = true;
            emit PlayerJoined(msg.sender);
        }

        _acquireOrRenewSeat(msg.sender);

        positions[msg.sender].balance = FHE.add(positions[msg.sender].balance, transferred);
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, transferred);

        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allow(positions[msg.sender].balance, msg.sender);

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

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(joined[msg.sender], "Not joined");

        _sealCurrentStateForClosedRounds();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // The asset contract sees the pool's aggregate custody. Guard the request against
        // this user's encrypted principal first so one depositor can never spend another's funds.
        // Oversized requests remain private and silently become zero.
        euint64 permitted = FHE.select(FHE.le(requested, positions[msg.sender].balance), requested, FHE.asEuint64(0));
        FHE.allowTransient(permitted, address(asset));
        euint64 transferred = asset.confidentialTransfer(msg.sender, permitted);

        positions[msg.sender].balance = FHE.sub(positions[msg.sender].balance, transferred);
        encryptedTotalWeight = FHE.sub(encryptedTotalWeight, transferred);

        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allow(positions[msg.sender].balance, msg.sender);

        emit WithdrawalRecorded(msg.sender);
    }

    function encryptedBalanceOf() external view returns (euint64) {
        require(joined[msg.sender], "Not joined");
        return positions[msg.sender].balance;
    }

    function getEncryptedTotalWeight() external view returns (euint64) {
        return encryptedTotalWeight;
    }

    function getPlayer(uint8 index) external view returns (address) {
        require(index < playerCount, "Invalid index");
        return players[index];
    }

    /// @notice Closes the current open draw window and freezes confidential weights.
    /// @dev Permissionless once the scheduled close time has passed. The snapshot consumes the
    ///      historical state epoch covering the scheduled close, so delayed execution cannot
    ///      change historical weights.
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
            (address account, uint64 expiresAt, euint64 weight) = _historicalPlayerAt(epochId, i);

            if (expiresAt < nextDrawClosesAt) continue;

            drawPlayers[roundId][snapshotParticipantCount] = account;
            drawWeights[roundId][snapshotParticipantCount] = weight;
            drawPlayerIndex[roundId][account] = snapshotParticipantCount;
            drawParticipantIncluded[roundId][account] = true;
            snapshotTotalWeight = FHE.add(snapshotTotalWeight, weight);

            FHE.allowThis(drawWeights[roundId][snapshotParticipantCount]);
            FHE.allow(drawWeights[roundId][snapshotParticipantCount], account);
            snapshotParticipantCount++;
        }

        require(snapshotParticipantCount >= 2, "Need 2 players");

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

    /// @notice Advances a closed round that had fewer than two eligible participants.
    /// @dev This is separate from snapshotRound so an insufficient round cannot be backfilled by
    ///      post-close entrants and the fixed schedule cannot become permanently stuck.
    function cancelInsufficientRound() external returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        roundId = nextRoundId;
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.NONE, "Round already advanced");
        require(_historicalParticipantCount(roundId, nextDrawClosesAt) < 2, "Enough players");

        unchecked {
            nextRoundId++;
        }
        _updateNextDrawWindow();

        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = _historicalParticipantCount(roundId, nextDrawClosesAt);
        draw.state = DrawState.CANCELLED;

        emit RoundSkipped(roundId, draw.participantCount, draw.snapshotBlock);
    }

    /// @notice Returns whether the scheduled draw window can be advanced by any caller.
    /// @dev This is an actionable readiness check. Use isDrawTimeReady() when only the timer is
    ///      needed; insufficient close-time participation is reported separately.
    function isDrawReady() public view returns (bool) {
        return getDrawAvailability() == DrawAvailability.READY;
    }

    /// @notice Returns whether the scheduled close time has passed, regardless of participation.
    function isDrawTimeReady() public view returns (bool) {
        return block.timestamp >= nextDrawClosesAt;
    }

    /// @notice Returns whether the closed scheduled round can be advanced by snapshot or cancellation.
    function canAdvanceDraw() public view returns (bool) {
        return getDrawAvailability() != DrawAvailability.OPEN;
    }

    /// @notice Returns the frontend-visible readiness state for the scheduled round.
    function getDrawAvailability() public view returns (DrawAvailability) {
        if (!isDrawTimeReady()) return DrawAvailability.OPEN;

        return
            _historicalParticipantCount(nextRoundId, nextDrawClosesAt) >= 2
                ? DrawAvailability.READY
                : DrawAvailability.INSUFFICIENT_PARTICIPANTS;
    }

    /// @notice Returns whether any snapshotted or drawn rounds still await settlement.
    function hasUnsettledRounds() public view returns (bool) {
        return unsettledRoundCount != 0;
    }

    /// @notice Returns whether a scheduled window is overdue while another round awaits KMS settlement.
    function isDrawOverdue() public view returns (bool) {
        return hasUnsettledRounds() && isDrawTimeReady();
    }

    /// @notice Returns the public schedule needed to render the current draw lifecycle.
    /// @dev `currentRoundId` is the next scheduled round awaiting snapshot. Settlement is
    ///      independent and is represented by the unsettled round count plus getDrawInfo(roundId).
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

    /// @notice Runs the FHE weighted selection against an already frozen round.
    /// @dev Permissionless. The random target and all weights remain encrypted.
    function blindDraw(uint256 roundId) external {
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.SNAPSHOTTED, "Round not ready");

        euint64 randomValue = FHE.randEuint64();
        euint128 product = FHE.mul(FHE.asEuint128(randomValue), FHE.asEuint128(draw.encryptedTotalWeight));
        euint64 target = FHE.asEuint64(FHE.shr(product, 64));

        euint64 cumulative = FHE.asEuint64(0);
        eaddress winner = FHE.asEaddress(address(0));
        ebool selected = FHE.asEbool(false);

        for (uint8 i = 0; i < draw.participantCount; i++) {
            cumulative = FHE.add(cumulative, drawWeights[roundId][i]);

            ebool crossesTarget = FHE.lt(target, cumulative);
            ebool chooseThisPlayer = FHE.and(crossesTarget, FHE.not(selected));

            winner = FHE.select(chooseThisPlayer, FHE.asEaddress(drawPlayers[roundId][i]), winner);
            selected = FHE.or(selected, crossesTarget);
        }

        draw.encryptedWinner = winner;
        draw.state = DrawState.DRAWN;

        FHE.allowThis(draw.encryptedWinner);
        FHE.makePubliclyDecryptable(draw.encryptedWinner);

        emit BlindDrawCompleted(roundId, draw.encryptedWinner);
    }

    function finalizeWinner(
        uint256 roundId,
        bytes calldata abiEncodedClearWinner,
        bytes calldata decryptionProof
    ) external {
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.DRAWN, "Round not awaiting finalization");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(draw.encryptedWinner);
        FHE.checkSignatures(handles, abiEncodedClearWinner, decryptionProof);

        address clearWinner = abi.decode(abiEncodedClearWinner, (address));
        if (clearWinner == address(0)) {
            draw.state = DrawState.CANCELLED;
            unsettledRoundCount--;
            emit RoundCancelled(roundId);
            return;
        }

        draw.winner = clearWinner;
        draw.state = DrawState.FINALIZED;
        unsettledRoundCount--;
        emit WinnerFinalized(roundId, clearWinner);
    }

    function getDrawInfo(
        uint256 roundId
    ) external view returns (uint64 snapshotBlock, uint8 participantCount, DrawState state) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        return (draw.snapshotBlock, draw.participantCount, draw.state);
    }

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return drawWeights[roundId][drawPlayerIndex[roundId][msg.sender]];
    }

    function getEncryptedWinner(uint256 roundId) external view returns (eaddress) {
        Draw storage draw = draws[roundId];
        require(
            draw.state == DrawState.DRAWN || draw.state == DrawState.FINALIZED || draw.state == DrawState.CANCELLED,
            "Winner unavailable"
        );
        return draw.encryptedWinner;
    }

    function getWinner(uint256 roundId) external view returns (address) {
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.FINALIZED, "Winner not finalized");
        return draw.winner;
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

    /// @dev Seals the current encrypted roster once for the newly closed range before a caller can
    ///      mutate balances or seats. The same encrypted handle is retained; no plaintext balance
    ///      or eligibility is exposed.
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
            FHE.allowThis(stateEpochWeights[epochId][i]);
        }

        stateEpochCount = epochId;
        lastSealedRoundId = latestClosedRoundId;
    }

    function _stateEpochForRound(uint256 roundId) private view returns (uint256) {
        for (uint256 epochId = stateEpochCount; epochId > 0; epochId--) {
            StateEpoch storage epoch = stateEpochs[epochId];
            if (roundId > epoch.endRoundId) return 0;
            if (roundId >= epoch.startRoundId) return epochId;
        }

        return 0;
    }

    function _historicalPlayerAt(
        uint256 epochId,
        uint8 index
    ) private view returns (address account, uint64 expiresAt, euint64 weight) {
        if (epochId == 0) {
            account = players[index];
            expiresAt = seatExpiresAt[account];
            weight = positions[account].balance;
        } else {
            account = stateEpochPlayers[epochId][index];
            expiresAt = stateEpochSeatExpiresAt[epochId][index];
            weight = stateEpochWeights[epochId][index];
        }
    }

    function _historicalParticipantCount(uint256 roundId, uint64 closesAt) private view returns (uint8 count) {
        uint256 epochId = _stateEpochForRound(roundId);
        uint8 sourceParticipantCount = epochId == 0 ? playerCount : stateEpochs[epochId].participantCount;

        for (uint8 i = 0; i < sourceParticipantCount; i++) {
            uint64 expiresAt = epochId == 0 ? seatExpiresAt[players[i]] : stateEpochSeatExpiresAt[epochId][i];
            if (expiresAt >= closesAt) count++;
        }
    }

    function _acquireOrRenewSeat(address account) private {
        if (!seated[account]) {
            _pruneExpiredSeats();
            require(playerCount < MAX_PLAYERS, "Draw roster full");
            players[playerCount] = account;
            playerIndex[account] = playerCount;
            seated[account] = true;
            unchecked {
                playerCount++;
            }
        }

        uint64 expiresAt = uint64(block.timestamp + SEAT_LEASE);
        uint64 nextWindowClose = _scheduledDrawClosesAt(nextRoundId + 1);
        if (expiresAt < nextWindowClose) expiresAt = nextWindowClose;
        seatExpiresAt[account] = expiresAt;
        emit DrawSeatRenewed(account, expiresAt);
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

        unchecked {
            playerCount--;
        }

        emit DrawSeatReleased(account);
    }
}
