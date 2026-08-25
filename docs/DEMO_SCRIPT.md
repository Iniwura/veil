# UNVEIL three-minute demo script

This script is for a real-person recording of the existing testnet evidence. It does not require creating a new round.
Use the already-finalized Round 1 replay wherever possible and distinguish live Sepolia state from explanatory visuals.

## Timeline

### 0:00–0:20 — Problem and pitch

Show the landing hero.

Say: “Prize savings should reward saving without publishing every balance and weight. UNVEIL keeps those values
encrypted, then proves the winner publicly. Save privately. Win verifiably.”

### 0:20–0:45 — Privacy model

Show the privacy comparison and the live draw overview.

Say: “The browser encrypts deposits and withdrawals with Zama FHE. Balances, snapshot weights, and prize values stay
encrypted. Wallet addresses, timing, round state, and the finalized winner remain public metadata.”

### 0:45–1:20 — Save privately

Show Save privately and, if a safe funded Sepolia demo wallet is available, perform one small demo deposit. Show the
encrypted request lifecycle, not any secret material.

Say: “This is a live Sepolia TEST/DEMO interaction. The input is encrypted before the wallet submits it. The active
position is not a public plaintext balance.”

If a wallet is unavailable, use the existing product replay and state that the interaction is being shown from the
deployed route; do not fabricate a transaction.

### 1:20–1:50 — BlindDraw and public verification

Show the live draw page, fixed countdown, encrypted participant field, and verified Round 1 history replay. Open the
pool and winner links in Etherscan.

Say: “The draw window is fixed by the onchain schedule. Anyone can advance it after close. BlindDraw operates over
encrypted weights. Zama/KMS proves the selected encrypted winner handle, so the winner is verifiable without exposing
the weights.”

Do not start a new live round during the recording.

### 1:50–2:15 — My Vault reveal

Show My Vault sealed first. If a safe demo wallet is available, trigger the wallet-authorized reveal and show the
transition from sealed to revealed.

Say: “The private view is sealed by default. Only this wallet can authorize the decryption of its own private values.
Veiling removes plaintext from the local presentation; it does not change ciphertext ACLs or chain state.”

Never show seed phrases, private keys, raw signatures, or unrelated accounts.

### 2:15–2:35 — Confidential automatic prize

Show the Prizes delivered page and the finalized Round 1 result.

Say: “The verified winner received confidential strategy shares automatically through VeilPrizeVaultV2. The winner does
not submit a separate claim transaction. The amount remains winner-readable ciphertext.”

### 2:35–2:50 — Yield architecture

Show the architecture explanation and the deployment page.

Say: “The Sepolia strategy is a simulated ERC-4626 TEST/DEMO vault used to exercise the route, accounting, and KMS
callback. It is not Steakhouse, Morpho, real USDC, or a market-yield claim.”

### 2:50–3:00 — Live contracts and close

Show the V2 address table and repository architecture.

Say: “UNVEIL makes private values compatible with a public protocol lifecycle: encrypted balances, blind selection,
verified winners, and confidential automatic delivery. The live evidence and exact contracts are linked in the
repository.”

## Required shot list

- Landing hero.
- Privacy comparison.
- Live draw page and fixed countdown.
- Verified Round 1 replay.
- My Vault sealed state.
- Wallet-authorized reveal with a safe demo wallet, if available.
- Prizes delivered page.
- History page.
- Etherscan pool and winner evidence.
- Architecture diagram or repository tree.
- Final CTA.

## Recording boundaries

- Use the existing finalized Round 1 evidence; do not require a new live draw.
- Label live Sepolia protocol evidence, simulated ERC-4626 strategy behavior, and explanatory visual replay separately.
- Never use smoke private keys or mnemonics.
- Do not present the test/demo asset as real USDC or the strategy as real yield.
- Do not describe the system as anonymous, risk-free, guaranteed, or independently professionally audited.
