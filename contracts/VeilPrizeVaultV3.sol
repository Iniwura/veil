// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IVeilPrizePoolV3 {
    function strategyManager() external view returns (address);

    function getDrawState(uint256 roundId) external view returns (uint8);

    function getPrizeWinner(uint256 roundId, uint8 prizeIndex) external view returns (address);
}

/// @title VeilPrizeVaultV3
/// @notice Funds one confidential round surplus, then delivers each prize in a separate HCU-bounded transaction.
/// @dev The two-argument recordAndDeliverPrize surface intentionally matches the V2 manager call. In V3 that
///      call records the funded round only; permissionless deliverPrize calls settle the three prize slots one by one.
contract VeilPrizeVaultV3 is ReentrancyGuardTransient, ZamaEthereumConfig {
    uint8 public constant PRIZE_SLOTS = 3;
    uint8 public constant GRAND_PRIZE_INDEX = 0;
    uint8 public constant SAVER_PRIZE_ONE_INDEX = 1;
    uint8 public constant SAVER_PRIZE_TWO_INDEX = 2;

    error InvalidAddress();
    error InvalidPrizeIndex();
    error OnlyStrategyManager();
    error UnauthorizedCiphertext();
    error RoundAlreadyFunded(uint256 roundId);
    error RoundNotFunded(uint256 roundId);
    error RoundNotFinalized(uint256 roundId, uint8 state);
    error PrizeAlreadyProcessed(uint256 roundId, uint8 prizeIndex);
    error PrizeNotProcessed(uint256 roundId, uint8 prizeIndex);
    error PriorPrizesPending(uint256 roundId);
    error NotWinner();
    error InvalidWinner(uint256 roundId, uint8 prizeIndex);

    struct Prize {
        euint64 amount;
        address winner;
        bool processed;
    }

    struct PrizeRound {
        euint64 fundedAmount;
        euint64 remainingAmount;
        uint8 deliveredCount;
        bool funded;
    }

    IVeilPrizePoolV3 public immutable pool;
    IERC7984 public immutable asset;

    mapping(uint256 roundId => PrizeRound round) private _rounds;
    mapping(uint256 roundId => mapping(uint8 prizeIndex => Prize prize)) private _prizes;

    event PrizeRoundFunded(uint256 indexed roundId);
    event PrizeDelivered(uint256 indexed roundId, uint8 indexed prizeIndex, address indexed winner);
    event PrizeRoundDelivered(uint256 indexed roundId);

    constructor(address pool_, IERC7984 asset_) ZamaEthereumConfig() {
        if (pool_ == address(0) || address(asset_) == address(0)) revert InvalidAddress();
        pool = IVeilPrizePoolV3(pool_);
        asset = asset_;
    }

    /// @notice Records the manager-selected safe surplus for a finalized round.
    /// @dev No FHE division or prize transfer occurs here. Keeping funding separate from delivery prevents the
    ///      strategy-manager accounting path and prize-splitting path from accumulating into one HCU depth chain.
    function recordAndDeliverPrize(uint256 roundId, euint64 amount) external nonReentrant {
        address manager = pool.strategyManager();
        if (manager == address(0) || msg.sender != manager) revert OnlyStrategyManager();
        if (!FHE.isAllowed(amount, address(this))) revert UnauthorizedCiphertext();

        PrizeRound storage round = _rounds[roundId];
        if (round.funded) revert RoundAlreadyFunded(roundId);

        uint8 state = pool.getDrawState(roundId);
        if (state != 3) revert RoundNotFinalized(roundId, state);

        round.fundedAmount = amount;
        round.remainingAmount = amount;
        round.funded = true;
        FHE.allowThis(round.fundedAmount);
        FHE.allowThis(round.remainingAmount);

        emit PrizeRoundFunded(roundId);
    }

    /// @notice Permissionlessly delivers exactly one confidential prize slot.
    /// @dev Grand and first saver prizes are 50% and 30% of the originally funded encrypted amount. The final
    ///      saver prize receives the encrypted remainder after those two actual transfers, preserving all rounding.
    function deliverPrize(uint256 roundId, uint8 prizeIndex) external nonReentrant {
        if (prizeIndex > SAVER_PRIZE_TWO_INDEX) revert InvalidPrizeIndex();

        PrizeRound storage round = _rounds[roundId];
        if (!round.funded) revert RoundNotFunded(roundId);

        Prize storage prize = _prizes[roundId][prizeIndex];
        if (prize.processed) revert PrizeAlreadyProcessed(roundId, prizeIndex);

        address winner = pool.getPrizeWinner(roundId, prizeIndex);
        if (winner == address(0)) revert InvalidWinner(roundId, prizeIndex);

        euint64 requested = _requestedPrizeAmount(roundId, prizeIndex, round);

        FHE.allowThis(requested);
        FHE.allowTransient(requested, address(asset));
        euint64 delivered = asset.confidentialTransfer(winner, requested);

        prize.winner = winner;
        prize.processed = true;
        prize.amount = delivered;
        round.remainingAmount = FHESafeMath.saturatingSub(round.remainingAmount, delivered);
        unchecked {
            ++round.deliveredCount;
        }

        FHE.allowThis(delivered);
        FHE.allowThis(round.remainingAmount);
        FHE.allow(delivered, winner);

        emit PrizeDelivered(roundId, prizeIndex, winner);
        if (round.deliveredCount == PRIZE_SLOTS) emit PrizeRoundDelivered(roundId);
    }

    function encryptedPrizeOf(uint256 roundId, uint8 prizeIndex) external view returns (euint64) {
        if (prizeIndex > SAVER_PRIZE_TWO_INDEX) revert InvalidPrizeIndex();
        Prize storage prize = _prizes[roundId][prizeIndex];
        if (!prize.processed) revert PrizeNotProcessed(roundId, prizeIndex);
        if (msg.sender != prize.winner) revert NotWinner();
        return prize.amount;
    }

    function prizeStatus(
        uint256 roundId,
        uint8 prizeIndex
    ) external view returns (bool processed, address winner) {
        if (prizeIndex > SAVER_PRIZE_TWO_INDEX) revert InvalidPrizeIndex();
        Prize storage prize = _prizes[roundId][prizeIndex];
        return (prize.processed, prize.winner);
    }

    function roundStatus(uint256 roundId) external view returns (bool funded, uint8 deliveredCount, bool delivered) {
        PrizeRound storage round = _rounds[roundId];
        return (round.funded, round.deliveredCount, round.deliveredCount == PRIZE_SLOTS);
    }

    function _requestedPrizeAmount(
        uint256 roundId,
        uint8 prizeIndex,
        PrizeRound storage round
    ) private returns (euint64) {
        if (prizeIndex == GRAND_PRIZE_INDEX) return _percentage(round.fundedAmount, 50);
        if (prizeIndex == SAVER_PRIZE_ONE_INDEX) return _percentage(round.fundedAmount, 30);
        if (!_prizes[roundId][GRAND_PRIZE_INDEX].processed || !_prizes[roundId][SAVER_PRIZE_ONE_INDEX].processed) {
            revert PriorPrizesPending(roundId);
        }
        return round.remainingAmount;
    }

    function _percentage(euint64 amount, uint128 percent) private returns (euint64) {
        euint128 scaled = FHE.mul(FHE.asEuint128(amount), percent);
        return FHE.asEuint64(FHE.div(scaled, uint128(100)));
    }
}
