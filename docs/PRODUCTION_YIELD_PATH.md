# UNVEIL production yield path

UNVEIL separates the competition-safe Sepolia prize flow from the production strategy integration. That boundary is intentional: the privacy and draw protocol can be tested deterministically without pretending a manually supplied testnet yield bucket is production DeFi yield.

## Sepolia competition deployment

The competition stack uses Zama's official Sepolia `cUSDCMock` wrapper as the confidential pool and prize asset.

- `cUSDCMock`: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- mock USDC underlying: `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`

The strategy operator can transfer actual confidential cUSDC units into `VeilYieldSource`, seal the current round's encrypted realized-yield bucket after the draw closes, and leave routing/delivery permissionless. The strategy operator cannot choose the winner and a keeper cannot redirect the sealed bucket to another round.

This proves the complete confidential accounting and prize-delivery path. It does **not** claim that the deterministic competition yield was produced by a live lending strategy.

## Verified confidential Steakhouse / Morpho path

A public integration reference for Zama's Steakhouse Confidential Prime USDC vault exposes the actual batching flow and addresses on both Sepolia and Ethereum mainnet. The reference states that it was ported from Zama's vault integration POC and uses the same ERC-7984 transfer-and-call interface implemented in Zama's protocol-apps repository.

### Sepolia

- USDC mock: `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`
- cUSDC: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- confidential Steakhouse share token: `0x7E93d5c150A2178B1fCde0278582Acf59478eA5f`
- underlying Morpho vault: `0x6AB54988261AEC573a2CA13cF802d3B1114f864C`
- confidential deposit batcher: `0x56E3CF41D18e58AF476C05e9B1705ac2b13862C9`
- confidential redeem batcher: `0xe35C25a0F49c6cDC0771C459F1b0548D1E741774`

### Ethereum mainnet

- USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- cUSDC: `0xe978F22157048E5DB8E5d07971376e86671672B2`
- csteakcUSDC: `0x66Bf74E96900D1a19c7070D939D124f2F565C458`
- underlying Steakhouse vault: `0xbEEF00A59B577423653A1526c7009bdE103F542B`
- confidential deposit batcher: `0x324EA89FD3784036673BfE6Ffee2334A088F40Cc`
- confidential redeem batcher: `0x96Cd3Faa7483783Ac2Eb715f6333361500F1eec9`

Mainnet wrapper addresses should still be checked against Zama's protocol registry immediately before a production deployment.

## Verified batching interface

The confidential wrapper exposes both external-input and ciphertext-native transfer-and-call overloads. The user-facing vault flow is:

```text
cUSDC
  |
  | confidentialTransferAndCall(depositBatcher, encryptedAmount, proof, 0x)
  v
DEPOSIT BATCH
  |
  | batch finalizes
  v
claim(batchId, account)
  |
  v
csteakcUSDC confidential shares
```

The reverse path sends encrypted csteakcUSDC shares to the redeem batcher and claims cUSDC after that batch finalizes.

The batcher interface used by the public reference exposes:

- `currentBatchId()`
- `batchState(batchId)` where `0 = Open`, `1 = Dispatched`, `2 = Finalized`
- `deposits(batchId, account)` for the account's encrypted batch position
- `claim(batchId, account)` after finalization

The underlying ERC-4626 Steakhouse vault exposes public share pricing through `convertToAssets`, while the wrapper keeps each holder's share balance confidential.

## Production UNVEIL strategy architecture

The target adapter must treat the confidential vault as an asynchronous strategy, not as a synchronous ERC-4626 deposit.

```text
UNVEIL principal accounting
        |
        | strategy allocation policy
        v
confidential strategy adapter
        |
        | encrypted cUSDC transfer-and-call
        v
Zama deposit batcher
        |
        | finalized batch + claim
        v
confidential Steakhouse shares
        |
        | share-price appreciation
        v
realized confidential yield
        |
        | redeem batch + claim cUSDC
        v
VeilYieldSource
        |
        | sealed sequential round bucket
        v
VeilPrizeVault
        |
        v
proof-finalized winner
```

The important consequence is latency: deposits and redemptions are batched. A production adapter needs explicit pending-deposit, active-share, pending-redemption and idle-liquidity accounting. It must never advertise yield as realized until cUSDC has actually returned from the redeem batch and entered the prize-yield custody path.

## Required production invariants

A live strategy adapter must preserve all of these properties:

1. User principal remains separately accounted from prize yield.
2. Only realized cUSDC above the protected principal/liability floor can enter a prize bucket.
3. Encrypted strategy allocation cannot give a keeper access to plaintext balances.
4. A keeper cannot choose the destination round for a sealed yield bucket.
5. A keeper cannot choose or redirect the winner.
6. Strategy or batch failure cannot mutate historical draw snapshots.
7. Pending batch latency is represented explicitly in protocol and UI state.
8. Withdrawals either use an explicit idle-liquidity buffer or enter a visible private redemption queue; the app must not pretend asynchronous vault liquidity is instant.
9. Emergency exits return strategy assets to a custody path without exposing per-user balances.
10. Share-price math and encrypted aggregate arithmetic require explicit overflow/precision bounds before production use.

## Why the competition stack does not automatically invest principal

The live confidential Steakhouse system is asynchronous. Moving the competition pool's user principal directly into its batchers without also implementing private pending-deposit shares, withdrawal liquidity, delayed redemption and failure recovery would make the demo look more production-like while actually making custody less correct.

UNVEIL therefore keeps the tested Sepolia competition custody path simple and proves the real vault interface separately. A production migration should introduce the strategy adapter and its liquidity state machine as an audited protocol version rather than silently changing withdrawal semantics inside the submission build.

## Cadence

UNVEIL targets daily production prize draws. The competition deployment uses a shorter contract-configured period so a reviewer can watch a full encrypted round.

Because the Steakhouse strategy batches deposits/redemptions, draw cadence and yield-settlement cadence do not have to be identical. A draw can finalize before its prize is ready; the UI should show `winner proved · yield settling` until the strategy's realized confidential cUSDC bucket is sealed and routed.

## Source references

- Zama protocol-apps ERC-7984 wrapper source and Sepolia address documentation.
- Zama protocol registry for current mainnet confidential wrapper addresses.
- Zama's Steakhouse Confidential Prime USDC launch documentation.
- `openfort-xyz/recipes-hub/zama-confidential-yield`, whose minimal ABI/address set is documented as ported from the Zama vault integration POC.
