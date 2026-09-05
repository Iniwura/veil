# UNVEIL

## Save privately. Win verifiably.

UNVEIL is a private prize-savings protocol built on Zama fhEVM.

Users save demo cUSDC into a confidential position. Savings balances, mature draw weight, withdrawal amounts, and prize amounts remain encrypted. Draw timing, selected shards, winners, and settlement evidence remain publicly verifiable.

**Live app:** https://veil-green.vercel.app

**Network:** Ethereum Sepolia (`11155111`)

> UNVEIL is a testnet/demo build. The cUSDC shown in the UI is a demo asset label backed by test contracts, and the ERC-4626 strategy yield is simulated. This is not production financial software or a claim of real market yield.

---

## Why UNVEIL

Prize savings normally force a tradeoff: either balances and odds are public, or the draw becomes difficult to verify.

UNVEIL separates those concerns.

- **Private financial state:** savings amount, mature draw weight, withdrawal amount, and prize amount stay encrypted.
- **Public protocol state:** round timing, shard membership, selected shards, winners, and settlement evidence remain observable.
- **Automatic prize delivery:** winners receive confidential strategy-share prizes without a separate claim transaction.
- **Permissionless progression:** draw lifecycle stages can be advanced after their protocol conditions are met.

UNVEIL does **not** claim wallet anonymity or full metadata privacy. Wallet addresses, transaction timing, public roster/shard state, and final winners remain public where the protocol requires them.

---

## How it works

### 1. Save privately

The browser encrypts a cUSDC deposit with the Zama Relayer SDK before submitting it. The pool records confidential principal and encrypted draw weight.

### 2. Mature into prize weight

New savings mature after one complete draw period before contributing prize weight.

### 3. Snapshot encrypted weight

At round close, the protocol checkpoints mature encrypted saver weights by shard without publishing the underlying amounts.

### 4. Draw and verify

UNVEIL uses a sharded encrypted draw model with **24 shards × 24 seats**, supporting up to **576 active savers**. Each round has **3 independent prize slots**.

Each prize slot resolves through the public settlement flow while saver weights remain encrypted.

### 5. Deliver privately

Finalized winners receive confidential strategy-share prizes automatically. Prize values remain sealed until the winner authorizes a local reveal in the frontend.

### 6. Withdraw or redeem

Saved principal and prize shares follow separate confidential withdrawal paths. Prize shares are not presented as cUSDC and UNVEIL does not assume a 1:1 redemption rate.

---

## Final Sepolia deployment

These are the addresses used by the live frontend on Sepolia.

| Component | Address |
| --- | --- |
| Demo underlying asset | `0x50c5b93aDc4c10a392b53125C545e760f12E9466` |
| Confidential principal wrapper | `0x9Ff6F110cb3162033A25A597D4528bABbEe2cA41` |
| Demo ERC-4626 vault | `0x2FcBa2fFc62010717272B3F2223F12730C4BF4b9` |
| Confidential strategy-share wrapper | `0xF0810ef8b962ac787df0fe5FEF492A75A054F55d` |
| Deposit batcher | `0x391cB3D0F60F443C3018bAC600C6EA90ee6497Fe` |
| Withdrawal batcher | `0xe88B1B97ceE0349954e664aF9f1168327588a390` |
| VeilPoolV4 | `0xCC7d4642557FfE810a77D2CEce0206211d15aE57` |
| VeilPrizeVaultV3 | `0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C` |
| VeilStrategyManagerV3 | `0x2bA25db644515af6Bb731025e71EE493B9D5d4Db` |

Live runtime parameters:

- Draw period: **900 seconds**
- Batch age: **120 seconds**
- Buffer reserve: **2000 BPS**
- Shards: **24**
- Seats per shard: **24**
- Maximum active savers: **576**
- Prize slots per round: **3**
- Savings maturity: **1 complete draw period**

---

## Privacy model

### Private

- Available demo cUSDC balance shown by the app after authorization
- Saved principal
- Pending withdrawal amount
- Mature draw weight
- Prize amount
- Strategy-share amount

