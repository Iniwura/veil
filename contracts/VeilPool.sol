// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    euint64,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";

import {
    ZamaEthereumConfig
} from "@fhevm/solidity/config/ZamaConfig.sol";

contract VeilPool is ZamaEthereumConfig {
    uint8 public constant MAX_PLAYERS = 32;

    struct Position {
        euint64 balance;
        bool active;
    }

    mapping(address => Position) private positions;

    address[MAX_PLAYERS] private players;
    mapping(address => uint8) private playerIndex;
    mapping(address => bool) public joined;

    uint8 public playerCount;

    euint64 private encryptedTotalWeight;

    event PlayerJoined(address indexed player);
    event DepositRecorded(address indexed player);

    constructor() {
        encryptedTotalWeight = FHE.asEuint64(0);
        FHE.allowThis(encryptedTotalWeight);
    }

    function deposit(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        euint64 amount = FHE.fromExternal(
            encryptedAmount,
            inputProof
        );

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

        positions[msg.sender].balance = FHE.add(
            positions[msg.sender].balance,
            amount
        );

        encryptedTotalWeight = FHE.add(
            encryptedTotalWeight,
            amount
        );

        // Contract must retain permission to use ciphertexts later.
        FHE.allowThis(positions[msg.sender].balance);
        FHE.allowThis(encryptedTotalWeight);

        // Only this user receives permission to decrypt their balance.
        FHE.allow(
            positions[msg.sender].balance,
            msg.sender
        );

        emit DepositRecorded(msg.sender);
    }

    function encryptedBalanceOf()
        external
        view
        returns (euint64)
    {
        require(joined[msg.sender], "Not joined");

        return positions[msg.sender].balance;
    }

    function getEncryptedTotalWeight()
        external
        view
        returns (euint64)
    {
        return encryptedTotalWeight;
    }

    function getPlayer(
        uint8 index
    ) external view returns (address) {
        require(index < playerCount, "Invalid index");

        return players[index];
    }
}