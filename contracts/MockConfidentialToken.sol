// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Test-only confidential token used to verify VEIL custody flows.
// solhint-disable use-natspec, gas-custom-errors, gas-indexed-events, immutable-vars-naming, named-parameters-mapping

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MockConfidentialToken is ZamaEthereumConfig {
    mapping(address => euint64) private balances;
    mapping(address => bool) private initialized;
    mapping(address => mapping(address => uint48)) private operatorUntil;

    event OperatorSet(address indexed holder, address indexed operator, uint48 until);

    function mint(address to, uint64 amount) external {
        _ensureInitialized(to);
        balances[to] = FHE.add(balances[to], FHE.asEuint64(amount));
        _allowBalance(to);
    }

    function setOperator(address operator, uint48 until) external {
        operatorUntil[msg.sender][operator] = until;
        emit OperatorSet(msg.sender, operator, until);
    }

    function isOperator(address holder, address spender) external view returns (bool) {
        return operatorUntil[holder][spender] >= block.timestamp;
    }

    function confidentialBalanceOf(address account) external view returns (euint64) {
        return balances[account];
    }

    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred) {
        require(msg.sender == from || operatorUntil[from][msg.sender] >= block.timestamp, "Not operator");
        transferred = _transfer(from, to, amount);
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred) {
        transferred = _transfer(msg.sender, to, amount);
        FHE.allowTransient(transferred, msg.sender);
    }

    function _transfer(address from, address to, euint64 amount) private returns (euint64 transferred) {
        _ensureInitialized(from);
        _ensureInitialized(to);

        transferred = FHE.select(FHE.le(amount, balances[from]), amount, balances[from]);
        balances[from] = FHE.sub(balances[from], transferred);
        balances[to] = FHE.add(balances[to], transferred);

        _allowBalance(from);
        _allowBalance(to);
    }

    function _ensureInitialized(address account) private {
        if (!initialized[account]) {
            initialized[account] = true;
            balances[account] = FHE.asEuint64(0);
            _allowBalance(account);
        }
    }

    function _allowBalance(address account) private {
        FHE.allowThis(balances[account]);
        FHE.allow(balances[account], account);
    }
}
