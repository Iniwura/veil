# UNVEIL production yield path

UNVEIL separates the competition-safe Sepolia prize flow from the production yield integration. That boundary is intentional. The privacy and draw protocol can be tested end to end without pretending that deterministic testnet yield was produced by a live lending strategy.

## Sepolia competition deployment

The competition stack uses Zama's official Sepolia `cUSDCMock` wrapper as the confidential pool and prize asset.

- `cUSDCMock`: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- mock USDC underlying: `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`

The strategy operator transfers actual confidential cUSDC into `VeilYieldSource` and seals the current round's encrypted realized-yield bucket after the draw closes. Routing and prize delivery are then permissionless.

The strategy operator cannot choose the winner. A keeper cannot redirect a sealed bucket to another round or another beneficiary.

This proves the complete confidential accounting and prize-delivery path. It does **not** claim that the deterministic Sepolia yield was produced by Morpho or another live lending venue.

## Verified production venue

Zama's Steakhouse Confidential Prime USDC vault is live on Ethereum mainnet and routes confidential cUSDC into the Steakhouse USDC Prime strategy on Morpho.

The current Zama protocol registry lists:

- cUSDC: `0xe978F22157048E5DB8E5d07971376e86671672B2`
- csteakcUSDC: `0x66Bf74E96900D1a19c7070D939D124f2F565C458`
- underlying Steakhouse USDC Prime vault: `0xbEEF00A59B577423653A1526c7009bdE103F542B`

The official Sepolia wrapper registry currently lists the test cUSDC wrapper used by UNVEIL, but it does not list a Steakhouse confidential share wrapper. For that reason, UNVEIL does not present a third-party Sepolia recipe or address set as official production infrastructure.

Mainnet addresses must be checked against Zama's protocol registry immediately before any production deployment.

## Production strategy architecture

The Steakhouse confidential vault is asynchronous. Deposits and redemptions are batched, so a production UNVEIL adapter cannot treat it like a synchronous ERC-4626 call.

```text
UNVEIL principal accounting
        |
        | strategy allocation policy
        v
confidential strategy adapter
        |
        | encrypted cUSDC deposit
        v
Zama confidential vault batching
        |
        | finalized batch + claim
        v
confidential Steakhouse shares
        |
        | share-price appreciation
        v
realized confidential yield
        |
        | redeem batch + cUSDC return
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

A production adapter therefore needs explicit pending-deposit, active-share, pending-redemption and idle-liquidity accounting. Yield must not be considered realized until confidential cUSDC has returned from the redemption path and entered UNVEIL's prize-yield custody.

## Required production invariants

1. User principal remains separately accounted from prize yield.
2. Only realized cUSDC above the protected principal and liability floor can enter a prize bucket.
3. Encrypted strategy allocation cannot give a keeper access to plaintext balances.
4. A keeper cannot choose the destination round for a sealed yield bucket.
5. A keeper cannot choose or redirect the winner.
6. Strategy or batch failure cannot mutate historical draw snapshots.
7. Pending batch latency is represented explicitly in protocol and UI state.
8. Withdrawals use either an idle-liquidity buffer or a visible private redemption queue.
9. Emergency exits return strategy assets to a custody path without exposing per-user balances.
10. Share-price math and encrypted aggregate arithmetic need explicit overflow and precision bounds before production use.

## Why the competition stack does not automatically invest principal

Moving the Sepolia pool's user principal into an asynchronous vault without private pending-deposit shares, delayed-redemption accounting, withdrawal liquidity and failure recovery would make the demo look more production-like while making custody less correct.

UNVEIL therefore keeps the competition custody path simple and proves the confidential strategy boundary separately. A production migration should introduce the asynchronous strategy adapter as a reviewed protocol version rather than silently changing withdrawal semantics inside the submission build.

## Cadence

UNVEIL targets daily production prize draws. The competition deployment uses a shorter contract-configured period so a reviewer can watch a full encrypted round.

Draw cadence and yield-settlement cadence do not need to be identical. A draw can finalize before its prize is ready. The UI should show `winner proved · yield settling` until the strategy seals the realized confidential cUSDC bucket and a permissionless keeper routes it.

## Source references

- Zama Protocol Apps Sepolia address registry for official confidential wrapper addresses.
- Zama Protocol Registry for current mainnet contract addresses.
- Zama's Steakhouse Confidential Prime USDC launch documentation.
- Zama Protocol Apps confidential wrapper source for the ERC-7984 wrapping interface.
