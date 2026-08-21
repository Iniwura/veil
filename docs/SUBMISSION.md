# VEIL — Season 4 Submission Kit

## One-line pitch

VEIL is a private prize-savings protocol on Ethereum that uses Zama FHE to keep balances, draw weights, and prize values encrypted while still producing a publicly verifiable winner.

## Short description

VEIL turns prize savings into a confidential onchain primitive. Users deposit encrypted amounts into a shared pool. Their balances and winning weights never need to become plaintext onchain. At draw time, VEIL freezes an encrypted snapshot, runs a BlindDraw over ciphertext weights, publicly verifies the selected winner through Zama's decryption proof flow, routes confidential asset-backed yield into an encrypted prize, and authorizes only that winner to decrypt and claim it.

The protocol is deployed on Sepolia and has passed a full end-to-end live smoke test covering deposit, private balance decryption, snapshot, BlindDraw, KMS-backed winner finalization, confidential yield allocation, winner-only prize decryption, and claim.

## Why FHE is necessary

Without FHE, a weighted onchain prize system usually exposes the values that determine a participant's odds. That leaks balances, deposit sizes, and financial behavior.

VEIL uses FHE because the protocol must be able to:

- add and update balances while encrypted;
- freeze encrypted round weights;
- compare/select over encrypted values;
- keep prize accounting encrypted;
- grant decryption rights only to the correct user.

This is not cosmetic encryption around a public computation. The sensitive values remain ciphertexts during the protocol's core logic.

## What judges should verify

1. `VeilPool.sol` stores confidential user balances and encrypted draw weights.
2. Round snapshots freeze encrypted participant state before selection.
3. BlindDraw operates over ciphertexts rather than plaintext balances.
4. Winner finalization requires the public FHE decryption proof.
5. Yield and prize accounting remain confidential.
6. `VeilPrizeVault` grants prize decryption rights only to the finalized winner.
7. The frontend encrypts inputs client-side using the Zama Relayer SDK.
8. The repository includes a successful live Sepolia end-to-end smoke record.

## Live evidence

Sepolia deployment:

- Demo confidential asset: `0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125`
- VeilPool: `0x523b515A6e3fCB19737dF45243616c36564fD62f`
- VeilYieldSource: `0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3`
- VeilPrizeVault: `0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8`

Observed smoke result on 21 August 2026:

- Round: `1`
- Winner: `0xcC427b61573EEE146fc735159292f06E13bc8B80`
- Confidential prize: `15 encrypted token units`
- End-to-end result: `PASS`

See `docs/SEPOLIA_SMOKE_RESULT.md` for the recorded execution evidence.

## 90-second demo script

### 0:00–0:12 — Problem

"Prize savings are naturally weighted by how much users save, but putting those weights onchain exposes balances and financial behavior. VEIL keeps the values private without giving up verifiability."

### 0:12–0:28 — Product

Show the landing page and enter the dashboard.

"VEIL is a confidential prize-savings pool built with Zama FHE. Balances, weights, withdrawals, and prizes stay encrypted."

### 0:28–0:48 — Private user position

Connect a Sepolia wallet. Show deposit and private balance reveal.

"The amount is encrypted in the browser before submission. The chain receives ciphertext. My balance can be decrypted only for my wallet session."

### 0:48–1:05 — Blind draw

Show the round lifecycle and encrypted pool visualization.

"At draw time, VEIL freezes encrypted weights and performs BlindDraw over ciphertexts. No plaintext odds are published."

### 1:05–1:20 — Verifiable outcome

Scroll to the Live Sepolia Proof section.

"Privacy does not make the result unverifiable. The selected winner is finalized using Zama's public decryption proof flow. This is the real Round 1 Sepolia result."

### 1:20–1:30 — Prize privacy

Show winner/prize proof card.

"Yield is allocated as an encrypted prize, and only the finalized winner receives permission to decrypt and claim it. Private values, public proof. That's VEIL."

## Longer demo flow

For a 2–3 minute recording:

1. Landing page and thesis.
2. Connect MetaMask/Rabby on Sepolia.
3. Explain automatic network switching.
4. Deposit a small demo amount.
5. Reveal private balance and explain user decryption signature.
6. Show that the public dashboard displays participant count, not balances.
7. Explain snapshot and BlindDraw lifecycle.
8. Show Live Sepolia Proof for Round 1.
9. Open the pool/winner in Etherscan from the UI.
10. End on the privacy model: values private, lifecycle and winner verifiable.

## Submission form copy

### Project name

VEIL

### Tagline

Private prize savings. Blind selection. Verifiable winners.

### Description

VEIL is a confidential prize-savings protocol on Ethereum built with Zama FHE. Users deposit encrypted amounts into a shared pool while balances and winning weights remain private. VEIL freezes encrypted round snapshots, performs weighted BlindDraw over ciphertexts, verifies the final winner using Zama's public decryption proof flow, routes confidential asset-backed yield into an encrypted prize, and lets only the finalized winner decrypt and claim it.

The full protocol is deployed on Sepolia and has passed a live end-to-end smoke test from encrypted deposit through confidential prize claim. The React frontend uses the Zama Relayer SDK for client-side encryption and private user decryption.

### Key innovation

VEIL demonstrates a full privacy-preserving financial loop rather than a single encrypted variable: confidential principal, encrypted draw weights, snapshot-based selection, publicly proven winner finalization, confidential yield, winner-specific ACLs, and encrypted prize claims all compose in one application.

### Technology

Zama FHEVM, `@fhevm/solidity`, `@fhevm/hardhat-plugin`, Zama Relayer SDK, Solidity, Hardhat, TypeScript, React, Vite, ethers v6.

## Recording checklist

Before recording:

- Pull latest `main`.
- Start the frontend locally.
- Use a funded Sepolia wallet with no sensitive mainnet assets.
- Confirm Sepolia is selected.
- Keep Etherscan tabs ready for the pool and verified winner.
- Use a clean browser window and hide unrelated extensions/bookmarks where possible.
- Record at 1080p or higher.
- Keep the demo under the program's allowed length.

During recording:

- Show encryption/privacy value before architecture detail.
- Do not spend time on installation commands.
- Show at least one real wallet interaction.
- Show the Live Sepolia Proof section.
- Explicitly state that wallet addresses and transaction timing are public metadata.
- End with the product thesis, not a code screen.

## Final repository checklist

- [x] Contracts implemented
- [x] FHE ACL tests
- [x] 32-player boundary coverage
- [x] Snapshot rounds
- [x] BlindDraw
- [x] Winner proof finalization
- [x] Confidential yield source
- [x] Encrypted prize vault
- [x] Winner-only prize decryption
- [x] Sepolia deployment
- [x] Live end-to-end smoke test
- [x] React frontend
- [x] Relayer SDK integration
- [x] Responsive demo UI
- [x] Live Sepolia proof/history UI
- [x] Frontend CI
- [x] Protocol CI
- [x] Submission-ready README
- [ ] Final screenshots
- [ ] Final demo video
- [ ] Submission form sent

## Claims to avoid

Do not describe VEIL as fully anonymous or fully private. The current implementation intentionally leaves participant addresses, transaction timing, membership, round state, final winner, and claim occurrence public.

Do not describe the deployed yield source as a production yield protocol. It is the confidential accounting layer used for the competition testnet build and demonstrates the intended architecture.

Do not claim a professional security audit. Automated tests and CI are extensive, but the contracts have not received an independent production audit.
