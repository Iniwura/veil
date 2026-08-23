# UNVEIL automation and trust model

UNVEIL separates protocol maintenance from strategy accounting so a convenience bot cannot control the prize game.

## Permissionless keeper

The draw lifecycle is designed so any account can execute maintenance after the contract-enforced deadline:

1. `VeilPool.closeDraw()` freezes the eligible encrypted weights after `nextDrawClosesAt`.
2. `VeilPool.blindDraw(roundId)` performs the FHE weighted selection.
3. Zama public decryption returns the winner proof and any account can submit it to `finalizeWinner`.
4. Once the strategy has sealed the completed round's confidential realized-yield bucket, any account can call
   `VeilYieldSource.allocateRoundYield(roundId)`.
5. Any account can call `VeilPrizeVault.deliverPrize(roundId)` and the destination is fixed to the proof-finalized
   winner.

The keeper cannot:

- close a draw early;
- choose a winner;
- choose which round receives a sealed yield bucket;
- change a user's principal;
- redirect a prize;
- decrypt user balances, draw weights, odds, or prize amounts.

The scheduled GitHub Actions keeper is therefore an availability service, not a trusted protocol administrator. If it
stops running, another account can execute the same maintenance calls.

## Scheduled Sepolia keeper

`.github/workflows/unveil-keeper.yml` runs the permissionless keeper periodically on the default branch. It uses a
dedicated low-value account supplied through the `UNVEIL_KEEPER_PRIVATE_KEY` repository secret. The key is not committed
to the repository and should not be the deployment or strategy key.

Optional RPC configuration can be supplied through `UNVEIL_SEPOLIA_RPC_URL`.

The workflow exits successfully without sending transactions when the keeper secret has not been configured.

## Strategy operator

Yield realization is deliberately separated from keeper automation.

`VeilYieldSource` has a dedicated `strategyOperator`. Only that operator can transfer realized confidential assets into
the adapter and seal the round's encrypted yield bucket. After the bucket is sealed, routing is permissionless and
sequential through `yieldRoundId`.

This prevents a keeper from fabricating yield, racing an unfinished strategy sync, or selecting a different round for a
favorable outcome.

For the Sepolia competition deployment, the strategy adapter is backed by actual transfers of Zama's official
`cUSDCMock` wrapper. It is a controlled integration boundary, not a claim that Sepolia has production yield.

## Production direction

A production deployment should replace the controlled strategy operator with a reviewed adapter around a real
confidential yield venue. The current public target is Zama's Ethereum mainnet confidential Steakhouse/Morpho USDC
product. The adapter boundary is intentionally isolated so the pool, draw, proof, and prize-vault logic do not need to
trust a keeper or be rewritten around a specific yield venue.
