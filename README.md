# UNVEIL

**Save privately. Win verifiably.**

UNVEIL is a confidential prize-savings protocol for the Zama Developer Program Mainnet Season 4. Users save confidential cUSDC in a shared pool, the protocol freezes encrypted draw weights on a contract-enforced schedule, Fully Homomorphic Encryption selects a weighted winner without exposing balances or odds, and realized confidential yield is delivered as an encrypted prize.

The core idea is simple:

> PoolTogether proves a fair prize-savings draw on a transparent chain. UNVEIL keeps the draw verifiable without making each saver’s financial position transparent.

## What stays private

UNVEIL keeps these values encrypted onchain:

- current principal
- deposit and withdrawal amounts
- total deposited and withdrawn
- latest private deposit and withdrawal
- frozen draw weight
- exact personal odds until the user decrypts them locally
- prize amount

The owner of a position can explicitly **UNVEIL** their own private values with wallet-scoped user decryption. Other participants and the public cannot read those plaintext amounts.

The following metadata remains public by design:

- wallet addresses
- transaction occurrence and timing
- active draw-seat membership
- draw deadlines and lifecycle state
- participant count
- finalized winner or KMS-proven cancellation
- prize funded/delivered status

UNVEIL does not claim full metadata privacy.

## Why UNVEIL exists

Prize savings should not require publishing the size of a user’s savings position.

| Public prize savings | UNVEIL |
| --- | --- |
| savings balance observable or inferable | balance encrypted |
| deposit and withdrawal amounts public | amounts encrypted |
| draw weight observable or inferable | weight encrypted |
| odds observable or inferable | exact personal odds privately decrypted |
| prize amount public | prize amount encrypted |
| transparent selection | blind FHE selection + public KMS proof |
| periodic draws | contract-enforced periodic draws |
| automated prize delivery | permissionless confidential prize delivery |

## Current winner-build status

The `feat/unveil-winner-build` branch is the active competition build.

Validated in CI:

- **43 protocol tests passing**
- Solidity compile: **PASS**
- TypeScript build: **PASS**
- Solhint + ESLint + Prettier: **PASS**
- Windows and Unix test matrices: **PASS**
- Solidity coverage: **95.83% statements / 97.08% lines**
- frontend production build: **PASS**

A fresh Sepolia deployment of this UNVEIL version is still required before the deployment table below is filled. The older VEIL deployment recorded in historical audit/smoke documents predates the autonomous UNVEIL protocol and must not be presented as the final UNVEIL deployment.

## Sepolia competition asset

UNVEIL defaults to Zama’s official Sepolia confidential USDC mock wrapper rather than deploying a private one-off token.

| Asset | Address |
| --- | --- |
| Zama `cUSDCMock` | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` |
| mock USDC underlying | `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` |

The underlying mock token has a public testnet mint path. The wrapper is the confidential ERC-7984-style asset used by the competition deployment.

## Final UNVEIL Sepolia deployment

Pending fresh deployment of the current branch.

| Contract | Address |
| --- | --- |
| cUSDCMock | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` |
| VeilPool | `PENDING` |
| VeilYieldSource | `PENDING` |
| VeilPrizeVault | `PENDING` |

The Solidity contract filenames retain the earlier `Veil*` names for migration continuity. **UNVEIL** is the product name and user-facing identity.

## Draw model

Production target: **daily draws**.

Sepolia competition default: **15-minute draws**, so a reviewer can experience a full encrypted round without waiting a day.

The schedule is enforced by the contract, not by an administrator.

```text
DRAW OPEN
   |
   | users save confidential cUSDC
   | strategy realizes encrypted yield
   v
ONCHAIN DEADLINE
   |
   | anyone may close the elapsed period
   v
ENCRYPTED SNAPSHOT
   |
   | anyone may execute BlindDraw
   v
ENCRYPTED WINNER
   |
   | Zama public decryption returns clear winner + KMS proof
   | anyone may submit the valid proof
   v
FINALIZED WINNER
   |
   | sealed realized yield routes to this predetermined round
   | anyone may trigger prize delivery
   v
ENCRYPTED PRIZE ARRIVES AT WINNER
```

