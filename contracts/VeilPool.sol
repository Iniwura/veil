// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions keep V0.4 readable while the economic model is still changing.
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
/// @notice Privacy-first prize-pool foundation for Zama Developer Program Season 4.
/// @dev V0.4 adds permissionless, KMS-proof-verified winner finalization on top of ERC-7984-backed
///      deposits, withdrawals, encrypted snapshots, and weighted BlindDraw. Yield and prize settlement
///      remain separate milestones.
contract VeilPool is ZamaEthereumConfig {
    uint8 public constant MAX_PLAYERS = 32;

    enum DrawState {
        NONE,
        SNAPSHOTTED,
        DRAWN,
        FINALIZED
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

    mapping(address => Position) private positions;

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public joined;

    uint8 public playerCount;
    euint64 private encryptedTotalWeight;

    uint256 public nextRoundId = 1;

    mapping(uint256 => Draw) private draws;
    mapping(uint256 => mapping(uint8 => address)) private drawPlayers;
    mapping(uint256 => mapping(uint8 => euint64)) private drawWeights;
    mapping(uint256 => mapping(address => uint8)) private drawPlayerIndex;
    mapping(uint256 => mapping(address => bool)) private drawParticipantIncluded;

    event PlayerJoined(address indexed player);
    event DepositRecorded(address indexed player);
    event WithdrawalRecorded(address indexed player);
    event RoundSnapshotted(uint256 indexed roundId, uint8 participantCount, uint64 snapshotBlock);
    event BlindDrawCompleted(uint256 indexed roundId, eaddress encryptedWinner);
    event WinnerFinalized(uint256 indexed roundId, address indexed winner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address asset_) {
        require(asset_ != address(0), "Invalid asset");
        owner = msg.sender;
        asset = IERC7984Asset(asset_);

        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
    }

    /// @notice Deposits confidential ERC-7984 assets and credits only the amount actually transferred.
    /// @dev The user must first authorize this pool as an operator on the confidential asset.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(asset.isOperator(msg.sender, address(this)), "Pool not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

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

        positions[msg.sender].balance = FHE.add(positions[msg.sender].balance, transferred);
        encryptedTotalWeight = FHE.add(encryptedTotalWeight, transferred);

        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);
        FHE.allow(positions[msg.sender].balance, msg.sender);

        emit DepositRecorded(msg.sender);
    }

    /// @notice Withdraws up to the caller's live confidential principal.
    /// @dev The live position changes, but historical draw snapshots remain immutable.
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(joined[msg.sender], "Not joined");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 available = FHE.select(
            FHE.le(requested, positions[msg.sender].balance),
            requested,
            positions[msg.sender].balance
        );

        FHE.allowTransient(available, address(asset));
        euint64 transferred = asset.confidentialTransfer(msg.sender, available);

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

    function snapshotRound() external onlyOwner returns (uint256 roundId) {
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

            FHE.allowThis(drawWeights[roundId][i]);
            FHE.allow(drawWeights[roundId][i], account);
        }

        emit RoundSnapshotted(roundId, draw.participantCount, draw.snapshotBlock);
    }

    function blindDraw(uint256 roundId) external onlyOwner {
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

    /// @notice Permissionlessly finalizes the public winner after relayer/KMS decryption.
    /// @dev The proof is cryptographically bound to this round's encrypted-winner handle and clear address.
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
        require(clearWinner != address(0), "No eligible winner");

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

    function encryptedSnapshotWeightOf(uint256 roundId) external view returns (euint64) {
        require(drawParticipantIncluded[roundId][msg.sender], "Not in round");
        return drawWeights[roundId][drawPlayerIndex[roundId][msg.sender]];
    }

    function getEncryptedWinner(uint256 roundId) external view returns (eaddress) {
        Draw storage draw = draws[roundId];
        require(draw.state == DrawState.DRAWN || draw.state == DrawState.FINALIZED, "Winner unavailable");
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
}
