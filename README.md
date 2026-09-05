# UNVEIL

## Save privately. Win verifiably.

Encrypted to everyone. Unveiled only to you.

UNVEIL is a private prize-savings testnet build powered by Zama FHE. It keeps
balances, draw weights, and prize values encrypted while preserving a fixed,
permissionless draw schedule, a publicly verified winner, and confidential
automatic prize delivery.

### LIVE DEMO

Not hosted yet. This release candidate has no public URL; do not invent one.

## What UNVEIL demonstrates

- Private prize savings with client-side FHE encryption.
- Encrypted balances and immutable encrypted round weights.
- Fixed periodic draws that anyone can advance after the scheduled close.
- BlindDraw selection over ciphertexts rather than plaintext odds.
- A public winner finalized only with a valid Zama/KMS decryption proof.
- Confidential automatic delivery through `VeilPrizeVaultV2`; the winner does not submit a claim transaction.
- A simulated ERC-4626 Sepolia strategy used for test/demo accounting, not a market-yield claim.
- A live V2 Sepolia deployment and a passing end-to-end smoke result.

Wallet addresses, transaction timing, roster membership, round state, winner,
and prize-processing activity remain public metadata. UNVEIL does not claim
full metadata privacy.

## Live UNVEIL V2 Sepolia TEST/DEMO deployment

The active frontend uses this canonical V2 stack. The label `SEPOLIA TEST/DEMO`
is intentional: `MockUSDC` and `MockYieldVault4626` are implementation names
for test assets and simulated ERC-4626 strategy behavior. They are not real
USDC/cUSDC, Steakhouse/Morpho yield, or production market yield.

| Component | Address |
| --- | --- |
| MockUSDC | `0x54350EE95601Ed535039993a5eE05FdA1Bd0Ae0C` |
| PrincipalWrapper | `0xc948EDA1EA4c29d09965d1A15C3AC5B38cBdBB13` |
| MockYieldVault4626 | `0xa39F57644e77FDb6E4F705F67BC08710d366d289` |
| ShareWrapper | `0x48129B9c003b69987143d2622dC632Bc651E1F61` |
| DepositBatcher | `0xb7BFbb875DCF3bd7c0B30536eBf60c284f0De2f1` |
| WithdrawalBatcher | `0xa5f1B091ac896C01f73d47100666d80961FC4620` |
| VeilPoolV2 | `0xFC5E4b552f16975d9d0B28Ab8cd14eE4a3d3Dc76` |
| VeilPrizeVaultV2 | `0x0Dc3d8978ee509EFb71183377E5EAf2f28420525` |
| VeilStrategyManagerV2 | `0xFF4106998079309500Ad07d41382436f3fC681E7` |

Contract source SHA: `1b959b756c8bec732b4613eb8433322e0062a861`.
Offchain smoke/test evidence SHA: `24018fda961400a1f5ea344373d90bec2ba83c2a`.
The complete live result is in [`docs/UNVEIL_V2_LIVE_RESULT.md`](docs/UNVEIL_V2_LIVE_RESULT.md).

## V2 architecture and flow

1. The browser encrypts a deposit with the Zama Relayer SDK.
2. `VeilPoolV2` records confidential principal and encrypted draw-seat weight.
3. At the fixed scheduled close, a permissionless snapshot freezes the eligible roster.
4. `blindDraw` selects over encrypted weights without revealing balances or odds.
5. Zama public decryption proves the encrypted winner handle; `finalizeWinner` stores the public winner.
6. `VeilStrategyManagerV2` accounts for the simulated ERC-4626 strategy and processes finalized rounds in order.
7. `VeilPrizeVaultV2` delivers the safe confidential surplus directly to the winner.

## Canonical V2 commands

The deployment and smoke scripts are retained for explicit review and repeatable
testnet verification:

```bash
npm run deploy:v2:sepolia
npm run smoke:v2:sepolia
```

Do not redeploy the canonical live demo merely to run the frontend. Review the
existing addresses above and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) first.

## Legacy V1 / historical implementation

The original owner-funded V1 deployment and contracts remain in the repository
for historical reference only. They are not used by the active frontend and
are not the canonical Sepolia flow.

| Contract | Address |
| --- | --- |
| Demo confidential asset | `0x79836eCae72C3EB5423fd5D1d200CbaEA0cCEE6e` |
| VeilPool | `0xd5395972b0Cd747fAD531389E449958a343adA1b` |
| VeilYieldSource | `0xdDB2b7fe447c55576F882138d59DE00a7d8EbE3D` |
| VeilPrizeVault | `0xb580c50192f5d7C613Db4e9427a2fA0C9701Af84` |

