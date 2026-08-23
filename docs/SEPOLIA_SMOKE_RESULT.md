# VEIL Sepolia end-to-end smoke result

## Final hardened deployment

- Date: 2026-08-23
- Network: Sepolia
- Result: PASS
- Protocol branch: `fix/erc7984-semantics`
- Local protocol suite before deployment: `37 passing`, `1 pending`, `0 failing`

### Deployed demo stack

- Asset: `0x79836eCae72C3EB5423fd5D1d200CbaEA0cCEE6e`
- VeilPool: `0xd5395972b0Cd747fAD531389E449958a343adA1b`
- VeilYieldSource: `0xdDB2b7fe447c55576F882138d59DE00a7d8EbE3D`
- VeilPrizeVault: `0xb580c50192f5d7C613Db4e9427a2fA0C9701Af84`

Deployment transactions:

- MockConfidentialToken: `0x7255148b39085b5f660c38e38f667e5ab93bb247af87007e0b1615d77eb5450f`
- VeilPool: `0x5377674e74d576578d1409e096e9c593085ef7a20234d335ec244b74d5394cfe`
- VeilYieldSource: `0x83ff6c42f614dfdebf3cd15920d064095c40440d4e45683f724652a7068f2dee`
- VeilPrizeVault: `0x46d2f35d1cb7f9566f17b376800b9a116b83f21b2574ec472739e8f408ee5b8d`
- `configurePrizeVault`: `0xf9f05cd9018aeb133668d9970604268a20a0bee168de1b8dbfa130ba4380186d`

The asset is the explicit test-only `MockConfidentialToken` used for controlled protocol integration testing. It is not presented as production infrastructure.

### Hardening included in this deployment

This deployment includes the ERC-7984-style all-or-zero transfer semantics and the pooled-custody withdrawal fix that prevents one depositor from spending another depositor's shared custody when requesting more than their own private principal.

It also includes reusable draw-seat leases, all-zero round cancellation, prize funding restricted to finalized rounds, and all-or-zero confidential yield allocation rather than clamping an oversized request to the remaining realized yield.

### Verified live flow

The fresh final Sepolia deployment completed the following path successfully:

1. Minted controlled demo confidential assets.
2. Authorized confidential token operators.
3. Made encrypted deposits for two participants.
4. Verified participant-scoped encrypted principal balances.
5. Snapshotted the encrypted active draw roster.
6. Ran weighted BlindDraw for round 1.
7. Publicly decrypted the encrypted winner output and finalized it with the KMS proof.
8. Accrued asset-backed confidential demo yield.
9. Allocated encrypted yield to the already-finalized round prize.
10. Authorized only the finalized winner to decrypt the prize.
11. Claimed the confidential prize without mutating principal accounting.

### Observed result

- Round: `1`
- Winner: `0x7d105bd4Ba5a28E9813F75D172BC59D689cA8a84`
- Prize: `15` encrypted token units
- Winner-only prize decryption: PASS
- Confidential prize claim: PASS

Final script output:

```text
VEIL Sepolia smoke test PASSED
  round:  1
  winner: 0x7d105bd4Ba5a28E9813F75D172BC59D689cA8a84
  prize:  15 encrypted token units (decrypted only by winner)
```

The first smoke invocation hit a transient Zama relayer `KEY_URL` fetch failure before the VEIL script began executing. A retry succeeded end to end without redeploying or modifying the contracts.

This result validates the final hardened demo path from encrypted deposits through confidential settlement. It does not claim that the mock asset, owner-controlled demo yield source, or current bounded draw-seat policy are production-ready economic infrastructure.

## Superseded hardened deployment

The prior hardened Sepolia stack was used during browser integration and exploit regression work, but should not be treated as the final submission deployment:

- Asset: `0xBAa442fFC1C8EEF0FE53E181aF0c3caD3c87e575`
- VeilPool: `0xbFFb9dA6e363D72B2f86B511ecefad3DF49d19e9`
- VeilYieldSource: `0xA083930Fcccc43d73a5DB5f7340188f734Bf5505`
- VeilPrizeVault: `0xE9c1779d58a1b3e31C3C5417e927B09c18Cd1B76`

That deployment was intentionally retired after browser testing exposed a pooled-custody oversized-withdrawal accounting flaw. The flaw is fixed and covered by regression tests in the final deployment above.

## Historical V0.4 deployment evidence

The previous V0.4 Sepolia deployment remains useful as historical evidence for the earlier protocol version:

- Asset: `0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125`
- VeilPool: `0x523b515A6e3fCB19737dF45243616c36564fD62f`
- VeilYieldSource: `0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3`
- VeilPrizeVault: `0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8`

That deployment previously completed an end-to-end confidential prize flow. It should not be confused with the final ERC-7984 silent-zero, pooled-custody-safe, reusable draw-seat implementation.
