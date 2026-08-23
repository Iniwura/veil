// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Competition-build lint suppressions. Revisit before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-increment-by-one, gas-strict-inequalities
// solhint-disable gas-indexed-events, immutable-vars-naming, named-parameters-mapping, gas-struct-packing

import {FHE, ebool, eaddress, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984Asset {
    function isOperator(address holder, address spender) external view returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

/// @title UnveilPool
/// @notice The FHE prize-savings core behind UNVEIL.
/// @dev Draw timing is enforced by the contract. Closing, BlindDraw execution and winner finalization are
///      permissionless. User financial values remain encrypted and each participant can decrypt only their own
///      position and round stats. Eligibility is renewed automatically on deposit and uses a long lease solely to
///      recover abandoned slots from the bounded competition roster.
contract UnveilPool is ZamaEthereumConfig {
    uint8 public constant MAX_PLAYERS = 32;
    uint64 public constant SEAT_LEASE = 365 days;

    enum DrawState {
        NONE,
        SNAPSHOTTED,
        DRAWN,
        FINALIZED,
        CANCELLED
    }

    struct Position {
        euint64 balance;
        euint64 totalDeposited;
        euint64 totalWithdrawn;
        euint64 lastDeposit;
        euint64 lastWithdrawal;
        bool active;
    }

    struct Draw {
        uint64 scheduledCloseAt;
        uint64 snapshotBlock;
        uint8 participantCount;
        euint64 encryptedTotalWeight;
        eaddress encryptedWinner;
        address winner;
        DrawState state;
    }

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
    event RoundSkipped(uint64 indexed scheduledCloseAt, uint8 eligibleParticipants);
    event RoundSnapshotted(
        uint256 indexed roundId,
        uint8 participantCount,
        uint64 snapshotBlock,
        uint64 scheduledCloseAt
    );
    event BlindDrawCompleted(uint256 indexed roundId, eaddress encryptedWinner);
    event WinnerFinalized(uint256 indexed roundId, address indexed winner);
    event RoundCancelled(uint256 indexed roundId);

    constructor(address asset_, uint64 drawPeriod_) {
        require(asset_ != address(0), "Invalid asset");
        require(drawPeriod_ > 0, "Invalid draw period");

        asset = IERC7984Asset(asset_);
        drawPeriod = drawPeriod_;
        nextDrawClosesAt = uint64(block.timestamp + drawPeriod_);

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        _rollExpiredRoundIfNeeded();
        require(asset.isOperator(msg.sender, address(this)), "Pool not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        if (!joined[msg.sender]) {
            _initializePosition(msg.sender);
            joined[msg.sender] = true;
            emit PlayerJoined(msg.sender);
        }

        _acquireOrRenewSeat(msg.sender);

        Position storage position = positions[msg.sender];
        position.balance = FHE.add(position.balance, transferred);
        position.totalDeposited = FHE.add(position.totalDeposited, transferred);
        position.lastDeposit = transferred;
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, transferred);

        _allowPosition(msg.sender);
        FHE.allowThis(encryptedTotalWeight);

        emit DepositRecorded(msg.sender);
    }

    function renewDrawSeat() external {
        _rollExpiredRoundIfNeeded();
        require(joined[msg.sender], "Not joined");
        _acquireOrRenewSeat(msg.sender);
    }

    function leaveDrawSeat() external {
        _rollExpiredRoundIfNeeded();
        require(seated[msg.sender], "Not seated");
        _removeSeat(msg.sender);
    }

    function pruneExpiredSeats() external {
        _rollExpiredRoundIfNeeded();
        _pruneExpiredSeatsAt(uint64(block.timestamp));
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        _rollExpiredRoundIfNeeded();
        require(joined[msg.sender], "Not joined");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 permitted = FHE.select(
            FHE.le(requested, positions[msg.sender].balance),
            requested,
            FHE.asEuint64(0)
        );

        FHE.allowTransient(permitted, address(asset));
        euint64 transferred = asset.confidentialTransfer(msg.sender, permitted);

        Position storage position = positions[msg.sender];
        position.balance = FHE.sub(position.balance, transferred);
        position.totalWithdrawn = FHE.add(position.totalWithdrawn, transferred);
        position.lastWithdrawal = transferred;
        encryptedTotalWeight = FHE.sub(encryptedTotalWeight, transferred);

        _allowPosition(msg.sender);
        FHE.allowThis(encryptedTotalWeight);

        emit WithdrawalRecorded(msg.sender);
    }

    function encryptedBalanceOf() external view returns (euint64) {
        require(joined[msg.sender], "Not joined");
        return positions[msg.sender].balance;
    }

    function encryptedPosition()
        external
        view
        returns (
            euint64 balance,
            euint64 totalDeposited,
            euint64 totalWithdrawn,
            euint64 lastDeposit,
            euint64 lastWithdrawal
        )
    {
        require(joined[msg.sender], "Not joined");
        Position storage position = positions[msg.sender];
        return (
            position.balance,
            position.totalDeposited,
            position.totalWithdrawn,
            position.lastDeposit,
            position.lastWithdrawal
        );
    }

    function getEncryptedTotalWeight() external view returns (euint64) {
        return encryptedTotalWeight;
    }

    function getPlayer(uint8 index) external view returns (address) {
        require(index < playerCount, "Invalid index");
        return players[index];
    }

    function closeDraw() public returns (uint256 roundId) {
        require(block.timestamp >= nextDrawClosesAt, "Draw still open");
        return _rollExpiredRound();
    }

    function snapshotRound() external returns (uint256 roundId) {
        return closeDraw();
    }

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
            emit RoundCancelled(roundId);
            return;
        }

        draw.winner = clearWinner;
        draw.state = DrawState.FINALIZED;
        emit WinnerFinalized(roundId, clearWinner);
    }

    function getDrawInfo(
        uint256 roundId
    ) external view returns (uint64 snapshotBlock, uint8 participantCount, DrawState state) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        return (draw.snapshotBlock, draw.participantCount, draw.state);
    }

    function getDrawTiming(uint256 roundId) external view returns (uint64 scheduledCloseAt, uint64 snapshotBlock) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        return (draw.scheduledCloseAt, draw.snapshotBlock);
    }

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return drawWeights[roundId][drawPlayerIndex[roundId][msg.sender]];
    }

    function encryptedSnapshotTotalWeight(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return draws[roundId].encryptedTotalWeight;
    }

    function isSnapshotParticipant(uint256 roundId, address account) external view returns (bool) {
        return drawParticipantIncluded[roundId][account];
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

    function _initializePosition(address account) private {
        Position storage position = positions[account];
        position.balance = FHE.asEuint64(0);
        position.totalDeposited = FHE.asEuint64(0);
        position.totalWithdrawn = FHE.asEuint64(0);
        position.lastDeposit = FHE.asEuint64(0);
        position.lastWithdrawal = FHE.asEuint64(0);
        position.active = true;
        _allowPosition(account);
    }

    function _allowPosition(address account) private {
        Position storage position = positions[account];

        FHE.allowThis(position.balance);
        FHE.allowThis(position.totalDeposited);
        FHE.allowThis(position.totalWithdrawn);
        FHE.allowThis(position.lastDeposit);
        FHE.allowThis(position.lastWithdrawal);

        FHE.allow(position.balance, account);
        FHE.allow(position.totalDeposited, account);
        FHE.allow(position.totalWithdrawn, account);
        FHE.allow(position.lastDeposit, account);
        FHE.allow(position.lastWithdrawal, account);
    }

    function _rollExpiredRoundIfNeeded() private {
        if (block.timestamp >= nextDrawClosesAt) {
            _rollExpiredRound();
        }
    }

    function _rollExpiredRound() private returns (uint256 roundId) {
        uint64 scheduledCloseAt = nextDrawClosesAt;
        require(block.timestamp >= scheduledCloseAt, "Draw still open");

        _advanceDrawClock(scheduledCloseAt);

        uint8 eligibleParticipants = _eligibleSeatCountAt(scheduledCloseAt);
        if (eligibleParticipants < 2) {
            emit RoundSkipped(scheduledCloseAt, eligibleParticipants);
            _pruneExpiredSeatsAt(uint64(block.timestamp));
            return 0;
        }

        roundId = nextRoundId;
        unchecked {
            nextRoundId++;
        }

        Draw storage draw = draws[roundId];
        draw.scheduledCloseAt = scheduledCloseAt;
        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = eligibleParticipants;
        draw.state = DrawState.SNAPSHOTTED;

        draw.encryptedTotalWeight = _snapshotEligiblePlayers(roundId, scheduledCloseAt);
        FHE.allowThis(draw.encryptedTotalWeight);
        _allowSnapshotTotalToParticipants(roundId, draw);

        emit RoundSnapshotted(roundId, draw.participantCount, draw.snapshotBlock, scheduledCloseAt);
        _pruneExpiredSeatsAt(uint64(block.timestamp));
    }

    function _advanceDrawClock(uint64 scheduledCloseAt) private {
        uint256 elapsedPeriods = ((block.timestamp - uint256(scheduledCloseAt)) / uint256(drawPeriod)) + 1;
        nextDrawClosesAt = uint64(uint256(scheduledCloseAt) + elapsedPeriods * uint256(drawPeriod));
    }

    function _snapshotEligiblePlayers(uint256 roundId, uint64 cutoff) private returns (euint64 snapshotTotalWeight) {
        snapshotTotalWeight = FHE.asEuint64(0);
        uint8 snapshotIndex = 0;

        for (uint8 i = 0; i < playerCount; i++) {
            address account = players[i];
            if (seatExpiresAt[account] <= cutoff) continue;

            euint64 weight = positions[account].balance;
            drawPlayers[roundId][snapshotIndex] = account;
            drawWeights[roundId][snapshotIndex] = weight;
            drawPlayerIndex[roundId][account] = snapshotIndex;
            drawParticipantIncluded[roundId][account] = true;
            snapshotTotalWeight = FHE.add(snapshotTotalWeight, weight);

            FHE.allowThis(drawWeights[roundId][snapshotIndex]);
            FHE.allow(drawWeights[roundId][snapshotIndex], account);

            unchecked {
                snapshotIndex++;
            }
        }
    }

    function _allowSnapshotTotalToParticipants(uint256 roundId, Draw storage draw) private {
        for (uint8 i = 0; i < draw.participantCount; i++) {
            FHE.allow(draw.encryptedTotalWeight, drawPlayers[roundId][i]);
        }
    }

    function _eligibleSeatCountAt(uint64 cutoff) private view returns (uint8 count) {
        for (uint8 i = 0; i < playerCount; i++) {
            if (seatExpiresAt[players[i]] > cutoff) {
                unchecked {
                    count++;
                }
            }
        }
    }

    function _acquireOrRenewSeat(address account) private {
        if (!seated[account]) {
            _pruneExpiredSeatsAt(uint64(block.timestamp));
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

    function _pruneExpiredSeatsAt(uint64 cutoff) private {
        uint8 i = 0;
        while (i < playerCount) {
            address account = players[i];
            if (seatExpiresAt[account] <= cutoff) {
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
