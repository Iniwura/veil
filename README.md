# VEIL

Private prize savings on Ethereum, powered by Zama FHE.

VEIL lets users deposit confidential balances into a shared prize pool, freeze encrypted round snapshots, run BlindDraw over encrypted weights, route confidential yield into an encrypted prize, and let only the finalized winner decrypt and claim that prize.

The core idea is simple: **balances stay private, selection stays blind, winners stay verifiable.**

## Why VEIL

Traditional prize-savings systems expose user balances, deposit sizes, and often implied winning odds onchain. VEIL uses Fully Homomorphic Encryption so the pool can operate on encrypted values without revealing them.

Private:

- User balance plaintext
- Deposit and withdrawal amounts
- Snapshot weight plaintext
- Winning odds
- Prize plaintext before authorized winner decryption

Public:

- Wallet addresses
- Transaction timing and occurrence
- Active draw-seat membership
- Round lifecycle
- Finalized winner or proven cancellation
- Prize authorization and claim state

VEIL does not claim full metadata privacy. That boundary is intentional and explicit.

## Final Sepolia deployment

VEIL is deployed and tested on Ethereum Sepolia.

| Contract | Address |
| --- | --- |
| Demo confidential asset | `0x79836eCae72C3EB5423fd5D1d200CbaEA0cCEE6e` |
| VeilPool | `0xd5395972b0Cd747fAD531389E449958a343adA1b` |
| VeilYieldSource | `0xdDB2b7fe447c55576F882138d59DE00a7d8EbE3D` |
| VeilPrizeVault | `0xb580c50192f5d7C613Db4e9427a2fA0C9701Af84` |

The asset is the explicit test-only `MockConfidentialToken` used for controlled protocol integration testing. It is not presented as production infrastructure.

The final Sepolia end-to-end smoke test passed on **23 August 2026**:

- Round: `1`
- Winner: `0x7d105bd4Ba5a28E9813F75D172BC59D689cA8a84`
- Prize: `15 encrypted token units`
- Winner-only prize decryption: **PASS**
- Confidential prize claim: **PASS**

The execution record is documented in [`docs/SEPOLIA_SMOKE_RESULT.md`](docs/SEPOLIA_SMOKE_RESULT.md).

## End-to-end flow

1. A user encrypts a deposit client-side with the Zama Relayer SDK.
2. `VeilPool` records confidential principal and encrypted draw weight.
3. A temporary draw seat makes the position eligible for the next snapshot.
4. A permissionless snapshot freezes the scheduled close-time roster and encrypted participant weights.
5. `blindDraw` selects over encrypted weights without revealing balances or odds.
6. Zama public decryption produces a proof for the encrypted winner handle.
7. `finalizeWinner` verifies the proof and stores the public winner, or records a proven zero-weight cancellation.
8. `VeilYieldSource` records asset-backed confidential demo yield.
9. Yield is allocated to a finalized round as an encrypted prize in `VeilPrizeVault`.
10. Only the finalized winner is authorized to decrypt and claim the prize.

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
- Draw seats use a 1-day minimum lease and are extended through the next two scheduled closes when needed, so a
  one-day production cadence does not require daily renewal merely to remain eligible.
- Users can renew or release a seat without changing confidential principal.
- Anyone can prune expired seats.
- The active roster is bounded to 32 seats.
- All-zero encrypted rounds can be proven and finalized as `CANCELLED` instead of becoming stuck.

Draw windows use an immutable `firstDrawOpensAt` anchor and the configured `drawPeriod`. Future windows are derived
from that anchor, so delayed snapshot, BlindDraw, or winner finalization never shifts the protocol schedule. Lazy
encrypted close checkpoints preserve the balance and seat eligibility at each scheduled close even when the keeper is
late. Multiple rounds may be snapshotted and await KMS settlement concurrently; Snapshot, BlindDraw, and proof
finalization are permissionless when their state and timing requirements are satisfied.
If a scheduled close has fewer than two eligible seats, `cancelInsufficientRound` advances that round without allowing
post-close entrants to backfill it.

## Architecture

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

## Contracts

### `VeilPool.sol`

Owns confidential user positions and the draw lifecycle.

Key responsibilities:

- Confidential deposits and withdrawals
- Per-user encrypted balances
- Encrypted total weight
- Renewable bounded draw seats
- Immutable encrypted round snapshots
- Blind weighted selection
- KMS-backed winner finalization and cancellation recovery

### `VeilYieldSource.sol`

Represents the confidential demo yield layer.

Key responsibilities:

- Records asset-backed encrypted yield
- Preserves confidential yield values
- Uses all-or-zero allocation semantics
- Allocates only to finalized rounds
- Keeps prize funding separate from user principal and draw weight

### `VeilPrizeVault.sol`

Stores confidential prize assets separately from pool principal.

Key responsibilities:

- Accepts prize funding only from the configured yield source
- Requires a finalized round before prize funding
- Keeps prize values encrypted
- Authorizes only the finalized winner
- Allows only that winner to decrypt and claim the prize

### `MockConfidentialToken.sol`

Test-only confidential asset used for the Sepolia integration demo. Its permissionless mint is deliberate demo infrastructure and not a production token design.

## Frontend

The React/Vite demo lives in [`frontend/`](frontend/).

It includes:

- MetaMask connection with Sepolia add/switch handling
- Zama 0.4.1 browser runtime through the official CDN bundle
- Relayer `/v2` configuration using the connected EIP-1193 wallet provider
- Client-side FHE encryption for deposits and withdrawals
- Explicit wallet-scoped private balance reveal
- Active draw-seat state and renewal
- Dynamic onchain finalized/cancelled round history
- Direct explorer links for the live contracts and public winner evidence
- Responsive desktop, tablet, and mobile layouts

### Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
npm run build
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

## Sepolia deployment and smoke test

Store secrets with Hardhat's encrypted variables rather than committing them:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
```

Deploy the explicit demo asset stack:

```bash
VEIL_DEPLOY_DEMO_ASSET=true \
npx hardhat deploy --network sepolia --tags VEIL --reset
```

Run the live end-to-end flow:

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
  VeilPool.sol
  VeilPrizeVault.sol
  VeilYieldSource.sol
  MockConfidentialToken.sol

deploy/
  deploy.ts

scripts/
  sepolia-smoke.ts
  sepolia-next-round.ts

frontend/
  React + Vite demo

test/
  VEIL FHEVM protocol tests

docs/
  audit and Sepolia verification evidence
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

**Final Sepolia deployment live. End-to-end confidential smoke test passed. Browser deposit, private reveal, and oversized-withdrawal regression passed.**

VEIL is built for the Zama Developer Program Mainnet Season 4.
