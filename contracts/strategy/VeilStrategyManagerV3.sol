// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// solhint-disable use-natspec, gas-custom-errors, immutable-vars-naming

import {FHE, ebool, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";

import {VeilPrizeVaultV2} from "../VeilPrizeVaultV2.sol";
import {VeilDepositBatcher} from "./VeilDepositBatcher.sol";
import {VeilStrategyManagerV2} from "./VeilStrategyManagerV2.sol";
import {VeilWithdrawalBatcher} from "./VeilWithdrawalBatcher.sol";

/// @title VeilStrategyManagerV3
/// @notice V2 custody/solvency manager plus a privacy-preserving public principal-coverage attestation.
/// @dev The attestation reveals only one KMS-proven boolean. Exact liability, liquid buffer,
///      strategy-share balance, required shares, and valuation-derived coverage margin stay encrypted.
///      Pending batcher assets are intentionally excluded, making the predicate conservative while
///      funds are in transit.
contract VeilStrategyManagerV3 is VeilStrategyManagerV2 {
    error CoverageAttestationAlreadyPending(uint256 requestId);
    error CoverageAttestationNotPending();
    error CoverageAttestationRequestMismatch(uint256 expectedRequestId, uint256 suppliedRequestId);

    ebool private _pendingPrincipalCoverage;

    uint256 public nextCoverageAttestationRequestId = 1;
    uint256 public pendingCoverageAttestationRequestId;
    uint256 public latestCoverageAttestationRequestId;
    uint64 public principalCoverageVerifiedAt;
    bool public coverageAttestationPending;
    bool public principalCoverageVerified;
    bool public principalCoverage;

    event PrincipalCoverageAttestationRequested(uint256 indexed requestId);
    event PrincipalCoverageAttestationVerified(uint256 indexed requestId, bool indexed covered, uint64 indexed verifiedAt);

    constructor(
        address pool_,
        IERC7984ERC20Wrapper principalAsset_,
        IERC7984ERC20Wrapper strategyShareAsset_,
        VeilDepositBatcher depositBatcher_,
        VeilWithdrawalBatcher withdrawalBatcher_,
        IERC4626 vault_,
        VeilPrizeVaultV2 prizeVault_,
        uint16 bufferReserveBps_,
        uint16 valuationHaircutBps_
    )
        VeilStrategyManagerV2(
            pool_,
            principalAsset_,
            strategyShareAsset_,
            depositBatcher_,
            withdrawalBatcher_,
            vault_,
            prizeVault_,
            bufferReserveBps_,
            valuationHaircutBps_
        )
    {}

    /// @notice Computes a conservative encrypted principal-coverage predicate and exposes only
    ///         that predicate for public KMS decryption.
    /// @dev Coverage means the live confidential liquid buffer plus settled strategy shares,
    ///      valued with the configured haircut, can cover the encrypted principal liability.
    function requestPrincipalCoverageAttestation() external returns (uint256 requestId) {
        if (coverageAttestationPending) {
            revert CoverageAttestationAlreadyPending(pendingCoverageAttestationRequestId);
        }

        (uint256 conservativeValue, uint256 shareScale) = _conservativeValuation();
        if (conservativeValue == 0 || shareScale == 0) revert InvalidValuation();

        euint64 buffer = _principalBuffer();
        euint64 uncovered = _uncoveredPrincipal(buffer);
        euint128 requiredShares = _requiredSharesForFunding(uncovered, shareScale, conservativeValue);
        euint128 settledShares = FHE.asEuint128(_strategyShareBalance());
        ebool covered = FHE.ge(settledShares, requiredShares);

        FHE.allowThis(covered);
        FHE.makePubliclyDecryptable(covered);

        requestId = nextCoverageAttestationRequestId;
        unchecked {
            nextCoverageAttestationRequestId = requestId + 1;
        }

        _pendingPrincipalCoverage = covered;
        pendingCoverageAttestationRequestId = requestId;
        coverageAttestationPending = true;

        emit PrincipalCoverageAttestationRequested(requestId);
    }

    /// @notice Finalizes the latest coverage predicate with a KMS proof.
    /// @dev The request-id and pending-state guards provide explicit replay protection in addition
    ///      to binding the KMS proof to the exact encrypted boolean handle.
    function finalizePrincipalCoverageAttestation(
        uint256 requestId,
        bool covered,
        bytes calldata decryptionProof
    ) external {
        if (!coverageAttestationPending) revert CoverageAttestationNotPending();
        uint256 expectedRequestId = pendingCoverageAttestationRequestId;
        if (requestId != expectedRequestId) {
            revert CoverageAttestationRequestMismatch(expectedRequestId, requestId);
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(_pendingPrincipalCoverage);
        FHE.checkSignatures(handles, abi.encode(covered), decryptionProof);

        uint64 verifiedAt = uint64(block.timestamp);
        principalCoverage = covered;
        principalCoverageVerified = true;
        principalCoverageVerifiedAt = verifiedAt;
        latestCoverageAttestationRequestId = requestId;
        pendingCoverageAttestationRequestId = 0;
        coverageAttestationPending = false;

        emit PrincipalCoverageAttestationVerified(requestId, covered, verifiedAt);
    }

    function encryptedPendingPrincipalCoverage() external view returns (ebool) {
        if (!coverageAttestationPending) revert CoverageAttestationNotPending();
        return _pendingPrincipalCoverage;
    }
}
