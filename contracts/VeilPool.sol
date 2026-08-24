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
    uint64 public constant SEAT_LEASE = 1 days;

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
    uint256 public lastCheckpointedRoundId;
    uint256 public unsettledRoundCount;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    // Close checkpoints are created lazily by any state-changing call that crosses one or more
    // scheduled close times. They preserve the encrypted balance and seat membership at the
    // boundary without locking principal or depending on a keeper transaction at the deadline.
    mapping(uint256 => bool) private closeCheckpointed;
    mapping(uint256 => uint8) private closeParticipantCount;
    mapping(uint256 => mapping(uint8 => address)) private closeParticipants;
    mapping(uint256 => mapping(address => bool)) private closeParticipantIncluded;
    mapping(uint256 => mapping(address => euint64)) private closeWeights;

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

        _checkpointPassedRounds();

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
        _checkpointPassedRounds();
        _acquireOrRenewSeat(msg.sender);
    }

    function leaveDrawSeat() external {
        require(seated[msg.sender], "Not seated");
        _checkpointPassedRounds();
        _removeSeat(msg.sender);
    }

    function pruneExpiredSeats() external {
        _checkpointPassedRounds();
        _pruneExpiredSeats();
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(joined[msg.sender], "Not joined");

        _checkpointPassedRounds();

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
    ///      encrypted close checkpoint, so delayed execution cannot change historical weights.
    function snapshotRound() external returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        _checkpointPassedRounds();

        roundId = nextRoundId;
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.NONE, "Round already snapshotted");
        require(closeCheckpointed[roundId], "Close not checkpointed");
        require(closeParticipantCount[roundId] >= 2, "Need 2 players");

        _pruneExpiredSeats();

        unchecked {
            nextRoundId++;
        }
        _updateNextDrawWindow();

        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = closeParticipantCount[roundId];
        draw.state = DrawState.SNAPSHOTTED;
        unsettledRoundCount++;

        euint64 snapshotTotalWeight = FHE.asEuint64(0);

        for (uint8 i = 0; i < draw.participantCount; i++) {
            address account = closeParticipants[roundId][i];
            euint64 weight = closeWeights[roundId][account];

            drawPlayers[roundId][i] = account;
            drawWeights[roundId][i] = weight;
            drawPlayerIndex[roundId][account] = i;
            drawParticipantIncluded[roundId][account] = true;
            snapshotTotalWeight = FHE.add(snapshotTotalWeight, weight);

            FHE.allowThis(drawWeights[roundId][i]);
            FHE.allow(drawWeights[roundId][i], account);
        }

        draw.encryptedTotalWeight = snapshotTotalWeight;
        FHE.allowThis(draw.encryptedTotalWeight);

        emit RoundSnapshotted(roundId, draw.participantCount, draw.snapshotBlock);
    }

    /// @notice Advances a closed round that had fewer than two eligible participants.
    /// @dev This is separate from snapshotRound so an insufficient round cannot be backfilled by
    ///      post-close entrants and the fixed schedule cannot become permanently stuck.
    function cancelInsufficientRound() external returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        _checkpointPassedRounds();

        roundId = nextRoundId;
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.NONE, "Round already advanced");
        require(closeCheckpointed[roundId], "Close not checkpointed");
        require(closeParticipantCount[roundId] < 2, "Enough players");

        unchecked {
            nextRoundId++;
        }
        _updateNextDrawWindow();

        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = closeParticipantCount[roundId];
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

        if (closeCheckpointed[nextRoundId]) {
            return
                closeParticipantCount[nextRoundId] >= 2
                    ? DrawAvailability.READY
                    : DrawAvailability.INSUFFICIENT_PARTICIPANTS;
        }

        return
            _currentEligibleCountAtClose(nextDrawClosesAt) >= 2
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

    /// @dev Materializes every crossed close before a caller can mutate balances or seats. The
    ///      same encrypted handle is retained; no plaintext balance or eligibility is exposed.
    function _checkpointPassedRounds() private {
        uint256 latestClosedRoundId = _latestClosedRoundId();
        if (latestClosedRoundId <= lastCheckpointedRoundId) return;

        uint256 roundId = lastCheckpointedRoundId + 1;
        while (roundId <= latestClosedRoundId) {
            uint64 closesAt = _scheduledDrawClosesAt(roundId);

            for (uint8 i = 0; i < playerCount; i++) {
                address account = players[i];
                if (seatExpiresAt[account] < closesAt || closeParticipantIncluded[roundId][account]) continue;

                closeParticipantIncluded[roundId][account] = true;
                closeParticipants[roundId][closeParticipantCount[roundId]] = account;
                closeParticipantCount[roundId]++;
                closeWeights[roundId][account] = positions[account].balance;
                FHE.allowThis(closeWeights[roundId][account]);
            }

            closeCheckpointed[roundId] = true;
            roundId++;
        }

        lastCheckpointedRoundId = latestClosedRoundId;
    }

    function _currentEligibleCountAtClose(uint64 closesAt) private view returns (uint8 count) {
        for (uint8 i = 0; i < playerCount; i++) {
            if (seatExpiresAt[players[i]] >= closesAt) count++;
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
