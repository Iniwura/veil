// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IVeilPrizePoolV3 {
    function strategyManager() external view returns (address);

    function getDrawState(uint256 roundId) external view returns (uint8);

    function getPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (address);
}

/// @title VeilPrizeVaultV3
/// @notice Splits one safe confidential round surplus across three automatically delivered prizes.
/// @dev The two-argument recordAndDeliverPrize surface intentionally matches the V2 manager call,
///      so the reviewed custody/solvency manager can be reused while the pool and prize vault evolve.
contract VeilPrizeVaultV3 is ReentrancyGuardTransient, ZamaEthereumConfig {
    uint8 public constant PRIZE_SLOTS = 3;
    uint8 public constant GRAND_PRIZE_INDEX = 0;
    uint8 public constant SAVER_PRIZE_ONE_INDEX = 1;
    uint8 public constant SAVER_PRIZE_TWO_INDEX = 2;

    error InvalidAddress();
    error InvalidPrizeIndex();
    error OnlyStrategyManager();
    error UnauthorizedCiphertext();
    error RoundAlreadyProcessed(uint256 roundId);
    error RoundNotFinalized(uint256 roundId, uint8 state);
    error PrizeNotProcessed(uint256 roundId, uint8 prizeIndex);
    error NotWinner();
    error InvalidWinner(uint256 roundId, uint8 prizeIndex);

    struct Prize {
        euint64 amount;
        address winner;
        bool processed;
    }

    IVeilPrizePoolV3 public immutable pool;
    IERC7984 public immutable asset;

    mapping(uint256 roundId => bool processed) public roundProcessed;
    mapping(uint256 roundId => mapping(uint8 prizeIndex => Prize prize)) private _prizes;

    event PrizeDelivered(uint256 indexed roundId, uint8 indexed prizeIndex, address indexed winner);
    event PrizeRoundDelivered(uint256 indexed roundId);

    constructor(address pool_, IERC7984 asset_) ZamaEthereumConfig() {
        if (pool_ == address(0) || address(asset_) == address(0)) revert InvalidAddress();
        pool = IVeilPrizePoolV3(pool_);
        asset = asset_;
    }

    /// @notice Splits the manager-selected safe surplus 50/30/remainder across three prize slots.
    /// @dev The final slot receives the encrypted remainder so rounding never strands round funds.
    function recordAndDeliverPrize(uint256 roundId, euint64 amount) external nonReentrant {
        address manager = pool.strategyManager();
        if (manager == address(0) || msg.sender != manager) revert OnlyStrategyManager();
        if (!FHE.isAllowed(amount, address(this))) revert UnauthorizedCiphertext();
        if (roundProcessed[roundId]) revert RoundAlreadyProcessed(roundId);

        uint8 state = pool.getDrawState(roundId);
        if (state != 3) revert RoundNotFinalized(roundId, state);

        roundProcessed[roundId] = true;

        euint128 amount128 = FHE.asEuint128(amount);
        euint64 grandPrize = FHE.asEuint64(FHE.div(FHE.mul(amount128, uint128(50)), uint128(100)));
        euint64 saverPrizeOne = FHE.asEuint64(FHE.div(FHE.mul(amount128, uint128(30)), uint128(100)));
        euint64 firstTwo = FHE.add(grandPrize, saverPrizeOne);
        euint64 saverPrizeTwo = FHE.sub(amount, firstTwo);

        FHE.allowThis(grandPrize);
        FHE.allowThis(saverPrizeOne);
        FHE.allowThis(saverPrizeTwo);

        _deliver(roundId, GRAND_PRIZE_INDEX, grandPrize);
        _deliver(roundId, SAVER_PRIZE_ONE_INDEX, saverPrizeOne);
        _deliver(roundId, SAVER_PRIZE_TWO_INDEX, saverPrizeTwo);

        emit PrizeRoundDelivered(roundId);
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

    function _deliver(uint256 roundId, uint8 prizeIndex, euint64 amount) private {
        address winner = pool.getPrizeWinner(roundId, prizeIndex);
        if (winner == address(0)) revert InvalidWinner(roundId, prizeIndex);

        Prize storage prize = _prizes[roundId][prizeIndex];
        prize.winner = winner;
        prize.processed = true;

        euint64 delivered = asset.confidentialTransfer(winner, amount);
        prize.amount = delivered;
        FHE.allowThis(delivered);
        FHE.allow(delivered, winner);

        emit PrizeDelivered(roundId, prizeIndex, winner);
    }
}
