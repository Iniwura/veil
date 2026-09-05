# UNVEIL — Release candidate submission kit

## One-line pitch

UNVEIL is a private prize-savings testnet build on Ethereum that uses Zama FHE to keep balances, draw weights, and prize values encrypted while still producing a publicly verifiable winner.

## Short description

UNVEIL turns prize savings into a confidential onchain primitive. Users deposit encrypted amounts into a shared pool. Their balances and winning weights never need to become plaintext onchain. At draw time, UNVEIL freezes an encrypted snapshot, runs a BlindDraw over ciphertext weights, publicly verifies the selected winner through Zama's decryption proof flow, routes simulated ERC-4626 strategy surplus into an encrypted prize, and delivers it automatically to the finalized winner.

The V2 protocol is deployed on Sepolia TEST/DEMO and has passed a full end-to-end live smoke test covering confidential deposits, strategy investment, KMS-backed winner finalization, simulated appreciation, automatic confidential prize delivery, and withdrawal rounding recovery. See [`UNVEIL_V2_LIVE_RESULT.md`](UNVEIL_V2_LIVE_RESULT.md).

## Why FHE is necessary

Without FHE, a weighted onchain prize system usually exposes the values that determine a participant's odds. That leaks balances, deposit sizes, and financial behavior.

UNVEIL uses FHE because the protocol must be able to:

- add and update balances while encrypted;
- freeze encrypted round weights;
- compare/select over encrypted values;
- keep prize accounting encrypted;
- grant decryption rights only to the correct user.

This is not cosmetic encryption around a public computation. The sensitive values remain ciphertexts during the protocol's core logic.

## What judges should verify

1. `VeilPoolV2.sol` stores confidential user balances and encrypted draw weights.
2. Round snapshots freeze encrypted participant state before selection.
3. BlindDraw operates over ciphertexts rather than plaintext balances.
4. Winner finalization requires the public FHE decryption proof.
5. Yield and prize accounting remain confidential.
6. `VeilPrizeVaultV2` grants prize decryption rights only to the finalized winner.
7. The frontend encrypts inputs client-side using the Zama Relayer SDK.
8. The repository includes a successful live Sepolia end-to-end smoke record.

## Live evidence

The canonical V2 address table is in [`README.md`](../README.md). The pinned
contract source SHA is `1b959b756c8bec732b4613eb8433322e0062a861` and the
offchain smoke/test SHA is `24018fda961400a1f5ea344373d90bec2ba83c2a`.

The full preserved result is [`UNVEIL_V2_LIVE_RESULT.md`](UNVEIL_V2_LIVE_RESULT.md):
Round 1 finalized with Alice as the verified winner, 37 confidential strategy
shares were delivered automatically, and the withdrawal rounding recovery
completed with Alice at 0/0 and Bob at 100/0.

## Three-minute demo script

Use [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). It covers the landing pitch, privacy
model, private save flow, BlindDraw and public proof, My Vault signature reveal,
automatic prize delivery, simulated strategy disclosure, live contract
evidence, and the required shot list. It is designed around the existing
finalized Round 1 result and does not require creating a new live round.

## Submission form copy

### Project name

UNVEIL

### Tagline

Save privately. Win verifiably.

### Description

UNVEIL is a confidential prize-savings testnet build on Ethereum built with Zama FHE. Users deposit encrypted amounts into a shared pool while balances and winning weights remain private. UNVEIL freezes encrypted round snapshots, performs weighted BlindDraw over ciphertexts, verifies the final winner using Zama's public decryption proof flow, and delivers simulated strategy surplus as an encrypted prize to the winner automatically.

The V2 stack is deployed on Sepolia TEST/DEMO and has passed a live smoke test from confidential deposits through automatic prize delivery and withdrawal recovery. The React frontend uses the Zama Relayer SDK for client-side encryption and private user decryption.

### Key innovation

UNVEIL demonstrates a full privacy-preserving financial loop rather than a single encrypted variable: confidential principal, encrypted draw weights, snapshot-based selection, publicly proven winner finalization, simulated ERC-4626 strategy accounting, winner-specific ACLs, and automatic encrypted prize delivery all compose in one application.

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
- [x] V2 Sepolia TEST/DEMO deployment
- [x] V2 live end-to-end smoke test
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

Do not describe UNVEIL as anonymous or fully private. The current implementation intentionally leaves participant addresses, transaction timing, membership, round state, final winner, and prize-processing occurrence public.

Do not describe the deployed strategy as real market yield. It is a simulated ERC-4626 accounting route used for the competition testnet build and demonstrates the intended architecture.

Do not claim an independent professional security audit. Automated tests and CI are extensive, but the contracts have not received that review.
