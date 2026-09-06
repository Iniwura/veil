# UNVEIL three-minute demo script

This is the final V4 demo outline for the live Sepolia deployment.

## 0:00–0:20 — Product thesis

Show the landing page.

Say:

“UNVEIL is private prize savings built with Zama FHE. You save privately, your draw weight stays encrypted, and the
final winner remains publicly verifiable.”

## 0:20–0:50 — Connect and first save

Connect a safe Sepolia wallet and open **Save**.

For a fresh demo wallet, show the in-app **FIRST SAVE** faucet guidance and obtain demo cUSDC. Open **Save More**, enter
a small amount, and show the wallet transaction.

Say:

“The browser encrypts the amount before it is submitted. The protocol records confidential principal and encrypted prize
weight instead of publishing a plaintext savings balance.”

Do not show seed phrases, private keys, raw signatures, or unrelated wallets.

## 0:50–1:20 — Private position reveal

Show the private position sealed first, then use **Unveil** to authorize the connected wallet’s private values.

Say:

“UNVEIL keeps the private position sealed by default. The wallet authorizes decryption for its own balances, including
available demo cUSDC, saved principal, pending withdrawal, and prize state. Revealed plaintext stays local to the
session.”

Veil the values again if useful to demonstrate the privacy boundary.

## 1:20–2:00 — Draw and fairness

Open **Draw**. Show the current round, the 24-sector draw presentation, settlement progress, and verified history.

Say:

“New savings mature for one complete draw period before contributing prize weight. At close, encrypted weights are
frozen across 24 shards of 24 seats. Each of the three prize slots first selects a shard by encrypted weight, then a
member inside that shard. The selection uses Zama FHE randomness onchain, so the keeper advances the protocol but does
not choose the winner.”

Show a verified finalized result.

Say:

“The selected shard and final winner are publicly proven, while saver balances, exact weights, exact odds, and prize
amounts remain encrypted.”

## 2:00–2:30 — Prize Vault

Show the real Prize Vault.

Say:

“Prizes are delivered automatically as confidential strategy-share units after a winner is finalized. There is no
separate prize-claim transaction. The connected winner can reveal each delivered prize independently, then redeem prize
shares through the confidential redemption route.”

If the connected wallet has a positive delivered prize, reveal one slot and keep the others sealed.

## 2:30–2:50 — Withdraw principal

Return to **Save** and show the withdrawal action.

Say:

“Draw maturity only controls prize eligibility. It does not lock principal. Saved principal remains separately accounted
for and can be withdrawn through the confidential withdrawal lifecycle.”

## 2:50–3:00 — Close

Show the live app and repository links.

Say:

“UNVEIL keeps financial state private while preserving a verifiable public savings and draw lifecycle. Save privately.
Win verifiably.”

## What must be visible in the recording

- Live UNVEIL landing page
- Sepolia wallet connection
- FIRST SAVE demo cUSDC faucet guidance
- Save More amount entry
- Private position sealed and unveiled states
- Current draw page
- Verified draw result/history
- Prize Vault
- Principal withdrawal action
- Clear disclosure that cUSDC and ERC-4626 strategy yield are testnet/demo assets

## Privacy and claim boundaries

Do not describe UNVEIL as anonymous or fully private. Wallet addresses, transactions, timing, round lifecycle,
shard/seat metadata where exposed, selected shards, and final winner addresses are public.

Do not describe the deployed strategy as real market yield. The Sepolia ERC-4626 strategy appreciation is simulated for
the competition build.

Do not say a winner submits a separate prize claim transaction. The V4 flow automatically delivers confidential prize
shares after settlement.

Do not describe prize shares as 1:1 cUSDC principal.

## Final live deployment

- VeilPoolV4: `0xCC7d4642557FfE810a77D2CEce0206211d15aE57`
- Snapshot batcher: `0xA46DCDE4C37C107d9B9333cBE2b0F117597D228b`
- Draw batcher: `0xb0Da69Bb79746b2f7f568D612F38B4fa77d6Ca04`
- VeilPrizeVaultV3: `0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C`
- VeilStrategyManagerV3: `0x2bA25db644515af6Bb731025e71EE493B9D5d4Db`

Live app: https://veil-green.vercel.app
