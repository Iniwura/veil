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
