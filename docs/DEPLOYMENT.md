# UNVEIL Sepolia deployment

This document describes the **current V4 submission deployment** used by the live frontend and hosted keeper.

Older V1, V2, and V3 deployment records remain in their explicitly versioned historical documents for development history only. They are not the addresses used by the live application.

## Live deployment

- Network: Ethereum Sepolia
- Chain ID: `11155111`
- Draw model: 24 shards × 24 seats = 576 active savers
- Prize slots: 3 per round
- Draw period: 900 seconds
- Savings maturity: one complete draw period
- Batch age: 120 seconds
- Buffer reserve: 2000 BPS
- Asset mode: demo cUSDC
- Strategy mode: simulated ERC-4626 appreciation

## Canonical addresses

| Component | Address |
| --- | --- |
| Demo underlying asset | `0x50c5b93aDc4c10a392b53125C545e760f12E9466` |
| Confidential principal wrapper | `0x9Ff6F110cb3162033A25A597D4528bABbEe2cA41` |
| Demo ERC-4626 vault | `0x2FcBa2fFc62010717272B3F2223F12730C4BF4b9` |
| Confidential strategy-share wrapper | `0xF0810ef8b962ac787df0fe5FEF492A75A054F55d` |
| Deposit batcher | `0x391cB3D0F60F443C3018bAC600C6EA90ee6497Fe` |
| Withdrawal batcher | `0xe88B1B97ceE0349954e664aF9f1168327588a390` |
| VeilPoolV4 | `0xCC7d4642557FfE810a77D2CEce0206211d15aE57` |
| Snapshot batcher | `0xA46DCDE4C37C107d9B9333cBE2b0F117597D228b` |
| Draw batcher | `0xb0Da69Bb79746b2f7f568D612F38B4fa77d6Ca04` |
| VeilPrizeVaultV3 | `0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C` |
| VeilStrategyManagerV3 | `0x2bA25db644515af6Bb731025e71EE493B9D5d4Db` |

These addresses are also pinned in the live frontend and keeper configuration. Do not substitute addresses from older versioned deployment records when evaluating the current submission.

## Deployment implementation

The V4 deployment script is:

```text
deploy/deploy-v4.ts
```

The repository exposes the corresponding Hardhat commands:

```bash
npm run deploy:v4:localhost
npm run deploy:v4:sepolia
```

A fresh network deployment requires the normal Hardhat signer/RPC configuration and sufficient native gas. The competition submission is already deployed; judges do not need to redeploy it to use the live app.

## Architecture deployed

The live route contains:

1. A demo ERC-20 underlying asset.
2. A confidential principal wrapper.
3. A demo ERC-4626 strategy vault.
4. A confidential strategy-share wrapper.
5. Confidential deposit and withdrawal batchers.
6. `VeilPoolV4` for principal, maturity, sharded saver state, snapshots, and draw integration.
7. A snapshot batcher for bounded encrypted snapshot progression.
8. A draw batcher for bounded proof/finalization progression.
9. `VeilStrategyManagerV3` for strategy routing, liability accounting, and safe prize funding.
10. `VeilPrizeVaultV3` for confidential automatic prize delivery.

The strategy appreciation used by the competition deployment is simulated. It is not production USDC yield or a claim of live market yield.

## Draw and keeper operation

The draw closes on a fixed onchain schedule. New savings become prize-eligible only after one complete draw period.

At close, mature encrypted weights are frozen across the 24 shards. Each of the three prize slots selects a weighted shard and then a weighted member inside that shard using encrypted weights and onchain FHE randomness.

The hosted keeper in `.github/workflows/keeper.yml` advances eligible protocol stages. The contracts remain permissionless for those transitions; the keeper does not choose the winner.

## Validation

The canonical V4 stack has live Sepolia smoke evidence covering confidential deposits, maturity, encrypted sharded snapshots, all-zero cancellation, positive weighted draws, three prize slots, automatic confidential prize delivery, principal withdrawal, and prize-share redemption.

See:

- [`UNVEIL_V4_LIVE_RESULT.md`](UNVEIL_V4_LIVE_RESULT.md)
- [`SUBMISSION.md`](SUBMISSION.md)
- [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)

## Historical records

The following files are retained as versioned historical evidence and must not be treated as the active deployment:

- `UNVEIL_V2_LIVE_RESULT.md`
- `UNVEIL_V3_LIVE_RESULT.md`
- `SEPOLIA_SMOKE_RESULT.md`

The source of truth for the current submission is the canonical V4 address table above, the root [`README.md`](../README.md), and the addresses configured in the live frontend and keeper.
