// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Prototype-specific lint suppressions. Revisit before production hardening.
// solhint-disable use-natspec, gas-custom-errors, gas-indexed-events, immutable-vars-naming
// solhint-disable named-parameters-mapping, gas-struct-packing

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC7984PrizeAsset {
    function isOperator(address holder, address spender) external view returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

interface IVeilWinnerSource {
    function getWinner(uint256 roundId) external view returns (address);
}

/// @title VeilPrizeVault
/// @notice Holds confidential prize assets separately from VEIL principal and exposes each prize only to its winner.
/// @dev V0.1 uses owner-backed funding as test plumbing. A dedicated yield adapter replaces the funder in the next milestone.
contract VeilPrizeVault is ZamaEthereumConfig {
    struct Prize {
        euint64 amount;
        address winner;
        bool funded;
        bool winnerAuthorized;
        bool claimed;
    }

    address public immutable owner;
    IVeilWinnerSource public immutable pool;
    IERC7984PrizeAsset public immutable asset;

    mapping(uint256 => Prize) private prizes;

    event PrizeFunded(uint256 indexed roundId);
    event WinnerAuthorized(uint256 indexed roundId, address indexed winner);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address pool_, address asset_) {
        require(pool_ != address(0), "Invalid pool");
        require(asset_ != address(0), "Invalid asset");

        owner = msg.sender;
        pool = IVeilWinnerSource(pool_);
        asset = IERC7984PrizeAsset(asset_);
    }

    /// @notice Funds a round with confidential assets without affecting VEIL principal or draw weight.
    /// @dev The funder must authorize this vault as an operator on the ERC-7984 asset first.
    function fundPrize(uint256 roundId, externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyOwner {
        require(!prizes[roundId].claimed, "Prize already claimed");
        require(asset.isOperator(msg.sender, address(this)), "Vault not operator");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        Prize storage prize = prizes[roundId];
        if (!prize.funded) {
            prize.amount = FHE.asEuint64(0);
            prize.funded = true;
        }

        prize.amount = FHE.add(prize.amount, transferred);
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
