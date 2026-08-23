// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions. Revisit before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-indexed-events, immutable-vars-naming
// solhint-disable named-parameters-mapping, gas-struct-packing

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984PrizeAsset {
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

interface IVeilWinnerSource {
    function getWinner(uint256 roundId) external view returns (address);
}

/// @title VeilPrizeVault
/// @notice Holds confidential UNVEIL prizes separately from user principal and delivers them to finalized winners.
contract VeilPrizeVault is ZamaEthereumConfig {
    struct Prize {
        euint64 amount;
        euint64 awardedAmount;
        address winner;
        bool funded;
        bool winnerAuthorized;
        bool claimed;
    }

    IVeilWinnerSource public immutable pool;
    IERC7984PrizeAsset public immutable asset;
    address public immutable yieldSource;

    mapping(uint256 => Prize) private prizes;

    event PrizeFunded(uint256 indexed roundId);
    event WinnerAuthorized(uint256 indexed roundId, address indexed winner);
    event PrizeDelivered(uint256 indexed roundId, address indexed winner);

    modifier onlyYieldSource() {
        require(msg.sender == yieldSource, "Only yield source");
        _;
    }

    constructor(address pool_, address asset_, address yieldSource_) {
        require(pool_ != address(0), "Invalid pool");
        require(asset_ != address(0), "Invalid asset");
        require(yieldSource_ != address(0), "Invalid yield source");

        pool = IVeilWinnerSource(pool_);
        asset = IERC7984PrizeAsset(asset_);
        yieldSource = yieldSource_;
    }

    /// @notice Records confidential prize assets already transferred here by the configured yield source.
    function recordPrize(uint256 roundId, euint64 amount) external onlyYieldSource {
        address finalizedWinner = pool.getWinner(roundId);
        require(finalizedWinner != address(0), "Invalid winner");

        Prize storage prize = prizes[roundId];
        require(!prize.claimed, "Prize already delivered");

        if (!prize.funded) {
            prize.amount = FHE.asEuint64(0);
            prize.awardedAmount = FHE.asEuint64(0);
            prize.funded = true;
            FHE.allowThis(prize.awardedAmount);
        }

        prize.amount = FHE.add(prize.amount, amount);
        FHE.allowThis(prize.amount);

        // If the winner was authorized before additional funding arrived, preserve their ACL on the updated handle.
        if (prize.winnerAuthorized) {
            FHE.allow(prize.amount, prize.winner);
        }

        emit PrizeFunded(roundId);
    }

    /// @notice Permissionlessly grants the finalized winner access to decrypt only this round's encrypted prize.
    function authorizeWinner(uint256 roundId) external {
        _authorizeWinner(roundId);
    }

    /// @notice Returns the encrypted prize to the winner before or after delivery.
    function encryptedPrizeOf(uint256 roundId) external view returns (euint64) {
        Prize storage prize = prizes[roundId];
        require(prize.winnerAuthorized, "Winner not authorized");
        require(msg.sender == prize.winner, "Not winner");
        return prize.claimed ? prize.awardedAmount : prize.amount;
    }

    /// @notice Permissionlessly sends the confidential prize to the fixed finalized winner.
    /// @dev The caller never receives the funds. The actual transferred amount remains encrypted
    ///      and winner-readable afterward.
    function deliverPrize(uint256 roundId) public {
        Prize storage prize = prizes[roundId];
        require(prize.funded, "Prize not funded");
        require(!prize.claimed, "Prize already delivered");

        if (!prize.winnerAuthorized) {
            _authorizeWinner(roundId);
        }

        FHE.allowTransient(prize.amount, address(asset));
        euint64 transferred = asset.confidentialTransfer(prize.winner, prize.amount);

        // Preserve what actually moved under ERC-7984 all-or-zero semantics, not the pre-transfer request handle.
        prize.awardedAmount = transferred;
        FHE.allowThis(prize.awardedAmount);
        FHE.allow(prize.awardedAmount, prize.winner);

        prize.amount = FHE.sub(prize.amount, transferred);
        prize.claimed = true;

        FHE.allowThis(prize.amount);
        FHE.allow(prize.amount, prize.winner);

        emit PrizeDelivered(roundId, prize.winner);
    }

    /// @notice Backwards-compatible alias. A winner may call this themselves, but no manual claim is required.
    function claimPrize(uint256 roundId) external {
        deliverPrize(roundId);
    }

    function prizeStatus(
        uint256 roundId
    ) external view returns (bool funded, bool winnerAuthorized, bool claimed, address winner) {
        Prize storage prize = prizes[roundId];
        return (prize.funded, prize.winnerAuthorized, prize.claimed, prize.winner);
    }

    function _authorizeWinner(uint256 roundId) private {
        Prize storage prize = prizes[roundId];
        require(prize.funded, "Prize not funded");
        require(!prize.winnerAuthorized, "Winner already authorized");

        address winner = pool.getWinner(roundId);
        require(winner != address(0), "Invalid winner");

        prize.winner = winner;
        prize.winnerAuthorized = true;
        FHE.allow(prize.amount, winner);

        emit WinnerAuthorized(roundId, winner);
    }
}
