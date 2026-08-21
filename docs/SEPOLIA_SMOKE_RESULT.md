# VEIL Sepolia end-to-end smoke result

Date: 2026-08-21
Network: Sepolia
Result: PASS

## Deployed demo stack

- Asset: `0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125`
- VeilPool: `0x523b515A6e3fCB19737dF45243616c36564fD62f`
- VeilYieldSource: `0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3`
- VeilPrizeVault: `0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8`

The asset is the explicit test-only `MockConfidentialToken` used for controlled protocol integration testing. It is not presented as production infrastructure.

## Verified live flow

The live smoke script completed the following path successfully on Sepolia:

1. Minted controlled demo confidential assets.
2. Authorized confidential token operators.
3. Made encrypted deposits for two participants.
4. Verified participant-scoped encrypted principal balances.
5. Snapshotted the encrypted pool.
6. Ran weighted BlindDraw for round 1.
7. Publicly decrypted the encrypted winner output and finalized it with the KMS proof.
8. Accrued asset-backed confidential demo yield.
9. Allocated encrypted yield to the round prize.
10. Authorized only the finalized winner to decrypt the prize.
11. Claimed the confidential prize without mutating principal accounting.

## Observed result

- Round: `1`
- Winner: `0xcC427b61573EEE146fc735159292f06E13bc8B80`
- Prize: `15` encrypted token units
- Winner-only prize decryption: PASS
- Confidential prize claim: PASS

Final script output:

```text
VEIL Sepolia smoke test PASSED
  round:  1
  winner: 0xcC427b61573EEE146fc735159292f06E13bc8B80
  prize:  15 encrypted token units (decrypted only by winner)
```

This result validates the deployed demo path from encrypted deposits through confidential settlement. It does not claim the mock asset or owner-controlled demo yield source are production-ready economic infrastructure.