The historical asset is the explicit test-only `MockConfidentialToken`. The
older V1 smoke record is preserved in [`docs/SEPOLIA_SMOKE_RESULT.md`](docs/SEPOLIA_SMOKE_RESULT.md)
and must not be confused with the active V2 evidence.

## Confidential transfer semantics

VEIL uses all-or-zero ERC-7984-style behavior for confidential requests.

For a user with private principal `5`:

- Withdraw `2` → `2` moves and private principal becomes `3`.
- Withdraw `6` → `0` moves and private principal remains `5`.

The oversized request is checked against the caller's encrypted VEIL principal before the shared custody contract moves assets. This prevents one participant from spending another participant's pooled custody while keeping the caller's exact balance private.

The frontend therefore never infers or publishes an "insufficient balance" result. It reports that the confidential request was processed and lets the user explicitly decrypt their resulting position.

## Draw-seat model

Private positions and BlindDraw roster membership are separate concepts.

- Principal remains withdrawable even when a draw seat expires.
- Draw seats use a 30-day minimum inactivity lease and are extended through the next two scheduled closes when needed.
- Users can renew or release a seat without changing confidential principal.
- Anyone can prune expired seats.
- The active roster is bounded to 32 seats.
- All-zero encrypted rounds can be proven and finalized as `CANCELLED` instead of becoming stuck.
- `CANCELLED` means BlindDraw ran and KMS proved an encrypted zero-address winner; its encrypted winner handle remains available.
- `SKIPPED` means the round never ran because fewer than two seats were eligible at its scheduled close; skipped rounds have no winner handle.

Draw windows use an immutable `firstDrawOpensAt` anchor and the configured `drawPeriod`. Future windows are derived
from that anchor, so delayed snapshot, BlindDraw, or winner finalization never shifts the protocol schedule. Lazy
encrypted state epochs preserve the balance and seat eligibility across scheduled closes even when the keeper is late.
Closed ranges with no state changes are stored as one bounded epoch rather than copied once per round.
Multiple rounds may be snapshotted and await KMS settlement concurrently; Snapshot, BlindDraw, and proof
finalization are permissionless when their state and timing requirements are satisfied.
If a scheduled close has fewer than two eligible seats, `cancelInsufficientRound` advances that round without allowing
post-close entrants to backfill it.
State changes that cross scheduled closes cost `O(MAX_PLAYERS)`, historical epoch lookup is `O(log stateEpochCount)`,
and materializing one historical round is `O(MAX_PLAYERS + log stateEpochCount)`; missed rounds are not replayed one by one.

### Legacy V1 architecture reference

The following diagram and V1 contract descriptions are preserved for historical context. The active frontend uses the
V2 route and addresses in `docs/DEPLOYMENT.md`.

```text
Wallet + Zama Relayer SDK
          |
          v
 encrypted deposit / withdrawal
          |
          v
      VeilPool
  - confidential principal
  - temporary draw seats
  - encrypted snapshots
  - BlindDraw
  - winner proof finalization
          |
          +--------------------+
          |                    |
          v                    v
 VeilYieldSource          public winner
 - confidential yield
 - asset-backed allocation
          |
          v
   VeilPrizeVault
 - encrypted round prizes
 - winner-only decrypt ACL
 - confidential claim
```

### Legacy V1 contracts

#### `VeilPool.sol`

Owns confidential user positions and the draw lifecycle.

Key responsibilities:

- Confidential deposits and withdrawals
- Per-user encrypted balances
- Encrypted total weight
- Renewable bounded draw seats
- Immutable encrypted round snapshots
- Blind weighted selection
- KMS-backed winner finalization and cancellation recovery

#### `VeilYieldSource.sol`

Represents the confidential demo yield layer.

Key responsibilities:

- Records asset-backed encrypted yield
- Preserves confidential yield values
- Uses all-or-zero allocation semantics
- Allocates only to finalized rounds
- Keeps prize funding separate from user principal and draw weight

#### `VeilPrizeVault.sol`

Stores confidential prize assets separately from pool principal.

Key responsibilities:

- Accepts prize funding only from the configured yield source
- Requires a finalized round before prize funding
- Keeps prize values encrypted
- Authorizes only the finalized winner
- Allows only that winner to decrypt and claim the prize

#### `MockConfidentialToken.sol`

Test-only confidential asset used for the Sepolia integration demo. Its permissionless mint is deliberate demo infrastructure and not a production token design.

## Frontend

The React/Vite demo lives in [`frontend/`](frontend/).

It includes:

