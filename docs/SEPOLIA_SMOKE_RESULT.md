# VEIL Sepolia end-to-end smoke result

## Current hardened deployment

- Date: 2026-08-22
- Network: Sepolia
- Result: PASS
- Protocol branch: `fix/erc7984-semantics`

### Deployed demo stack

- Asset: `0xBAa442fFC1C8EEF0FE53E181aF0c3caD3c87e575`
- VeilPool: `0xbFFb9dA6e363D72B2f86B511ecefad3DF49d19e9`
- VeilYieldSource: `0xA083930Fcccc43d73a5DB5f7340188f734Bf5505`
- VeilPrizeVault: `0xE9c1779d58a1b3e31C3C5417e927B09c18Cd1B76`

The asset is the explicit test-only `MockConfidentialToken` used for controlled protocol integration testing. It is not presented as production infrastructure.

### Verified live flow

The fresh hardened Sepolia deployment completed the following path successfully:

1. Minted controlled demo confidential assets.
2. Authorized confidential token operators.
3. Made encrypted deposits for two participants.
4. Verified participant-scoped encrypted principal balances.
5. Snapshotted the encrypted active draw roster.
6. Ran weighted BlindDraw for round 1.
7. Publicly decrypted the encrypted winner output and finalized it with the KMS proof.
8. Accrued asset-backed confidential demo yield.
9. Allocated encrypted yield to the round prize.
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

This result validates the freshly deployed hardened demo path from encrypted deposits through confidential settlement. The local protocol test suite also passed with 35 passing tests and 1 Sepolia-only template test pending before this deployment.

It does not claim that the mock asset, owner-controlled demo yield source, or current bounded draw-seat policy are production-ready economic infrastructure.

## Historical V0.4 deployment evidence

The previous Sepolia smoke deployment remains useful as historical evidence for the earlier protocol version:

- Asset: `0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125`
- VeilPool: `0x523b515A6e3fCB19737dF45243616c36564fD62f`
- VeilYieldSource: `0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3`
- VeilPrizeVault: `0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8`

That deployment previously completed an end-to-end confidential prize flow. It should not be confused with the current ERC-7984 silent-zero and reusable draw-seat implementation.
