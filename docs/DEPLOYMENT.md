# VEIL Sepolia deployment

VEIL uses Hardhat Deploy and Zama's fhEVM Hardhat integration. The deployment script creates and wires the pool, yield
source, and prize vault in one reviewable flow.

## 1. Configure Hardhat secrets

Store secrets with Hardhat vars instead of committing them:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat vars set ETHERSCAN_API_KEY
```

`SEPOLIA_RPC_URL` is preferred. `INFURA_API_KEY` remains supported as a fallback for the template's Infura URL.

The deployer must have Sepolia ETH before deployment.

## 2. Configure the autonomous draw cadence

`VeilPool` receives its draw period as an immutable constructor argument. The deployment script uses a 15-minute default
on Sepolia for demos and a 1-day default on other networks, but the cadence can be explicitly overridden in any
environment:

```bash
export VEIL_DRAW_PERIOD_SECONDS=259200 # three days, for example
```

The value must be a positive integer number of seconds. The selected cadence is printed in the deployment output and is
available onchain through `drawPeriod`, `firstDrawOpensAt`, `nextDrawOpensAt`, `nextDrawClosesAt`, and
`getDrawSchedule()`. All future windows derive from `firstDrawOpensAt + (roundId - 1) * drawPeriod`; delayed settlement
never shifts the schedule. `getDrawSchedule()` reports the actionable timer/readiness state, insufficient close-time
participation, whether the round can advance, overdue settlement, and the number of unsettled rounds. A closed round
with fewer than two eligible seats can be permissionlessly advanced with `cancelInsufficientRound()`; post-close
entrants cannot backfill it. A late keeper cannot rewrite a closed round: the pool seals encrypted balances, seat
addresses, and expiry metadata into one bounded state epoch for the newly closed range before accepting later deposits,
withdrawals, seat releases, or pruning. Unchanged periods do not create per-round storage or FHE ACL work. Multiple
rounds may therefore be snapshotted while older rounds await KMS finalization.

The round states are intentionally distinct: `CANCELLED` is used only after BlindDraw and a valid KMS proof establish an
encrypted zero-address winner, so `getEncryptedWinner()` remains valid for that round. `SKIPPED` is used when the
close-time eligible count is below two and no BlindDraw ran; `getEncryptedWinner()` reverts for a skipped round. State
changes crossing closed windows cost `O(MAX_PLAYERS)`, epoch lookup is `O(log stateEpochCount)`, and materializing one
round costs `O(MAX_PLAYERS + log stateEpochCount)`.

The bounded prototype roster uses a 30-day minimum inactivity lease. Principal remains withdrawable after expiry, users
can renew their own seats through normal interaction, and abandoned seats can still be pruned by anyone.

## 3. Choose the confidential asset

For a real deployment, provide an existing compatible confidential asset address:

```bash
export VEIL_ASSET_ADDRESS=0x...
npm run deploy:sepolia
```

`VeilPool`, `VeilYieldSource`, and `VeilPrizeVault` will all use that same asset.

### Test-only Sepolia asset

`MockConfidentialToken` has unrestricted minting and exists only for protocol integration tests and controlled demos. It
must never be presented as a production asset.

A Sepolia deployment will refuse to deploy it unless the choice is explicit:

```bash
VEIL_DEPLOY_DEMO_ASSET=true npm run deploy:sepolia
```

## 4. Deployment wiring

The deployment script performs these steps in order:

1. Uses `VEIL_ASSET_ADDRESS`, or deploys the explicitly requested test-only asset.
2. Deploys `VeilPool(asset, drawPeriod)`.
3. Deploys `VeilYieldSource(asset)`.
4. Deploys `VeilPrizeVault(pool, asset, yieldSource)`.
5. Configures `VeilYieldSource` to point to the deployed prize vault.
6. Refuses to overwrite a previously configured prize-vault address.

The final console output prints the four addresses needed by the demo frontend.

## UNVEIL V2 — pending fresh deployment

The V2 deployment path is versioned separately from the legacy V1 `deploy/deploy.ts` and `scripts/sepolia-smoke.ts`
paths. It uses the hardhat-deploy tag `UNVEIL_V2` and deployment records prefixed with `UNVEIL_V2_`; it does not read or
overwrite V1 records or canonical addresses.

V2 is explicitly a TEST/DEMO simulated strategy deployment. `MockYieldVault4626.donate()` simulates ERC-4626
appreciation only. It is not Steakhouse yield, Morpho yield, or production yield. The route is intended to exercise real
Zama/FHE execution, public decryption/KMS callbacks, ERC-7984 wrappers, V2 custody/accounting, autonomous draws,
withdrawal settlement, and direct confidential prize delivery.

The exact V2 deployment order is:

1. `MockUSDC`
2. `MockUSDCConfidentialWrapper`
3. `MockYieldVault4626`
4. `MockYieldVaultShareConfidentialWrapper`
5. `VeilDepositBatcher`
6. `VeilWithdrawalBatcher`
7. `VeilPoolV2`
8. `VeilPrizeVaultV2`
9. `VeilStrategyManagerV2`
10. one-time `pool.configureStrategyManager(manager)`

The V2 parameters are strict decimal-integer environment settings:

```bash
UNVEIL_V2_DRAW_PERIOD_SECONDS=900
UNVEIL_V2_BATCH_AGE_SECONDS=120
UNVEIL_V2_BUFFER_RESERVE_BPS=2000
UNVEIL_V2_VALUATION_HAIRCUT_BPS=0
```

Sepolia defaults are a 900-second draw period and 120-second batch age. Local/default values are 86,400 seconds and
3,600 seconds. Reserve BPS must be 0–10,000; valuation haircut BPS must be 0–9,999. Invalid timing or BPS values fail
before deployment.

Use the new commands only after reviewing the printed addresses and wiring checks:

```bash
npm run deploy:v2:localhost
npm run deploy:v2:sepolia
npm run smoke:v2:sepolia
```

Do not run the Sepolia command as part of ordinary tests. This repository currently contains no official Sepolia
csteakcUSDC or Steakhouse confidential-yield route, so the V2 deployment remains pending and must not be described as a
production strategy deployment.

The V2 smoke script accepts explicit `UNVEIL_V2_*_ADDRESS` variables or the new hardhat-deploy records only; it never
falls back to V1 addresses. It checks bytecode and all immutable wiring, uses `fhevm.initializeCLIApi()`, and resumes
the fixed smoke identifiers (draw round `1` and withdrawal request `1`) through their existing state machines. It never
uses `evm_increaseTime` on Sepolia. When a real-time draw or batch age is not ready, it prints the exact timestamp and
exits cleanly unless `UNVEIL_V2_SMOKE_WAIT=true` is set to poll until ready. The smoke flow's simulated appreciation
phase prints `TEST/DEMO ONLY: simulating ERC4626 appreciation` and its startup summary reports only public state. The
deposit phase reports the current batch separately from the recognized manager batch it must resume, and scans the small
V2 demo batch range for an unresolved Pending, Dispatched, Finalized, or Canceled manager batch before investing.
Withdrawal claims inherit `BatcherConfidential`'s fixed six-decimal exchange-rate rounding and may restore slightly less
principal than the pre-batch target. The smoke preserves all-or-zero settlement and, after a proven incomplete payout,
uses bounded permissionless funding cycles to recompute encrypted residual liquidity and resume the same request.

V2 deployment records are reused only when their constructor arguments and prior deployment transaction can be verified
against the current artifact. A missing transaction or any artifact/argument mismatch fails clearly; the script does not
silently repair or redeploy a mismatched Sepolia stack. After reuse or deployment, the immutable draw period, both batch
ages, reserve BPS, haircut BPS, and complete route wiring are checked onchain before parameters are printed as valid.

## 5. Verification

Compile and test locally before any network deployment:

```bash
npm run compile
npm run build:ts
npm test
npm run lint
```

This branch intentionally does not deploy to Sepolia. Its constructor and ABI require a fresh, versioned deployment
stack before any existing address is used. After a future deployment, verify each contract with the exact constructor
arguments used by the deployment; do not claim success until receipts and deployed bytecode are confirmed.

## Privacy boundary

Deployment does not change VEIL's FHE access policy. Individual principal, snapshot weights, withdrawals, unallocated
yield, and prize amounts remain encrypted. The finalized winner address is public because settlement requires it. The
prize ciphertext is authorized only to the finalized winner.