- MetaMask connection with Sepolia add/switch handling
- Zama 0.4.1 browser runtime through the official CDN bundle
- Relayer `/v2` configuration using the connected EIP-1193 wallet provider
- Client-side FHE encryption for deposits and withdrawals
- Explicit wallet-scoped private balance reveal
- Wallet-scoped active principal, reserved principal, historical weight, prize, and strategy-share reveals
- Active draw-seat state and renewal
- Contract-derived draw schedule and withdrawal-request lifecycle
- Dynamic onchain finalized/cancelled/skipped round history
- Direct explorer links for the live contracts and public winner evidence
- Responsive desktop, tablet, and mobile layouts

The frontend deliberately does not show an exact winning percentage. A wallet may decrypt its own historical snapshot
weight, but V2 does not grant it decryption rights for the encrypted aggregate snapshot weight. Dividing by the public
participant count would be mathematically incorrect for a weighted draw.

Production hosting requirements are documented in [`docs/FRONTEND_HOSTING.md`](docs/FRONTEND_HOSTING.md). No hosting
provider has been selected or configured in this release candidate.

### Run the frontend

```bash
cd frontend
npm ci
npm run dev
```

Production build:

```bash
npm run build
npm run verify:dist
```

## Local contract setup

Requirements:

- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run tests:

```bash
npm test
```

Run coverage:

```bash
npm run coverage
```

## Legacy V1 deployment and smoke test (historical)

The commands in this section are retained only for the historical V1 records.
Use the V2 commands near the top of this README for the active architecture.

Store secrets with Hardhat's encrypted variables rather than committing them:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
```

Deploy the historical V1 demo asset stack:

```bash
VEIL_DEPLOY_DEMO_ASSET=true \
npx hardhat deploy --network sepolia --tags VEIL --reset
```

Run the historical V1 end-to-end flow:

```bash
npx hardhat run scripts/sepolia-smoke.ts --network sepolia
```

The smoke script verifies contract wiring, confidential deposits, user-scoped decryption, encrypted snapshotting, BlindDraw, public winner proof finalization, confidential yield, finalized-round prize allocation, winner-only prize decryption, and claim.

## Testing and verification

Protocol tests cover:

- Confidential deposit and withdrawal semantics
- Multi-user custody isolation
- ACL preservation
- Oversized silent-zero requests
- Immutable encrypted snapshots
- BlindDraw and public winner proof validation
- Draw-seat expiry, release, pruning, and cancellation recovery
- Prize/yield custody separation
- Finalized-round prize funding
- Winner-only decryption and claim

The frontend production build was validated after the final Zama browser-runtime migration, and the live browser regression confirmed that an oversized withdrawal request leaves the user's private principal unchanged.

## Security notes and known limitations

This repository is a testnet competition build, not production financial software.

Important limitations:

- The deployed asset is a test-only confidential token.
- The yield source is an owner-controlled demo adapter, not a production yield venue.
- The active draw roster is bounded to 32 leased seats; temporary Sybil seat spam is still an economic/design consideration.
- Wallet identities, transaction timing, and transaction occurrence remain public.
- FHE ciphertext arithmetic and economic bounds should receive another dedicated production audit before real-value deployment.
- The contracts and frontend have automated tests and live testnet evidence, but they have not received an independent professional security audit.

## Repository layout

```text
contracts/
  VeilPoolV2.sol
  VeilPrizeVaultV2.sol
  strategy/
    VeilStrategyManagerV2.sol
  VeilPool.sol                 # Legacy V1 / historical
  VeilPrizeVault.sol           # Legacy V1 / historical
  VeilYieldSource.sol          # Legacy V1 / historical

deploy/
  deploy-v2.ts
  deploy.ts                    # Legacy V1 / historical

batchers/
  routes are implemented under contracts/strategy/

scripts/
  sepolia-v2-smoke.ts
  sepolia-smoke.ts
  sepolia-next-round.ts         # Legacy V1 / historical

frontend/
  src/components/
  src/pages/
  src/hooks/
  React + Vite demo

test/
  VEIL FHEVM protocol tests

docs/
  hosting, deployment, live evidence, and demo documentation
```

## Built with

- Zama FHEVM
- `@fhevm/solidity`
- `@fhevm/hardhat-plugin`
- Zama Relayer SDK
- Solidity
- Hardhat
- TypeScript
- React
- Vite
- ethers v6

## Status

**UNVEIL V2 Sepolia TEST/DEMO deployment documented. Live V2 smoke passed. Frontend release candidate is locally verified; hosting remains a separate next slice.**

UNVEIL is built for the Zama Developer Program Mainnet Season 4.
