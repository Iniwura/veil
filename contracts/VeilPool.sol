// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title VeilPool
/// @notice Privacy-first prize-pool foundation for Zama Developer Program Season 4.
/// @dev V0.1 tracks confidential weights and immutable encrypted draw snapshots.
///      Asset backing, withdrawals, yield, BlindDraw, and prize settlement are deliberately
///      outside this milestone and must be added before production use.
contract VeilPool is ZamaEthereumConfig {
    uint8 public constant MAX_PLAYERS = 32;

    enum DrawState {
        NONE,
        SNAPSHOTTED
    }

    struct Position {
        euint64 balance;
        bool active;
    }

    struct Draw {
        uint64 snapshotBlock;
        uint8 participantCount;
        euint64 encryptedTotalWeight;
        DrawState state;
    }

    mapping(address => Position) private positions;

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public joined;

    uint8 public playerCount;
    euint64 private encryptedTotalWeight;

    /// @notice ID that will be assigned to the next snapshot.
    uint256 public nextRoundId = 1;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    event PlayerJoined(address indexed player);
    event DepositRecorded(address indexed player);
    event RoundSnapshotted(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);

    constructor() {
        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
    }

    /// @notice Adds a confidential weight to the caller's live position.
    /// @dev V0.1 weights are not yet asset-backed. This method must not be treated as a
    ///      production deposit function until confidential token custody is integrated.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        if (!joined[msg.sender]) {
            require(playerCount < MAX_PLAYERS, "Pool full");

            players[playerCount] = msg.sender;
            playerIndex[msg.sender] = playerCount;

            positions[msg.sender].balance = FHE.asEuint64(0);
            positions[msg.sender].active = true;

            joined[msg.sender] = true;

            unchecked {
                playerCount++;
            }

            emit PlayerJoined(msg.sender);
        }

        positions[msg.sender].balance = FHE.add(positions[msg.sender].balance, amount);
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, amount);

        // The contract needs continuing access for later snapshots and BlindDraw.
        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);

        // Only the position owner receives user-decryption permission.
        FHE.allow(positions[msg.sender].balance, msg.sender);

        emit DepositRecorded(msg.sender);
    }

    /// @notice Returns the caller's current encrypted live balance.
    function encryptedBalanceOf() external view returns (euint64) {
        require(joined[msg.sender], "Not joined");
        return positions[msg.sender].balance;
    }

    /// @notice Returns the live encrypted aggregate handle.
    /// @dev The handle is not made publicly decryptable in this milestone.
    function getEncryptedTotalWeight() external view returns (euint64) {
        return encryptedTotalWeight;
    }

    function getPlayer(uint8 index) external view returns (address) {
        require(index < playerCount, "Invalid index");
        return players[index];
    }

    /// @notice Creates an immutable encrypted snapshot for a future BlindDraw.
    /// @dev Later deposits create new ciphertext handles and therefore do not mutate weights
    ///      already referenced by this round.
    function snapshotRound() external returns (uint256 roundId) {
        require(playerCount >= 2, "Need 2 players");

        roundId = nextRoundId;
        unchecked {
            nextRoundId++;
        }

        Draw storage draw = draws[roundId];
        draw.snapshotBlock = uint64(block.number);
        draw.participantCount = playerCount;
        draw.encryptedTotalWeight = encryptedTotalWeight;
        draw.state = DrawState.SNAPSHOTTED;

        FHE.allowThis(draw.encryptedTotalWeight);

        for (uint8 i = 0; i < playerCount; i++) {
            address account = players[i];
            euint64 weight = positions[account].balance;

            drawPlayers[roundId][i] = account;
            drawWeights[roundId][i] = weight;
            drawPlayerIndex[roundId][account] = i;
            drawParticipantIncluded[roundId][account] = true;

            // Preserve contract access for future encrypted draw computation.
            FHE.allowThis(drawWeights[roundId][i]);
            // The participant may inspect/decrypt only their own snapshotted weight.
            FHE.allow(drawWeights[roundId][i], account);
        }

        emit RoundSnapshotted(roundId, draw.participantCount, draw.snapshotBlock);
    }

    /// @notice Public, non-sensitive metadata for an existing draw.
    function getDrawInfo(
        uint256 roundId
    ) external view returns (uint64 snapshotBlock, uint8 participantCount, DrawState state) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        return (draw.snapshotBlock, draw.participantCount, draw.state);
    }

    /// @notice Returns the caller's encrypted weight exactly as it existed at the snapshot.
    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return drawWeights[roundId][drawPlayerIndex[roundId][msg.sender]];
    }

    /// @notice Returns a participant address from a historical round in snapshot order.
    function getSnapshotPlayer(uint256 roundId, uint8 index) external view returns (address) {
        Draw storage draw = draws[roundId];
        require(draw.state != DrawState.NONE, "Unknown round");
        require(index < draw.participantCount, "Invalid index");
        return drawPlayers[roundId][index];
    }
}
