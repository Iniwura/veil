// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, immutable-vars-naming, gas-custom-errors

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IVeilPrizePoolV2 {
    function strategyManager() external view returns (address);

    function getDrawState(uint256 roundId) external view returns (uint8);

    function getWinner(uint256 roundId) external view returns (address);
}

/// @title VeilPrizeVaultV2
/// @notice Delivers confidential strategy-share prizes directly to finalized draw winners.
/// @dev The configured manager is discovered from the pool at call time. The pool's one-time
///      manager configuration therefore remains the only mutable authority boundary.
contract VeilPrizeVaultV2 is ReentrancyGuardTransient, ZamaEthereumConfig {
    error InvalidAddress();
    error OnlyStrategyManager();
    error UnauthorizedCiphertext();
    error PrizeAlreadyProcessed(uint256 roundId);
    error PrizeNotProcessed(uint256 roundId);
    error NotWinner();

    struct Prize {
        euint64 amount;
        address winner;
        bool processed;
    }

    IVeilPrizePoolV2 public immutable pool;
    IERC7984 public immutable asset;

    mapping(uint256 roundId => Prize prize) private _prizes;

    event PrizeDelivered(uint256 indexed roundId, address indexed winner);

    constructor(address pool_, IERC7984 asset_) ZamaEthereumConfig() {
        if (pool_ == address(0) || address(asset_) == address(0)) revert InvalidAddress();
        pool = IVeilPrizePoolV2(pool_);
        asset = asset_;
    }

    /// @notice Delivers the manager-selected surplus directly to the finalized round winner.
    /// @dev `amount` is the actual ciphertext returned by the manager-to-vault transfer. The
    ///      ERC-7984 transfer return value below is stored as the actual delivered prize.
    function recordAndDeliverPrize(uint256 roundId, euint64 amount) external nonReentrant {
        address manager = pool.strategyManager();
        if (manager == address(0) || msg.sender != manager) revert OnlyStrategyManager();
        if (!FHE.isAllowed(amount, address(this))) revert UnauthorizedCiphertext();

        Prize storage prize = _prizes[roundId];
        if (prize.processed) revert PrizeAlreadyProcessed(roundId);

        address winner = pool.getWinner(roundId);
        require(winner != address(0), "Invalid winner");

        // Set the lifecycle fields before the token call. Any token failure reverts this state
        // and the manager's preceding transfer atomically.
        prize.winner = winner;
        prize.processed = true;

        euint64 delivered = asset.confidentialTransfer(winner, amount);
        prize.amount = delivered;
        FHE.allowThis(delivered);
        FHE.allow(delivered, winner);

        emit PrizeDelivered(roundId, winner);
    }

    /// @notice Returns the encrypted delivered amount only to the finalized winner.
    function encryptedPrizeOf(uint256 roundId) external view returns (euint64) {
        Prize storage prize = _prizes[roundId];
        if (!prize.processed) revert PrizeNotProcessed(roundId);
        if (msg.sender != prize.winner) revert NotWinner();
        return prize.amount;
    }

    function prizeStatus(uint256 roundId) external view returns (bool processed, address winner) {
        Prize storage prize = _prizes[roundId];
        return (prize.processed, prize.winner);
    }
}
