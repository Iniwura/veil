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
/// @notice Holds confidential prize assets separately from VEIL principal and exposes each prize only to its winner.
/// @dev Prize accounting can only be credited by the configured yield source after it transfers actual assets here.
contract VeilPrizeVault is ZamaEthereumConfig {
    struct Prize {
        euint64 amount;
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
    event PrizeClaimed(uint256 indexed roundId, address indexed winner);

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

    /// @notice Records a confidential prize amount already transferred here by the configured yield source.
    /// @dev Funding is accepted only for a round whose winner is already finalized. Any failure reverts the
    ///      entire yield-source allocation transaction, including the preceding confidential asset transfer.
    function recordPrize(uint256 roundId, euint64 amount) external onlyYieldSource {
        address finalizedWinner = pool.getWinner(roundId);
        require(finalizedWinner != address(0), "Invalid winner");

        Prize storage prize = prizes[roundId];
        require(!prize.claimed, "Prize already claimed");
        require(!prize.winnerAuthorized, "Winner already authorized");

        if (!prize.funded) {
            prize.amount = FHE.asEuint64(0);
            prize.funded = true;
        }

        prize.amount = FHE.add(prize.amount, amount);
        FHE.allowThis(prize.amount);

        emit PrizeFunded(roundId);
    }

    /// @notice Permissionlessly grants the finalized winner access to decrypt only this round's prize.
    function authorizeWinner(uint256 roundId) external {
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

    function encryptedPrizeOf(uint256 roundId) external view returns (euint64) {
        Prize storage prize = prizes[roundId];
        require(prize.winnerAuthorized, "Winner not authorized");
        require(msg.sender == prize.winner, "Not winner");
        return prize.amount;
    }

    /// @notice Transfers the confidential prize to the finalized winner while leaving principal accounting untouched.
    function claimPrize(uint256 roundId) external {
        Prize storage prize = prizes[roundId];
        require(prize.winnerAuthorized, "Winner not authorized");
        require(msg.sender == prize.winner, "Not winner");
        require(!prize.claimed, "Prize already claimed");

        prize.claimed = true;

        FHE.allowTransient(prize.amount, address(asset));
        euint64 transferred = asset.confidentialTransfer(prize.winner, prize.amount);
        prize.amount = FHE.sub(prize.amount, transferred);

        FHE.allowThis(prize.amount);
        FHE.allow(prize.amount, prize.winner);

        emit PrizeClaimed(roundId, prize.winner);
    }

    function prizeStatus(
        uint256 roundId
    ) external view returns (bool funded, bool winnerAuthorized, bool claimed, address winner) {
        Prize storage prize = prizes[roundId];
        return (prize.funded, prize.winnerAuthorized, prize.claimed, prize.winner);
    }
}
