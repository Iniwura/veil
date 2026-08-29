// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IVeilPrizePoolV3 {
    function strategyManager() external view returns (address);

    function getDrawState(uint256 roundId) external view returns (uint8);

    function getPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (address);
}

/// @title VeilPrizeVaultV3
/// @notice Delivers multiple confidential strategy-share prizes for each finalized draw.
contract VeilPrizeVaultV3 is ReentrancyGuardTransient, ZamaEthereumConfig {
    uint8 public constant PRIZE_SLOTS = 3;

    error InvalidAddress();
    error InvalidPrizeIndex();
    error OnlyStrategyManager();
    error UnauthorizedCiphertext();
    error PrizeAlreadyProcessed(uint256 roundId, uint8 prizeIndex);
    error PrizeNotProcessed(uint256 roundId, uint8 prizeIndex);
    error NotWinner();
    error InvalidWinner();

    struct Prize {
        euint64 amount;
        address winner;
        bool processed;
    }

    IVeilPrizePoolV3 public immutable pool;
    IERC7984 public immutable asset;

    mapping(uint256 roundId => mapping(uint8 prizeIndex => Prize prize)) private _prizes;

    event PrizeDelivered(uint256 indexed roundId, uint8 indexed prizeIndex, address indexed winner);

    constructor(address pool_, IERC7984 asset_) ZamaEthereumConfig() {
        if (pool_ == address(0) || address(asset_) == address(0)) revert InvalidAddress();
        pool = IVeilPrizePoolV3(pool_);
        asset = asset_;
    }

    function recordAndDeliverPrize(uint256 roundId, uint8 prizeIndex, euint64 amount) external nonReentrant {
        if (prizeIndex >= PRIZE_SLOTS) revert InvalidPrizeIndex();
        address manager = pool.strategyManager();
        if (manager == address(0) || msg.sender != manager) revert OnlyStrategyManager();
        if (!FHE.isAllowed(amount, address(this))) revert UnauthorizedCiphertext();

        Prize storage prize = _prizes[roundId][prizeIndex];
        if (prize.processed) revert PrizeAlreadyProcessed(roundId, prizeIndex);

        address winner = pool.getPrizeWinner(roundId, prizeIndex);
        if (winner == address(0)) revert InvalidWinner();

        prize.winner = winner;
        prize.processed = true;

        euint64 delivered = asset.confidentialTransfer(winner, amount);
        prize.amount = delivered;
        FHE.allowThis(delivered);
        FHE.allow(delivered, winner);

        emit PrizeDelivered(roundId, prizeIndex, winner);
    }

    function encryptedPrizeOf(uint256 roundId, uint8 prizeIndex) external view returns (euint64) {
        if (prizeIndex >= PRIZE_SLOTS) revert InvalidPrizeIndex();
        Prize storage prize = _prizes[roundId][prizeIndex];
        if (!prize.processed) revert PrizeNotProcessed(roundId, prizeIndex);
        if (msg.sender != prize.winner) revert NotWinner();
        return prize.amount;
    }

    function prizeStatus(
        uint256 roundId,
        uint8 prizeIndex
    ) external view returns (bool processed, address winner) {
        if (prizeIndex >= PRIZE_SLOTS) revert InvalidPrizeIndex();
        Prize storage prize = _prizes[roundId][prizeIndex];
        return (prize.processed, prize.winner);
    }
}
