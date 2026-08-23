// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions keep V0.5 readable while the economic model is still changing.
// Revisit these before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, immutable-vars-naming, named-parameters-mapping, gas-struct-packing

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
    uint64 public constant DEFAULT_DRAW_PERIOD = 1 days;
    uint64 public constant SEPOLIA_DRAW_PERIOD = 15 minutes;

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

    address public immutable owner;
    IERC7984Asset public immutable asset;
    uint64 public immutable drawPeriod;

    mapping(address => Position) private positions;
    mapping(address => bool) public joined;

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public seated;
    mapping(address => uint64) public seatExpiresAt;
    uint8 public playerCount;

    euint64 private encryptedTotalWeight;
    uint256 public nextRoundId = 1;
    uint256 public activeRoundId;
    uint64 public nextDrawClosesAt;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    event PlayerJoined(address indexed player);
    event DrawSeatRenewed(address indexed player, uint64 expiresAt);
    event DrawSeatReleased(address indexed player);
    event DepositRecorded(address indexed player);
    event WithdrawalRecorded(address indexed player);
    event DrawWindowOpened(uint256 indexed roundId, uint64 closesAt);
    event RoundSnapshotted(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event BlindDrawCompleted(uint256 indexed roundId, eaddress encryptedWinner);
    event WinnerFinalized(uint256 indexed roundId, address indexed winner);
    event RoundCancelled(uint256 indexed roundId);

    constructor(address asset_) {
        require(asset_ != address(0), "Invalid asset");
        owner = msg.sender;
        asset = IERC7984Asset(asset_);

        // Mainnet/default cadence mirrors PoolTogether's daily prize rhythm. Sepolia is deliberately
        // accelerated so reviewers can experience a complete autonomous round during a demo session.
        drawPeriod = block.chainid == 11155111 ? SEPOLIA_DRAW_PERIOD : DEFAULT_DRAW_PERIOD;
        nextDrawClosesAt = uint64(block.timestamp + drawPeriod);

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);

        emit DrawWindowOpened(nextRoundId, nextDrawClosesAt);
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(asset.isOperator(msg.sender, address(this)), "Pool not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

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
        _acquireOrRenewSeat(msg.sender);
    }

    function leaveDrawSeat() external {
        require(seated[msg.sender], "Not seated");
        _removeSeat(msg.sender);
    }

    function pruneExpiredSeats() external {
        _pruneExpiredSeats();
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(joined[msg.sender], "Not joined");

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
    /// @dev Permissionless once the scheduled close time has passed. A new round cannot be
    ///      snapshotted until the active round is finalized or proven cancelled.
    function snapshotRound() external returns (uint256 roundId) {
        require(activeRoundId == 0, "Previous round unsettled");
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");

        _pruneExpiredSeats();
        require(playerCount >= 2, "Need 2 players");

        roundId = nextRoundId;
        unchecked {
            nextRoundId++;
        }
        activeRoundId = roundId;

        Draw storage draw = draws[roundId];
        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = playerCount;
        draw.state = DrawState.SNAPSHOTTED;

        euint64 snapshotTotalWeight = FHE.asEuint64(0);

        for (uint8 i = 0; i < playerCount; i++) {
            address account = players[i];
            euint64 weight = positions[account].balance;

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

    /// @notice Runs the FHE weighted selection against an already frozen round.
    /// @dev Permissionless. The random target and all weights remain encrypted.
    function blindDraw(uint256 roundId) external {
        require(activeRoundId == roundId, "Round not active");

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
        require(activeRoundId == roundId, "Round not active");

        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.DRAWN, "Round not awaiting finalization");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(draw.encryptedWinner);
        FHE.checkSignatures(handles, abiEncodedClearWinner, decryptionProof);

        address clearWinner = abi.decode(abiEncodedClearWinner, (address));
        if (clearWinner == address(0)) {
            draw.state = DrawState.CANCELLED;
            emit RoundCancelled(roundId);
            _openNextDrawWindow();
            return;
        }

        draw.winner = clearWinner;
        draw.state = DrawState.FINALIZED;
        emit WinnerFinalized(roundId, clearWinner);
        _openNextDrawWindow();
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

    function _openNextDrawWindow() private {
        activeRoundId = 0;
        nextDrawClosesAt = uint64(block.timestamp + drawPeriod);
        emit DrawWindowOpened(nextRoundId, nextDrawClosesAt);
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
