# UNVEIL V2 live Sepolia result

Status: **PASS** Network: Sepolia Label: **SEPOLIA TEST/DEMO**

This is the preserved result of the verified V2 live smoke. It is evidence for the current canonical address set, not a
new deployment and not a claim of market yield.

## Pinned implementation

- Contract source SHA: `1b959b756c8bec732b4613eb8433322e0062a861`
- Offchain smoke/test SHA: `24018fda961400a1f5ea344373d90bec2ba83c2a`
- Draw period: `900` seconds
- Deposit and withdrawal batch age: `120` seconds
- Buffer reserve: `2000` BPS
- Valuation haircut: `0` BPS

The canonical addresses are listed in [`README.md`](../README.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md). No private keys,
mnemonics, or wallet credentials belong in this record.

## Verified protocol path

1. Alice and Bob made confidential deposits through the V2 wrappers.
2. Pool principal custody was zero after the strategy investment; the manager held the strategy position instead.
3. The strategy investment completed through the configured route and its KMS callback path.
4. Simulated ERC-4626 appreciation was applied through the mock vault. This is test/demo strategy behavior, not real
   market yield.
5. Round 1 reached `FINALIZED` through the public winner-proof flow.
6. Alice was the verified winner.
7. `37` confidential strategy shares were delivered automatically to Alice. No winner claim transaction was required.

## Withdrawal rounding evidence

The same smoke preserved the six-decimal withdrawal edge case:

- Withdrawal request `1` entered the queued withdrawal route.
- The first settlement delivered zero because of the batcher's six-decimal rounding boundary while the encrypted debt
  remained recorded.
- A residual second batch was created and settled permissionlessly.
- Final private positions were Alice `0/0` active/reserved and Bob `100/0` active/reserved.

The complete smoke result was **PASS**. The V2 smoke script is resumable and must not be run against the canonical live
deployment merely to record a demo. Use the existing result and the verified Round 1 replay in the frontend.
