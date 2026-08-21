# VEIL

Private prize savings on Ethereum, powered by Zama FHE.

VEIL lets users deposit confidential balances into a shared prize pool, freezes encrypted round snapshots, selects a winner with BlindDraw over encrypted weights, routes confidential yield into an encrypted prize, and lets only the finalized winner decrypt and claim that prize.

The core idea is simple: **balances stay private, selection stays blind, winners stay verifiable.**

## Why VEIL

Traditional prize-savings systems expose user balances, deposit sizes, and often implied winning odds onchain. VEIL uses Fully Homomorphic Encryption so the pool can operate on encrypted values without revealing them.

What stays private:

- User balances
- Deposit amounts
- Participant weights
- Winner odds
- Prize values until the authorized winner decrypts them

What stays verifiable:

- Participants and round lifecycle
- Snapshot creation
- Finalized winner
- KMS-backed public winner proof
- Prize authorization and claim state

## Live Sepolia deployment

VEIL is deployed and tested on Ethereum Sepolia.

| Contract | Address |
| --- | --- |
| Demo confidential asset | `0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125` |
| VeilPool | `0x523b515A6e3fCB19737dF45243616c36564fD62f` |
| VeilYieldSource | `0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3` |
| VeilPrizeVault | `0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8` |

A full Sepolia smoke test passed on **21 August 2026**:

- Round: `1`
- Winner: `0xcC427b61573EEE146fc735159292f06E13bc8B80`
- Prize: `15 encrypted token units`
- Result: **PASS**

The exact execution record is documented in [`docs/SEPOLIA_SMOKE_RESULT.md`](docs/SEPOLIA_SMOKE_RESULT.md).

## End-to-end flow

1. A user encrypts a deposit client-side with the Zama Relayer SDK.
2. `VeilPool` records the confidential principal and encrypted draw weight.
3. A round snapshot freezes the encrypted participant weights.
4. `blindDraw` selects over encrypted weights without revealing balances or odds.
5. Zama public decryption produces a proof for the encrypted winner handle.
6. `finalizeWinner` verifies the proof and stores the public winner.
7. `VeilYieldSource` records confidential asset-backed yield.
8. Yield is allocated to the round as an encrypted prize in `VeilPrizeVault`.
9. Only the finalized winner is authorized to decrypt the prize.
10. The winner claims the confidential prize.

## Architecture

```text
Wallet + Zama Relayer SDK
          |
          v
  encrypted deposit / withdrawal
          |
          v
      VeilPool
  - confidential balances
  - encrypted weights
  - round snapshots
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

The pool owns the confidential user-position and draw lifecycle.

Key responsibilities:

- Confidential deposits and withdrawals
- Per-user encrypted balances
- Encrypted total weight
- Maximum 32-player pool boundary
- Snapshot-based draw rounds
- Blind weighted selection
- Winner finalization using public FHE decryption proofs

### `VeilYieldSource.sol`

Represents the confidential yield layer used by the demo architecture.

Key responsibilities:

- Records asset-backed encrypted yield
- Preserves confidential yield values
- Allocates yield to a finalized round prize
- Separates prize funding from user principal and draw weight

### `VeilPrizeVault.sol`

Stores encrypted prize accounting and enforces the winner-only privacy boundary.

Key responsibilities:

- Accepts prize accounting from the configured yield source
- Keeps prize values encrypted
- Authorizes the finalized winner
- Allows only that winner to decrypt and claim the prize

## Frontend

The React/Vite demo lives in [`frontend/`](frontend/).

It includes:

- Wallet connection with automatic Sepolia add/switch handling
- Client-side FHE encryption for deposits and withdrawals
- Private balance reveal using user decryption
- Live pool and round state
- Verified Sepolia Round 1 proof/history
- Direct explorer links for deployed contracts and winner evidence
- Responsive desktop, tablet, and mobile layouts

### Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Build verification:

```bash
npm run build
```

## Local contract setup

Requirements:

- Node.js 20+
- npm
- Foundry

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

## Sepolia smoke test

Store secrets with Hardhat's encrypted variables rather than committing them:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
```

Then run the live end-to-end flow:

```bash
npx hardhat run scripts/sepolia-smoke.ts --network sepolia
```

The script exercises confidential deposits, private balance decryption, snapshotting, BlindDraw, public winner proof verification, confidential yield, encrypted prize authorization, winner-only decryption, and claim.

## Testing and verification

The repository has dedicated GitHub Actions for both protocol and frontend verification.

Protocol CI checks:

- Prettier
- ESLint and Solhint
- Solidity compile
- TypeScript build
- Full Hardhat test suite
- Coverage
- Ubuntu and Windows runners

Frontend CI checks:

- Clean dependency install
- TypeScript/Vite production build

The final UX branch passed both frontend and repository-wide CI before merge.

## Privacy model

VEIL does not claim full metadata privacy.

Private:

- Amounts stored and operated on as FHE ciphertexts
- User balance plaintext
- Draw weight plaintext
- Prize plaintext before authorized decryption

Public:

- Wallet addresses
- Transaction timing
- Deposit/withdrawal occurrence
- Participant membership
- Round state
- Finalized winner
- Claim occurrence

This distinction is intentional and documented rather than hidden behind a broad "private" claim.

## Security notes and known limitations

This repository is a testnet competition build, not production financial software.

Important limitations:

- The deployed asset is a test-only confidential token used for the Sepolia demo.
- The pool currently supports at most 32 registered players.
- Transaction identities and timing remain public.
- FHE ciphertext arithmetic and economic bounds should be reviewed again before any production deployment.
- The contracts and frontend have extensive automated tests, but they have not received an independent professional audit.
- Production yield integration would require a real confidential asset/yield adapter rather than the demo yield source.

## Repository layout

```text
contracts/
  VeilPool.sol
  VeilPrizeVault.sol
  VeilYieldSource.sol
  MockConfidentialToken.sol

deploy/
  deployment scripts

scripts/
  sepolia-smoke.ts

frontend/
  React + Vite demo

test/
  FHEVM contract tests

docs/
  deployment and Sepolia verification evidence
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

**Sepolia deployed. Full end-to-end smoke test passed. Frontend and repository CI green.**

VEIL is built for the Zama Developer Program Mainnet Season 4.
