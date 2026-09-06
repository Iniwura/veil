# UNVEIL — Final V4 submission kit

## One-line pitch

UNVEIL is a private prize-savings protocol on Ethereum Sepolia that uses Zama FHE to keep savings balances, draw weights, withdrawal amounts, and prize values encrypted while still producing publicly verifiable draw results.

## Live submission

- Live app: https://veil-green.vercel.app
- GitHub: https://github.com/Iniwura/veil
- Network: Ethereum Sepolia (`11155111`)
- Protocol: V4 sharded draw
- Draw capacity: 24 shards × 24 seats = 576 active savers
- Prize slots: 3 per round
- Savings maturity: one complete draw period
- Draw period: 900 seconds

UNVEIL is a testnet/demo build. The UI label `cUSDC` refers to the deployed demo asset route, and the ERC-4626 strategy appreciation used for prizes is simulated rather than live market yield.

## Why FHE is necessary

A weighted prize-savings protocol normally exposes the balances that determine each user's odds. UNVEIL instead keeps the financial values encrypted while the protocol still performs the state transitions needed to run the savings and draw lifecycle.

FHE is used for confidential principal, mature draw weight, snapshot accounting, weighted selection, withdrawal accounting, and prize values. The draw uses onchain FHE randomness and encrypted cumulative weights rather than an offchain random-number source or plaintext saver balances.

## Final V4 architecture

1. The wallet connects on Sepolia and obtains demo cUSDC through the in-app first-save faucet flow.
2. The browser encrypts the save amount with the Zama Relayer SDK before transaction submission.
3. `VeilPoolV4` records confidential principal and the encrypted maturity boundary used for draw eligibility.
4. After one complete draw period, mature savings contribute encrypted prize weight.
5. At close, the protocol freezes encrypted weights across 24 bounded shards.
6. Each of the 3 prize slots first selects a shard by encrypted weight and then selects a member inside that shard by encrypted weight.
7. The selected shard and winner are finalized through Zama's public decryption-proof flow while the underlying weights remain encrypted.
8. `VeilStrategyManagerV3` calculates safe simulated strategy surplus and `VeilPrizeVaultV3` delivers confidential strategy-share prizes automatically.
9. Winners can authorize local prize reveal through the frontend. Principal withdrawals and prize-share redemption remain separate flows.

The hosted GitHub Actions keeper advances eligible protocol stages. It does not choose winners and has no special authority over the draw result.

## What judges should verify

- `contracts/VeilPoolV4.sol` for confidential principal, maturity, sharded seat state, snapshot progression, and draw integration.
- `contracts/draw/VeilShardedSnapshot.sol` for bounded encrypted snapshot processing.
- `contracts/draw/VeilShardedDraw.sol` for the two-stage encrypted weighted selection and `FHE.randEuint64()` randomness.
- `contracts/strategy/VeilStrategyManagerV3.sol` for confidential strategy routing and prize funding.
- `contracts/VeilPrizeVaultV3.sol` for confidential automatic prize delivery.
- `frontend/src/veilClient.ts`, `frontend/src/v4DrawClient.ts`, and the React pages/hooks for Zama Relayer SDK encryption and wallet-authorized reveal flows.
- `.github/workflows/keeper.yml` and `scripts/v4-keeper.ts` for hosted permissionless progression.
- `test/` for protocol, privacy, draw-capacity, transaction-safety, keeper, and frontend-presentation coverage.

## Final Sepolia addresses

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

## Privacy boundary

### Private

- Available demo cUSDC after wallet authorization
- Saved principal
- Pending withdrawal amount
- Mature draw weight
- Prize amount
- Strategy-share amount

### Public

- Wallet addresses and transactions
- Transaction timing
- Round timing and lifecycle state
- Seat/shard membership where exposed by protocol state
- Selected shards
- Final winner addresses
- Settlement and verification evidence

UNVEIL does not claim wallet anonymity or full metadata privacy. The privacy target is financial state and weighted selection inputs, not all protocol metadata.

## Prize semantics

Prizes are delivered automatically after winner finalization and safe-surplus processing. There is no separate winner claim transaction.

The frontend lets the connected winner reveal each delivered prize independently through wallet-authorized decryption. Prize shares are distinct from cUSDC principal and are redeemed through their own confidential route.

## No-loss principal model

Draw maturity controls when savings contribute prize weight. It does not lock principal for the draw. Saved principal remains separately accounted for and withdrawable through the confidential withdrawal lifecycle.

The competition build uses a simulated ERC-4626 strategy. Real-value deployment would require additional economic, security, and strategy-risk review.

## Demo guidance

The live product tour and UI are the canonical demo flow. A judge can connect a Sepolia wallet, use the in-app first-save faucet, make a small confidential save, authorize the private position reveal, inspect the draw lifecycle and verified history, and exercise withdrawal or prize redemption where applicable.

The recorded demo should keep the product explanation under the challenge time limit and clearly distinguish encrypted financial state from intentionally public winner and settlement evidence.

## Validation

The release line has extensive automated protocol and frontend coverage, including 576-seat sharded-draw runtime tests, maturity boundaries, all-zero cancellation, weighted selection, confidential prize delivery, transaction safety, keeper progression, and private frontend presentation.

The repository also preserves live Sepolia smoke evidence and the hosted keeper used by the live deployment.

## Claims to avoid

Do not describe UNVEIL as anonymous, fully private, independently professionally audited, or backed by real production USDC/yield.

Do not describe prize shares as 1:1 cUSDC. The strategy-share route is deliberately distinct from principal accounting.

## Final submission checklist

- [x] Public GitHub repository
- [x] Live Vercel deployment
- [x] Ethereum Sepolia deployment
- [x] Client-side encrypted save flow
- [x] Wallet-authorized private balance reveal
- [x] Encrypted weighted draw
- [x] Onchain FHE randomness
- [x] 24 × 24 sharded capacity
- [x] 3 independent prize slots
- [x] Confidential automatic prize delivery
- [x] Confidential principal withdrawal
- [x] Hosted keeper automation
- [x] In-app demo cUSDC faucet guidance
- [x] Privacy leakage documented
- [x] Simulated yield clearly disclosed
- [x] Final V4 addresses documented
