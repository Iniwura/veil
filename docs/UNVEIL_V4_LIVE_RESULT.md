# UNVEIL V4 Sepolia live result

Status: final V4 deployment is live on Ethereum Sepolia and used by the production frontend and hosted keeper.

Network: Sepolia  
Chain ID: 11155111  
Asset mode: TESTNET / DEMO cUSDC  
Strategy mode: simulated ERC-4626 yield  
Draw model: 24 shards × 24 seats = 576 active savers  
Prize slots: 3  
Savings maturity: one complete draw period  
Draw period: 900 seconds  
Batch age: 120 seconds  
Buffer reserve: 2000 BPS

## Canonical final deployment

| Component                           | Address                                      |
| ----------------------------------- | -------------------------------------------- |
| Demo underlying asset               | `0x50c5b93aDc4c10a392b53125C545e760f12E9466` |
| Confidential principal wrapper      | `0x9Ff6F110cb3162033A25A597D4528bABbEe2cA41` |
| Demo ERC-4626 vault                 | `0x2FcBa2fFc62010717272B3F2223F12730C4BF4b9` |
| Confidential strategy-share wrapper | `0xF0810ef8b962ac787df0fe5FEF492A75A054F55d` |
| Deposit batcher                     | `0x391cB3D0F60F443C3018bAC600C6EA90ee6497Fe` |
| Withdrawal batcher                  | `0xe88B1B97ceE0349954e664aF9f1168327588a390` |
| VeilPoolV4                          | `0xCC7d4642557FfE810a77D2CEce0206211d15aE57` |
| Snapshot batcher                    | `0xA46DCDE4C37C107d9B9333cBE2b0F117597D228b` |
| Draw batcher                        | `0xb0Da69Bb79746b2f7f568D612F38B4fa77d6Ca04` |
| VeilPrizeVaultV3                    | `0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C` |
| VeilStrategyManagerV3               | `0x2bA25db644515af6Bb731025e71EE493B9D5d4Db` |

These addresses supersede earlier V4 deployment attempts and are the only V4 addresses that should be used for judging
the current live application.

## Final architecture validated on Sepolia

The production V4 route combines:

- confidential demo cUSDC principal;
- one-full-round maturity before new savings contribute prize weight;
- 24 bounded encrypted saver shards with 24 seats each;
- encrypted close-time snapshots;
- three independent two-stage weighted prize selections;
- onchain FHE randomness;
- public proof verification for selected shards and final winners;
- simulated ERC-4626 strategy appreciation;
- confidential automatic prize delivery;
- confidential principal withdrawal and prize-share redemption;
- a permissionless hosted keeper that advances eligible stages without choosing winners.

## Live validation

The final release path has been exercised with live Sepolia interactions and the local/full protocol regression suite.

Validated behavior includes:

- confidential deposits and wallet-scoped private reveals;
- savings maturity across draw boundaries;
- post-close deposits not changing a closed round;
- all-zero encrypted rounds cancelling without fabricated winners;
- later positive-weight rounds finalizing eligible savers;
- three independent prize slots;
- confidential automatic prize delivery;
- winner-specific prize reveal;
- confidential principal withdrawal;
- prize-share redemption back through the strategy route;
- keeper resumability and bounded hosted execution.

A positive prize QA flow also verified that principal and prize accounting remain distinct: redeeming prize-share units
changes the prize position and available demo cUSDC without reducing saved principal.

## Hosted keeper evidence

The keeper is scheduled through GitHub Actions and can be invoked manually as well. Its environment is pinned to the
canonical final V4 pool, snapshot batcher, draw batcher, prize vault, and manager.

A successful hosted cycle on the final deployment completed a settled round by verifying the remaining winner stage,
processing/funding the prize round, and delivering all three prizes. The cycle completed within the bounded hosted job
budget.

The keeper is not a privileged winner selector. Eligible protocol transitions are permissionless and the winner is
determined by the encrypted draw logic.

## Privacy boundary confirmed

### Remains encrypted/private

- available demo cUSDC shown after wallet authorization;
- saved principal;
- pending withdrawal amount;
- mature draw weight;
- exact odds implied by weight;
- prize amount;
- strategy-share amount.

### Public by design

- wallet addresses and transactions;
- transaction timing;
- draw schedule and lifecycle state;
- seat/shard metadata where exposed;
- selected shards;
- final winner addresses;
- settlement and verification evidence.

## Important demo limitations

The live deployment is a Sepolia competition/demo build. Demo cUSDC is not production USDC and the ERC-4626 strategy
appreciation is simulated. The contracts have extensive automated and live testnet validation but have not received an
independent professional security audit.

Live app: https://veil-green.vercel.app  
Repository: https://github.com/Iniwura/veil