No keeper chooses the winner, destination round, or prize recipient.

### Deadline fairness

If nobody calls the contract exactly at the deadline, the eventual closer freezes eligibility and weights relative to the scheduled close. A late deposit cannot retroactively alter the expired round.

### Bounded FHE roster

The current competition implementation keeps a bounded active FHE roster of 32 draw seats.

- saving never fails merely because all draw seats are occupied
- users without a seat still retain a functional confidential savings position
- seats use a 30-day lease and stale seats can be pruned
- deposits automatically acquire or renew eligibility when capacity exists
- principal remains privately withdrawable even after a seat expires

The bounded roster is a competition-scale FHE constraint, not a claim of unlimited production capacity.

## Private owner dashboard

A participant can decrypt their own position in one wallet-scoped session:

- balance
- total deposited
- total withdrawn
- last deposit
- last withdrawal

For a frozen round, a participant can also privately decrypt:

- their own snapshot weight
- the encrypted snapshot total
- exact personal odds computed locally from those two values

The total snapshot denominator is permissioned only to participants in that round. Individual peer weights remain inaccessible.

## Prize delivery

Winning does not require the winner to discover and manually execute a claim transaction.

After a round is finalized and confidential yield is funded:

1. anyone can authorize the fixed finalized winner
2. anyone can call `deliverPrize(roundId)`
3. the prize is confidentially transferred directly to the winner
4. the caller never receives the funds
5. the winner can later UNVEIL the encrypted awarded amount

The historical `claimPrize` method remains only as a backwards-compatible alias.

## Yield architecture

UNVEIL separates draw authority from strategy authority.

`VeilYieldSource` has a configured strategy operator that can move realized confidential assets into the current encrypted yield bucket. That operator:

- cannot choose the winner
- cannot choose a destination round
- cannot deliver a prize to itself
- cannot continue changing a bucket after it has been sealed

Once a bucket is sealed, allocation is permissionless and sequential.

### Sepolia honesty

The competition deployment uses controlled, asset-backed confidential cUSDC transfers to simulate realized strategy yield. It does **not** claim that Sepolia yield came from Morpho or another live lending market.

### Production path

Zama’s confidential Steakhouse USDC vault on Ethereum mainnet provides a credible production venue, but it is asynchronous. A production UNVEIL adapter must account for pending deposits, confidential vault shares, redemption latency, idle withdrawal liquidity, and realized-yield boundaries instead of pretending that the vault behaves like a synchronous ERC-4626 strategy.

See [`docs/PRODUCTION_YIELD_PATH.md`](docs/PRODUCTION_YIELD_PATH.md).

## App structure

The frontend is no longer one page with anchor tabs.

Routes:

- `/` — full product landing page
- `/app` — overview
- `/app/save` — deposit and withdraw
- `/app/draws` — live countdown and draw lifecycle
- `/app/vault` — owner-only private position and odds
- `/app/prizes` — winnings and private prize reveal
- `/app/history` — verified round history
- `/protocol` — architecture, contracts and privacy boundary

The Vercel SPA rewrite is included so direct route loads resolve correctly.

## Guided onboarding

First-time users can run a short guided product tour:

1. connect a Sepolia wallet
2. get or use cUSDCMock
3. save privately
4. watch a contract-timed draw
5. UNVEIL private stats
6. understand automatic confidential prize delivery

The guide can be skipped and replayed later.

## Motion and interaction language

Blackout is the baseline, not the target.

UNVEIL’s motion system is built around its own privacy concept:

- ciphertext-to-plaintext UNVEIL transitions
- plaintext-to-ciphertext VEIL transitions
- animated encrypted field and proof states
- scroll-driven product storytelling
- route transitions
- draw-countdown state changes
- interactive encryption theatre
- prize/winner states
- responsive micro-interactions
- `prefers-reduced-motion` support

The goal is not decorative Web3 motion. Every transition should reinforce what is encrypted, what is public, and what the connected wallet alone can reveal.

