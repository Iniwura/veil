// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title IZamaVaultBatcher
/// @notice ABI slice for Zama's deployed confidential ERC-4626 batchers on Ethereum mainnet.
/// @dev UNVEIL does not call these contracts in the Sepolia competition deployment. The interface is
///      kept as the reviewed production integration boundary for cUSDC <-> csteakcUSDC batch flows.
interface IZamaVaultBatcher {
    enum BatchState {
        Pending,
        Dispatched,
        Finalized,
        Canceled
    }

    function fromToken() external view returns (address);

    function toToken() external view returns (address);

    function vault() external view returns (address);

    function minBatchAge() external view returns (uint256);

    function currentBatchId() external view returns (uint256);

    function batchState(uint256 batchId) external view returns (BatchState);

    function unwrapRequestId(uint256 batchId) external view returns (bytes32);

    function totalDeposits(uint256 batchId) external view returns (euint64);

    function deposits(uint256 batchId, address account) external view returns (euint64);

    function dispatchBatch() external;

    function dispatchBatchCallback(
        uint256 batchId,
        uint64 unwrapAmountCleartext,
        bytes calldata decryptionProof
    ) external;

    function claim(uint256 batchId, address account) external returns (euint64);

    function quit(uint256 batchId) external returns (euint64);
}

/// @title ZamaSteakhouseMainnet
/// @notice Canonical addresses used by the reviewed UNVEIL production-yield integration plan.
/// @dev Re-check Zama's protocol registry immediately before a mainnet deployment.
library ZamaSteakhouseMainnet {
    address internal constant CUSDC = 0xe978F22157048E5DB8E5d07971376e86671672B2;
    address internal constant CSTEAKCUSDC = 0x66Bf74E96900D1a19c7070D939D124f2F565C458;
    address internal constant STEAKHOUSE_USDC_PRIME = 0xbEEF00A59B577423653A1526c7009bdE103F542B;
    address internal constant DEPOSIT_BATCHER = 0x324EA89FD3784036673BfE6Ffee2334A088F40Cc;
    address internal constant REDEEM_BATCHER = 0x96Cd3Faa7483783Ac2Eb715f6333361500F1eec9;
}