### Public

- Wallet addresses and transactions
- Round timing and lifecycle state
- Seat/shard membership where exposed by protocol state
- Selected shards
- Final winners
- Settlement and verification evidence

Decrypted private values are kept in session-local frontend state and are cleared when the user veils them, disconnects, changes account, or changes network.

---

## Prize flow

UNVEIL routes savings through a demo ERC-4626 strategy. Simulated strategy appreciation funds prize delivery while principal accounting and prize-share accounting remain distinct.

A finalized winner receives confidential strategy shares automatically. There is no separate prize-claim transaction.

The Prize Vault lets the connected winner reveal each delivered prize independently. Revealing one prize does not reveal other prize slots.

---

## Frontend

The production frontend is a React + Vite application in [`frontend/`](frontend/).

Key UX features:

- MetaMask connection and Sepolia switching
- Wallet-scoped private balance reveal
- Sealed-by-default private position dashboard
- Save and confidential withdrawal flows
- Historical encrypted draw-weight inspection
- Public draw lifecycle and verified history
- Prize Vault with independent private prize reveals
- Restored 11-step guided product tour
- Responsive desktop and mobile layouts

Run locally:

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
npm run build
```

---

## Protocol development

Requirements:

- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Compile contracts:

```bash
npm run compile
```

Run the full test suite:

```bash
npm test
```

The final audited branch passed **304 tests** before release.

---

## V4 draw architecture

The current protocol uses a sharded encrypted draw to avoid a single unbounded roster.

```text
Wallet + Zama Relayer SDK
          |
          v
 encrypted deposit / withdrawal
          |
          v
      VeilPoolV4
  - confidential principal
  - encrypted mature weight
  - 24 sharded saver rosters
          |
          v
   sharded snapshots
          |
          v
  encrypted prize draws
          |
          v
 public winner finalization
          |
          v
 VeilStrategyManagerV3
          |
          v
 VeilPrizeVaultV3
  - confidential strategy shares
  - automatic delivery
  - winner-only reveal
```

The live V4 smoke flow validated skipped/cancelled rounds, all-zero behavior without fabricated winners, and a later round in which all three prize slots finalized to eligible savers.

---

## Transaction safety

The frontend keeps submitted wallet writes in a submitted/pending state instead of treating a local timeout as cancellation. This prevents the UI from encouraging unsafe duplicate retries while a wallet transaction may still be pending.

Errors remain scoped to their originating flow: save, withdrawal, private reveal, historical weight inspection, prize reveal, and prize redemption.

---

## Repository layout

```text
contracts/
  VeilPoolV4.sol
  VeilPrizeVaultV3.sol
  draw/
  strategy/

deploy/
  deploy-v4.ts

frontend/
  src/components/
  src/pages/
  src/hooks/

scripts/
  sepolia-v4-smoke.ts
  v4-keeper.ts

test/
  protocol, frontend-presentation, draw, privacy, and transaction-safety tests

shared/
  cross-layer lifecycle and presentation helpers

docs/
  deployment, architecture, smoke, demo, and hosting documentation
```

---

## Built with

- Zama fhEVM / FHEVM
- `@fhevm/solidity`
- `@fhevm/hardhat-plugin`
- Zama Relayer SDK
- Solidity
- Hardhat
- TypeScript
- React
- Vite
- ethers v6
- Vercel

---

## Security and limitations

UNVEIL is a Sepolia competition/demo build, not production financial software.

Known limitations:

- Demo asset contracts are not production stablecoins.
- Strategy appreciation is simulated rather than sourced from a live production market.
- Wallet identities and transaction metadata remain public.
- The contracts have extensive automated and live testnet validation but have not received an independent professional security audit.
- Real-value deployment would require additional security, economic, and operational review.

---

## Links

- **Live app:** https://veil-green.vercel.app
- **GitHub:** https://github.com/Iniwura/veil
- **Network:** Ethereum Sepolia

UNVEIL: **Save privately. Win verifiably.**
