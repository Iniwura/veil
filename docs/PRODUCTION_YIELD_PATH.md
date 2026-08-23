# UNVEIL production yield path

UNVEIL's Sepolia deployment and its production yield target are intentionally different.

## Sepolia competition deployment

Sepolia uses Zama's official confidential USDC mock wrapper (`cUSDCMock`) as the prize-pool asset. Real confidential
token units are transferred into `VeilYieldSource`, but the yield itself is supplied by a controlled strategy adapter
for deterministic end-to-end testing.

That means the demo proves:

- confidential asset custody;
- encrypted pool accounting;
- weighted FHE draw selection;
- confidential realized-yield accounting;
- deterministic round-to-yield routing;
- winner-only private prize values;
- permissionless prize delivery.

It does **not** claim that the Sepolia asset is earning production DeFi yield.

## Current Zama mainnet target

Zama now operates a live confidential USDC yield product on Ethereum with Morpho and Steakhouse Financial. Public Zama
sources describe a batched confidential vault that accepts cUSDC and processes deposits into the underlying strategy
every 24 hours.

Current public Ethereum mainnet registry entries include:

- `cUSDC`: `0xe978F22157048E5DB8E5d07971376e86671672B2`
- `csteakcUSDC`: `0x66Bf74E96900D1a19c7070D939D124f2F565C458`
- underlying Steakhouse vault: `0xbEEF00A59B577423653A1526c7009bdE103F542B`

These addresses must be re-verified against Zama's protocol registry before any production deployment.

## Adapter architecture

The production integration should preserve the same trust boundary as the Sepolia build:

```text
UNVEIL pool principal
        |
        | confidential strategy allocation
        v
reviewed confidential yield adapter
        |
        | confidential vault shares / redemption
        v
Zama confidential yield venue
        |
        | realized confidential cUSDC yield
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

The exact production adapter must be written against the reviewed live vault ABI and batching/redemption lifecycle.
UNVEIL should not guess that interface from the wrapper symbol or hard-code an unverified deposit/redeem API.

## Production invariants

A production strategy adapter should preserve all of these properties:

1. User principal remains separately accounted from prizes.
2. Only realized yield can enter the prize bucket.
3. Yield remains confidential throughout strategy accounting and prize routing.
4. A keeper cannot choose the destination round for a sealed bucket.
5. A keeper cannot choose or redirect the winner.
6. Strategy failure cannot trap or mutate historical draw snapshots.
7. Batched vault latency is reflected in prize timing rather than hidden from users.
8. Emergency strategy exits must return principal to a custody path without exposing per-user balances.

## Cadence

UNVEIL's target product cadence is daily prize draws, matching the recurring prize-savings experience users expect. The
Sepolia competition deployment uses a shorter contract-configured period so a reviewer can observe a full encrypted
round without waiting a day.

A mainnet adapter around a 24-hour-batched yield venue must coordinate draw/yield settlement so a round is never
advertised as funded before its realized confidential yield has actually been sealed.