## Contracts

### `VeilPool.sol`

Responsibilities:

- confidential deposits and withdrawals
- private owner accounting
- bounded draw eligibility
- contract-enforced draw schedule
- immutable encrypted snapshots
- participant-only exact-odds denominator
- permissionless BlindDraw
- KMS-backed public winner finalization
- proven zero-weight cancellation

### `VeilYieldSource.sol`

Responsibilities:

- strategy-only confidential realized-yield accrual
- sequential per-round yield buckets
- explicit bucket sealing
- permissionless allocation after finalization
- cancelled-round yield carry
- separation between strategy and draw authority

### `VeilPrizeVault.sol`

Responsibilities:

- separate confidential prize custody
- finalized-winner validation
- winner-only decrypt ACL
- permissionless direct prize delivery
- preserved encrypted awarded amount after payout

### `MockConfidentialToken.sol`

Local/testing-only ERC-7984-style confidential asset used by Hardhat tests. Sepolia defaults to Zama’s published `cUSDCMock` instead.

## Run locally

Requirements:

- Node.js 20+
- npm

```bash
npm ci
npm run compile
npm run build:ts
npm test
npm run coverage
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Production frontend build:

```bash
npm run build
```

## Deploy to Sepolia

Use Hardhat encrypted variables for secrets. Never put a private key or mnemonic in source control.

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
```

Default UNVEIL deployment using Zama `cUSDCMock` and the 15-minute competition cadence:

```bash
npx hardhat deploy --network sepolia --tags UNVEIL --reset
```

Optional environment controls:

- `UNVEIL_ASSET_ADDRESS`
- `UNVEIL_DRAW_PERIOD_SECONDS`
- `UNVEIL_STRATEGY_OPERATOR_ADDRESS`
- `UNVEIL_DEPLOY_DEMO_ASSET=true` for an explicit local-style test asset rather than the official Sepolia wrapper

Run the fresh end-to-end smoke after deployment:

```bash
npx hardhat run scripts/sepolia-smoke.ts --network sepolia
```

## Automation

The repository includes separate automation paths for:

- permissionless draw progression and prize delivery
- strategy-operator yield synchronization/sealing

They are intentionally separate roles. See [`docs/UNVEIL_AUTOMATION.md`](docs/UNVEIL_AUTOMATION.md).

A GitHub Actions keeper is optional convenience, not a trust dependency: any account can perform the permissionless maintenance calls.

## Security and known limitations

This remains testnet competition software, not audited production financial infrastructure.

Important boundaries:

- the active FHE draw roster is capped at 32 seats
- temporary seat spam remains an economic consideration
- wallet identity and transaction metadata remain public
- the Sepolia strategy is a controlled yield simulation backed by real testnet confidential assets, not live market yield
- mainnet asynchronous strategy integration remains a documented production path rather than hidden inside the competition build
- encrypted aggregate arithmetic still needs dedicated production bounds/overflow analysis before real-value deployment
- automated protocol coverage is strong, but there is no independent professional security audit

## Repository layout

```text
contracts/
  VeilPool.sol
  VeilPrizeVault.sol
  VeilYieldSource.sol
  MockConfidentialToken.sol

deploy/
  deploy.ts

scripts/
  sepolia-smoke.ts
  sepolia-next-round.ts
  sepolia-sync-yield.ts

frontend/
  React + Vite UNVEIL application

test/
  FHEVM protocol tests

docs/
  audit, automation, yield architecture and live verification evidence
```

## Built with

- Zama Protocol / FHEVM
- `@fhevm/solidity`
- `@fhevm/hardhat-plugin`
- Zama Relayer SDK
- ERC-7984 confidential-token semantics
- Solidity
- Hardhat
- TypeScript
- React
- Vite
- ethers v6

## Competition direction

UNVEIL is built to answer one question:

> Can a prize-savings protocol remain publicly verifiable without making the saver’s financial position public?

The protocol, app and motion system are designed around making the answer visible: **yes — encrypted to everyone, unveiled only to you.**
