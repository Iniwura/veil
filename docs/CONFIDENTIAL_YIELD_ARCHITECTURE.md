# UNVEIL Confidential Yield Architecture

Research snapshot: 2026-08-24

Repository: `Iniwura/veil` Base: `feat/unveil-autonomous-draws` at the reviewed Slice 2A baseline
`b87d75193c6bed6179b9191fe3fd8399fd029288`

This document is an architecture and integration study. It deliberately does not implement the production yield
integration, change the frontend, deploy contracts, or replace the current demo yield source.

## Executive recommendation

1. Keep the user-facing deposit asset as Zama's mainnet `cUSDC`.
2. Keep user principal accounting in UNVEIL as an encrypted cUSDC liability, separate from draw weights and prize
   custody.
3. Add a versioned `VeilStrategyManager` that owns a cUSDC liquidity buffer and confidential `csteakcUSDC` shares; do
   not let `VeilPool` directly own strategy shares.
4. Use one route-specific `BatcherConfidential` deposit batcher for cUSDC → csteakcUSDC and one withdrawal batcher for
   csteakcUSDC → cUSDC.
5. Implement both batchers as thin, route-specific contracts inheriting the audited v0.5.2 primitive. Treat the manager
   as the only participant recognized by UNVEIL accounting, while leaving dispatch, callbacks, and claims permissionless
   and state-gated.
6. Pay prizes in encrypted `csteakcUSDC` shares. This preserves confidential yield-bearing ownership and avoids a second
   public redemption step at prize claim time.
7. Make withdrawals synchronous only when the encrypted cUSDC buffer can satisfy the request; otherwise create an
   encrypted queued withdrawal and settle it through the withdrawal batcher.
8. Compute an encrypted surplus from confidential share holdings and the public ERC-4626 share price, then mask every
   prize transfer with an FHE solvency predicate. No owner supplies or declares a yield amount.
9. Use the exact same adapter interface on Sepolia, but only with a clearly labelled controlled mock ERC-4626 strategy
   because no official Sepolia confidential-yield deployment is currently registered.
10. Deploy this as a fresh versioned stack; do not mutate the already deployed demo `VeilYieldSource`, whose one-time
    prize-vault wiring and owner-funded semantics are not a safe migration boundary.

## Sources, versions, and verification status

### Primary sources reviewed

- [Zama, “Private Deposits into Public DeFi: Zama's First Confidential Vault Design”](https://www.zama.org/post/private-deposits-into-public-defi-zamas-first-confidential-vault-design),
  17 June 2026. This is the primary architecture source for the batch lifecycle, aggregate-only disclosure, wrapper
  pair, asynchronous unwrapping, ERC-4626 route, and failure recovery.
- [Zama, “Steakhouse Confidential Prime USDC Vault on Morpho: Now Live”](https://www.zama.org/post/steakhouse-confidential-prime-usdc-vault-on-morpho-deposits-now-live),
  23 June 2026. This confirms the live cUSDC product, 24-hour batches, confidential share ownership, and the underlying
  Steakhouse/Morpho strategy.
- [OpenZeppelin Confidential Contracts finance API](https://docs.openzeppelin.com/confidential-contracts/api/finance).
  This is the current API reference for `BatcherConfidential`.
- [OpenZeppelin Confidential Contracts token API](https://docs.openzeppelin.com/confidential-contracts/api/token) and
  [interfaces API](https://docs.openzeppelin.com/confidential-contracts/api/interfaces). These verify the current
  `ERC7984`, `ERC7984ERC20Wrapper`, `IERC7984Receiver`, and `IERC7984ERC20Wrapper` interfaces.
- [OpenZeppelin Confidential Contracts changelog](https://docs.openzeppelin.com/confidential-contracts/changelog) and
  [v0.5.2 release](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts/releases/tag/v0.5.2). `v0.5.2` is
  the latest tagged release observed for this research; its release includes ACL fixes for `ERC7984` and confidential
  vesting, and the preceding `v0.5.1` release fixes zero-contribution batch dispatch initialization.
- [Zama protocol-apps Ethereum address registry](https://github.com/zama-ai/protocol-apps/blob/main/docs/addresses/mainnet/ethereum.md)
  and [Sepolia address registry](https://github.com/zama-ai/protocol-apps/blob/main/docs/addresses/testnet/sepolia.md).
  These are the authoritative address sources used below.
- [OpenZeppelin BatcherConfidential and diff-audit report](https://www.openzeppelin.com/news/openzeppelin-confidential-contracts-batcherconfidential-and-diff-audit).
  This is relevant to route correctness, wrapper capacity, partial-route invariants, and the public permission model.

The exact v0.5.2 source behavior matters for the proposed boundary: `onConfidentialTransferReceived(...)` is external
and not virtual, so a normal subclass cannot override it to enforce `from == VeilStrategyManager`. `dispatchBatch()` is
virtual, permissionless, and has no built-in minimum age. `quit(batchId)` is available only while a batch is `Pending`
or `Canceled`; there is no generic post-dispatch `forceCancel(batchId)` or callback-deadline recovery function in the
base primitive. The architecture below therefore uses inheritance without forking the primitive and treats
dispatched-batch liveness as an external Zama wrapper/KMS dependency.

### Current VEIL dependency and contract baseline

The reviewed repository currently uses `@fhevm/solidity@0.11.1`, `@fhevm/hardhat-plugin@0.4.2`, and
`@zama-fhe/relayer-sdk@0.4.1`. It does not currently depend on `@openzeppelin/confidential-contracts`. The production
integration must add the current supported OpenZeppelin confidential-contracts release as a deliberate dependency rather
than copying an old implementation into VEIL.

The current contracts were also read directly:

- [`VeilPool.sol`](../contracts/VeilPool.sol) accepts an encrypted asset amount, maintains encrypted principal/draw
  weight state, and currently holds pooled custody itself.
- [`VeilYieldSource.sol`](../contracts/VeilYieldSource.sol) exposes `accrueYield` and `allocateToRound` behind
  `onlyOwner`. It transfers actual confidential tokens, but the owner chooses both when to call and how much to label as
  yield.
- [`VeilPrizeVault.sol`](../contracts/VeilPrizeVault.sol) accepts a confidential prize asset from the configured yield
  source and exposes the encrypted prize only to the finalized winner.
- [`MockConfidentialToken.sol`](../contracts/MockConfidentialToken.sol) is a test-only FHE token with public minting and
  ERC-7984-style all-or-zero transfer behavior. It is not a yield strategy.

### Verified Ethereum mainnet addresses

| Component                                        | Address                                      | Verification                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cUSDC                                            | `0xe978F22157048E5DB8E5d07971376e86671672B2` | Listed by the Zama mainnet registry as `cUSDC`; underlying token is Ethereum USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`.                                                                                                                              |
| csteakcUSDC                                      | `0x66Bf74E96900D1a19c7070D939D124f2F565C458` | Listed by the Zama mainnet registry as `csteakcUSDC`; its registered underlying is `0xbEEF00A59B577423653A1526c7009bdE103F542B`.                                                                                                                             |
| Confidential Steakhouse/Morpho vault/share token | `0xbEEF00A59B577423653A1526c7009bdE103F542B` | The Zama registry identifies this as the underlying of `csteakcUSDC`; the official Morpho page is [Steakhouse Confidential Prime USDC](https://app.morpho.org/ethereum/vault/0xbEEF00A59B577423653A1526c7009bdE103F542B/steakhouse-confidential-prime-usdc). |
| Zama wrappers registry                           | `0xeb5015fF021DB115aCe010f23F55C2591059bBA0` | Official Zama mainnet registry entry.                                                                                                                                                                                                                        |

The registry verifies the csteakcUSDC-to-underlying pairing and the Morpho UI verifies the vault identity. Before a
production deployment, a fork/integration test must still query the address and assert the exact ERC-4626 surface
required by the adapter: `asset()`, `deposit`, `redeem`, `previewDeposit`, `previewRedeem`, `convertToAssets`,
`totalAssets`, and `totalSupply`. An address registry is not a substitute for ABI and behavior verification.

### Sepolia availability conclusion

The current official
[Sepolia registry](https://github.com/zama-ai/protocol-apps/blob/main/docs/addresses/testnet/sepolia.md) lists official
confidential wrappers, including:

| Component                                          | Address                                      | Status                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| cUSDCMock                                          | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` | Available; its underlying mock ERC-20 is `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`.                                                 |
| Wrappers registry                                  | `0x2f0750Bbb0A246059d80e94c454586a7F27a128e` | Available.                                                                                                                             |
| csteakcUSDC                                        | Not listed                                   | No official Sepolia confidential Steakhouse share wrapper was found.                                                                   |
| Confidential Steakhouse/Morpho ERC-4626 vault      | Not listed                                   | No official Sepolia confidential-yield vault was found.                                                                                |
| Deposit/withdrawal BatcherConfidential deployments | Not listed                                   | BatcherConfidential is an OpenZeppelin library primitive; no official Zama Sepolia route deployment was found in the address registry. |

Therefore Sepolia cannot honestly demonstrate the production Steakhouse route today. The demo should use `cUSDCMock`
plus a controlled test-only ERC-4626 strategy and two concrete batcher adapters with the same interfaces and lifecycle.
Any simulated exchange-rate increase must be labelled simulated strategy behavior, not market yield. The production
address configuration must be impossible to select accidentally on Sepolia.

## Current-system problem

The current `VeilYieldSource` is a useful demo boundary but not a production yield accounting system:

1. The owner calls `accrueYield` and supplies an encrypted amount from the owner wallet.
2. The owner calls `allocateToRound` and chooses the amount and target round.
3. The contract checks that the requested amount fits its own encrypted `unallocatedYield`, but that balance was
   populated by the same owner-controlled path.
4. There is no strategy share balance, public vault exchange-rate observation, pending asynchronous wrapper state, or
   automated recovery path.

The current prize vault is physically separated from pool principal, which is a good invariant to preserve. The
replacement must preserve that separation while making prize funding a consequence of strategy assets and encrypted
principal liability rather than an operator declaration.

## Proposed contract architecture

### Components

`VeilPoolV2` remains the user-facing principal and draw protocol. It keeps the existing fixed schedule, FHE draw
snapshots, silent-zero semantics, and bounded seat model, but delegates custody and strategy movements to a manager.

`VeilStrategyManager` is the only contract allowed to move pooled cUSDC into strategy routes or send prize assets to the
prize vault. It owns:

- an encrypted cUSDC liquidity buffer;
- encrypted cUSDC principal liability supplied by `VeilPoolV2`;
- confidential csteakcUSDC strategy shares;
- encrypted queued-withdrawal liabilities;
- route state and batch IDs for the deposit and withdrawal batchers.

`VeilDepositBatcher` is a concrete `BatcherConfidential` route with `fromToken = cUSDC` and `toToken = csteakcUSDC`. Its
route unwraps aggregate cUSDC, calls the underlying ERC-4626 vault's `deposit`, and lets the base batcher wrap the
received vault shares into csteakcUSDC.

`VeilWithdrawalBatcher` is a concrete `BatcherConfidential` route with `fromToken = csteakcUSDC` and `toToken = cUSDC`.
Its route unwraps aggregate csteakcUSDC, calls the underlying vault's `redeem`, and lets the base batcher wrap the
received USDC into cUSDC.

`VeilPrizeVaultV2` is configured with `csteakcUSDC` as its prize asset. It preserves winner-only FHE ACLs and claim
state, but records and transfers confidential shares rather than cUSDC.

The wrappers and batchers are route-specific and immutable per strategy. A future second strategy requires a second
explicitly configured pair; it must not be selectable through a mutable owner-controlled route address.

### Participant boundary and accounting

The v0.5.2 callback cannot be gated by a normal subclass override. UNVEIL must not fork or copy `BatcherConfidential`
merely to add a manager-only callback. The inherited route may technically accept third-party participants. That is an
acknowledged public and griefing surface, not a source of UNVEIL credit:

- `VeilStrategyManager` is the only account whose `deposits(batchId, manager)` balance is recognized by UNVEIL
  accounting.
- Only outputs claimed to the manager are added to the manager's encrypted strategy-share balance.
- A direct third-party participant receives no UNVEIL principal, draw weight, prize entitlement, withdrawal claim, or
  protocol accounting rights.
- Direct participants can still consume batch capacity, affect aggregate totals and timing, and create operational or
  privacy pressure for the route. The manager and keepers must monitor capacity and pause new manager joins before the
  route becomes unavailable.

“Dedicated route” therefore means a fixed token/vault route and accounting boundary; it does not mean cryptographic
manager exclusivity. A future audited primitive with a hook before the non-virtual callback could provide that stronger
property, but this design does not assume one.

### Why a liquidity buffer is required

Putting all capital into the vault would make ordinary principal withdrawals depend on the asynchronous withdrawal
batcher. That is not a PoolTogether-like user experience and creates avoidable principal lockup during a vault pause,
KMS outage, or callback delay.

The recommended model is a configurable liquidity buffer plus invested remainder:

- Keep enough cUSDC in the manager for the expected instant-withdrawal demand and a safety margin.
- Invest only excess cUSDC through the deposit batcher.
- Allow a keeper to rebalance permissionlessly when the encrypted buffer target predicate says more or less liquidity is
  needed.
- Never use the buffer below the encrypted principal reserve merely because a prize is ready.

The buffer ratio should be a risk parameter set at deployment and changed only through a delayed governance path. It is
a capital-liquidity policy, not a yield declaration.

## Asset flow

```text
User wallet
   │ encrypted cUSDC amount
   ▼
VeilPoolV2 ── encrypted principal liability / draw state ──► VeilStrategyManager
   │                                                        │
   │ immediate cUSDC withdrawal                              ├─ cUSDC liquidity buffer
   │                                                        │
   │ queued withdrawal                                      ├─► WithdrawalBatcher
   │                                                        │       csteakcUSDC unwrap
   │                                                        │       ERC-4626 redeem
   │                                                        │       cUSDC wrap
   │                                                        │
   └─ principal deposits / excess cUSDC                    └─► DepositBatcher
                                                                   cUSDC unwrap
                                                                   ERC-4626 deposit
                                                                   csteakcUSDC wrap

VeilStrategyManager ── encrypted surplus csteakcUSDC ──► VeilPrizeVaultV2
                                                            │
                                                            └─ winner-only encrypted claim
```

## Deposit lifecycle

### User deposit into UNVEIL

1. The user encrypts a cUSDC amount for `VeilPoolV2` and submits the ERC-7984 transfer/input proof.
2. `VeilPoolV2` updates the user's encrypted principal and aggregate liability with the existing all-or-zero semantics.
3. cUSDC is transferred into the manager or its buffer. The user-facing deposit does not reveal the amount.
4. The manager marks the new principal liability before any investment decision. It may keep the funds in the buffer or
   include an aggregate excess amount in the next strategy deposit batch.
5. The manager never sends a user's individual amount to the batcher. It sends a pooled encrypted amount, so the batcher
   normally observes the manager as the UNVEIL participant and does not create a second user-level public join record.
   Direct third-party participants remain technically possible and are outside UNVEIL accounting and privacy guarantees.

### Deposit batch

The official BatcherConfidential API is:

- `onConfidentialTransferReceived` receives ERC-7984 transfer-and-call deposits;
- `dispatchBatch()` is permissionless and closes the current batch;
- `dispatchBatchCallback(batchId, unwrapAmountCleartext, decryptionProof)` is permissionless and completes the
  asynchronous unwrap and route;
- `claim(batchId, account)` is permissionless and returns the encrypted pro-rata output to the account;
- `quit(batchId)` returns the original encrypted deposit while a batch is pending or canceled.

The manager-specific batcher cannot constrain the callback/join path through a normal subclass override because the
inherited callback is external and non-virtual. Dispatch, callback, and claim remain callable by keepers and relayers.
The concrete route must instead make the manager boundary explicit in accounting: only `deposits(batchId, manager)` and
outputs claimed to the manager affect UNVEIL state. Direct users do not receive UNVEIL rights, but they can still grief
capacity or affect public batch data.

The batch lifecycle is:

1. Manager transfers encrypted cUSDC to the deposit batcher using ERC-7984 transfer-and-call.
2. Anyone dispatches after the configured minimum batch age. Dispatch pins the public vault rate and requests
   asynchronous decryption of the aggregate.
3. Anyone submits the KMS decryption proof to the callback.
4. The route unwraps aggregate cUSDC, calls `vault.deposit(underlyingAmount, address(this))`, and returns `Complete`;
   the base batcher wraps the vault shares and records a public batch exchange rate.
5. The manager claims the batch output. The output is confidential csteakcUSDC shares and is added to the manager's
   encrypted strategy balance.

### UNVEIL dispatch-age policy

The base `BatcherConfidential` does not provide a privacy accumulation window. Its `dispatchBatch()` is permissionless
and has no minimum-age check. Because `dispatchBatch()` is virtual, each concrete UNVEIL batcher may override it without
forking the primitive:

1. Store an immutable or deployment-configured `minimumBatchAge` and a public `currentBatchOpenedAt` timestamp.
2. Revert before `block.timestamp >= currentBatchOpenedAt + minimumBatchAge`.
3. After the age is reached, allow any caller to call `super.dispatchBatch()`.
4. After successful dispatch advances `currentBatchId`, initialize the next batch's opening timestamp.

No privileged keeper is required. For production, target a privacy-oriented cadence informed by Zama's current 24-hour
Steakhouse batching. Sepolia should use a much shorter explicitly labelled demo cadence; it must not be described as the
production privacy parameter.

`Partial` routes are not needed for a single vault `deposit`/`redeem` call. If a future route uses `Partial`, it must
obey OpenZeppelin's invariant that no `toToken` underlying balance changes during an intermediate step, or a concurrent
batch can sweep the wrong output.

## Strategy lifecycle

### Invest

`investExcess()` is permissionless and state-gated:

- it computes an encrypted amount that can leave the buffer while maintaining the principal reserve and configured
  liquidity target;
- an encrypted zero is selected when the buffer is not above target;
- it joins the deposit batcher with the aggregate amount;
- it does not accept a caller-supplied plaintext or encrypted amount as an assertion of yield.

### Mark-to-market

The manager observes public vault/share data and combines it with encrypted balances:

```text
encryptedStrategyValue
  = encryptedCsteakcShares × conservativePublicAssetsPerShare / scale

encryptedTotalBackingValue
  = encryptedCUsdcBuffer + encryptedStrategyValue + reservedInFlightValue

encryptedSurplus
  = max(encryptedTotalBackingValue - encryptedPrincipalLiability, 0)
```

The public `assetsPerShare` input must be derived from the verified ERC-4626 vault, using a conservative conversion and
explicit decimal/rounding policy. The adapter must not attempt to call `convertToAssets` with an encrypted amount. It
should obtain a public rate for a fixed unit and multiply the encrypted share balance by that public rate. Any fee,
rounding, or stale-rate margin must reduce the usable surplus, never increase it.

The manager uses `FHE.select` to mask a prize or rebalance transfer with the encrypted solvency predicate. It cannot
branch on an encrypted value with Solidity `if`, and it must not request public decryption merely to decide whether an
amount is safe.

### Harvest and prize funding

`harvestSurplus(roundId)` is permissionless and can only fund a finalized draw. It computes the encrypted csteakcUSDC
amount that can be removed while preserving the principal reserve, then transfers that encrypted share amount to
`VeilPrizeVaultV2`. The prize vault records the received shares and authorizes only the public winner to decrypt and
claim.

There is no `onlyOwner accrueYield` and no owner-selected `allocateToRound`. If strategy value is below principal
liability, the masked amount is zero and no prize is funded. If the public share rate later falls, future harvests stop;
already extracted prizes are not retroactively relabelled.

## Withdrawal lifecycle

### Instant path

`VeilPoolV2.withdraw` first checks the caller's encrypted principal and the manager's encrypted liquid cUSDC buffer. It
selects the full requested amount only when both are sufficient. A valid request within both limits transfers cUSDC
immediately and decreases the encrypted principal liability.

This preserves the current silent-zero protection against oversized confidential requests, but the manager must expose a
user-scoped status/decryption path so a user can distinguish an immediate completion from a queued request without
revealing the amount publicly.

### Queued path

If the buffer cannot satisfy the request, the manager creates an encrypted queued withdrawal rather than silently
discarding the request or spending another user's principal:

1. The requested amount is checked against the user's encrypted principal.
2. The amount is moved from the user's active pool position into a reserved withdrawal position and added to an
   encrypted queue total. It remains inside aggregate `principalLiability`; queue reservation does not reduce the
   protocol liability.
3. The manager submits an aggregate csteakcUSDC amount to the withdrawal batcher when enough strategy liquidity is
   available.
4. Anyone dispatches the batch, submits the valid asynchronous unwrap proof, and claims the resulting cUSDC to the
   manager.
5. A permissionless settlement call uses encrypted queue state to pay eligible users from the replenished cUSDC buffer,
   with all-or-zero per user.

The implemented queue is FIFO. Settlement attempts are all-or-zero against the FIFO head. Because Solidity cannot branch
on an encrypted transfer result, the manager exposes only an encrypted `remaining == 0` completion predicate; anyone
submits a valid proof of that boolean before the public FIFO pointer advances. This avoids revealing the amount while
preventing a zero/failed payout from being treated as settled. A user may cancel only before their request is committed
to a dispatched withdrawal batch; a canceled request restores the reserved amount to the active pool position. The queue
state survives keeper changes and KMS delays.

### Can withdrawal remain instant?

Not for all principal. It can remain instant for the buffer-covered portion; it cannot honestly remain universally
instant while the invested portion exits through the official asynchronous withdrawal route. The correct UX is “instant
when liquid, queued otherwise,” with a private status and a public batch-level pending state.

## Prize asset decision

### A. Pay prizes in cUSDC

Advantages:

- familiar asset and simple winner UX;
- directly compatible with the current `VeilPrizeVault` shape;
- stable denomination for displaying a prize after user-authorized decryption;
- no continuing strategy exposure for the winner.

Costs:

- invested surplus must first be redeemed through the asynchronous withdrawal batcher;
- the redemption exposes a public aggregate batch total and timing;
- prize funding can be delayed by vault liquidity, asynchronous wrapper settlement, or KMS availability;
- converting shares to cUSDC creates another public/plaintext boundary and removes the winner from yield.

### B. Pay prizes in csteakcUSDC shares

Advantages:

- the winner receives a confidential yield-bearing asset directly;
- no aggregate redemption is required at prize extraction or claim time;
- the winner's amount and share balance stay encrypted through the prize vault;
- continued yield exposure is preserved, and the public share price does not reveal the winner's encrypted share count;
- this is the strongest end-to-end confidentiality option among the two current choices.

Costs:

- the winner must understand or later redeem a strategy share asset;
- prize value changes with the public ERC-4626 share price and strategy performance;
- wrapper capacity, pausing, or strategy loss can affect transfers and perceived value;
- the prize vault and future frontend must support csteakcUSDC rather than assuming cUSDC.

### Recommendation

Use csteakcUSDC for the production prize asset. It best preserves confidential ownership and avoids turning every prize
into a second asynchronous redemption. The UI should show a user-authorized value estimate based on the public vault
rate and clearly describe that the prize is a yield-bearing share. A later product version may offer an opt-in cUSDC
redemption flow, but the core prize accounting should remain share-native.

## Principal solvency invariant

The hard invariant is:

```text
value(buffer cUSDC)
  + value(strategy csteakcUSDC shares after extraction)
  + value(reserved in-flight assets)
  >= encrypted aggregate principal liability
```

Implementation rules:

1. `principalLiability` is increased only when cUSDC custody increases and decreased only after an actual confidential
   principal transfer to the user. A queued withdrawal remains a real liability until it is paid.
2. Investing principal changes asset form but not liability.
3. A prize transfer is selected from `safeSurplusShares`, which is computed after reserving the shares needed to cover
   liability not covered by the buffer.
4. The manager masks an unsafe transfer to encrypted zero. It never relies on a caller, owner, or plaintext comparison
   to enforce the invariant.
5. A conservative public exchange rate, rounding margin, and strategy haircut are applied before surplus is computed.
6. If the strategy loses value, prize funding stops. The protocol must not use new depositor principal to make up a
   previous prize.
7. Pending batch assets remain reserved in the accounting state until the batch reaches `Complete` or `Cancel`.
8. A vault pause, cap, or route failure may reduce liquidity, but it must not cause the manager to treat an uncompleted
   route as yield.

This is an asset-solvency invariant, not a promise that an external strategy can never lose money. Governance may pause
new investment, but it must not be able to mint a prize or write down a user's encrypted liability arbitrarily.

## Slice 2B implementation note

Slice 2B extends `VeilStrategyManagerV2` with principal withdrawals while leaving prizes, harvesting, `VeilPoolV2`, and
the frontend out of scope. The test-only pool harness models the production boundary: an encrypted withdrawal is first
restricted against the caller's active encrypted position, then the manager receives the permitted ciphertext through
the immutable pool address. The manager separately caps it against aggregate liability.

The accounting invariant is:

```text
principalLiability = active principal + reserved unpaid withdrawal principal
queuedWithdrawalTotal = encrypted sum of reserved unpaid requests
```

An instant request transfers the full permitted amount only when the live manager cUSDC buffer covers it. Otherwise it
transfers zero and queues the full permitted amount. Only the actual confidential amount returned by the ERC-7984
transfer reduces `principalLiability`; queue creation does not increase it. Queue settlement decreases both
`queuedWithdrawalTotal` and `principalLiability` only after actual payout. Cancellation decreases only the queue total
and restores the user's reserved amount to active position; it never writes down aggregate liability.

The manager applies a second aggregate-safety cap even though the pool normally restricts a request to the user's active
position:

```text
unreservedLiability = max(principalLiability - queuedWithdrawalTotal, 0)
acceptedAmount = min(unreservedLiability, poolPermittedAmount)
```

Thus a stale or over-permissive pool ciphertext cannot consume liability already reserved for another queued request.

The queue is FIFO and bounded per call: one request is attempted per settlement call, and one canceled head can be
advanced per `advanceWithdrawalQueue` call. A completion proof verifies only an encrypted boolean predicate, not the
withdrawal amount. This extra permissionless proof step is required by the FHE constraint that a contract cannot branch
on whether an encrypted payout was nonzero.

Pending manager deposit batches can be permissionlessly reclaimed through `quit`, returning principal to the live buffer
without changing liability or shares. Since the encrypted liquidity deficit cannot be used as a Solidity branch, the
reclaim operation is state-gated to recognized Pending manager batches but may be called prematurely by a keeper; the
trade-off is documented in the contract and prioritizes principal recoverability over yield availability.

When the buffer is insufficient after reclaim, `fundWithdrawalLiquidity` computes:

```text
normalTarget = ceil(principalLiability * bufferReserveBps / 10_000)
liquidFloor = max(normalTarget, queuedWithdrawalTotal)
investable = max(liveBuffer - liquidFloor, 0)
liquidityNeed = max(queuedWithdrawalTotal - liveBuffer, 0)
totalRequired = ceil(liquidityNeed * shareScale / conservativeAssetsForProbe)
alreadyCommittedShares = withdrawalBatcher.deposits(currentBatchId, manager)
remainingRequired = max(totalRequired - alreadyCommittedShares, 0)
additionalShares = min(remainingRequired, liveManagerShareBalance)
```

Queued claims therefore reserve liquidity before new principal is invested: a pending investment may not reduce the
manager's live buffer below either the normal reserve target or the encrypted queue total. Repeated funding calls for
the same Pending withdrawal batch submit only the current shortfall; a later request increases the required amount only
by its delta. Strategy shares entering the withdrawal batch are not liquid and do not change either liability value.
Only a finalized batch claim returning confidential principal to the manager increases the live buffer. A canceled batch
returns the original confidential shares. A dispatched batch that is waiting on KMS remains committed and its requests
cannot be canceled; strategy losses may therefore leave a request reserved and unpaid without making the liability
disappear.

Each withdrawal request records the batch ID and global funding-attempt nonce at creation. Every manager funding attempt
increments the nonce and records the latest nonce for the current batch. A request is committed only when a later
funding attempt exists for that same batch and the batch has left `Pending`; merely being created while an
already-funded batch is still Pending does not commit it. Requests in a later batch do not inherit the prior batch's
commitment.

### Arithmetic implementation gate

The invariant is only a design requirement until the implementation proves the exact arithmetic. No prize-extraction
implementation may be accepted until tests demonstrate that principal backing cannot be overestimated across:

- the cUSDC wrapper rate;
- the csteakcUSDC wrapper rate;
- ERC-4626 decimals;
- `convertToAssets` and `previewRedeem` rounding;
- the conservative haircut applied to public strategy value;
- `euint64` bounds and overflow behavior;
- `euint128` intermediates where multiplication requires them;
- the direction of every ceil/floor conversion;
- pending deposit batches;
- pending withdrawal batches; and
- claimed versus unclaimed batch outputs.

The test oracle should calculate the same conversion in a high-precision reference model and prove that every encrypted
amount selected for a prize is no larger than the conservatively backed surplus.

## Failure recovery

The recovery invariant is: **UNVEIL never intentionally forfeits principal, and protocol-controlled route failures
return recoverable assets where the underlying `BatcherConfidential` lifecycle supports cancellation. Capital already
committed to an external asynchronous unwrap remains subject to Zama KMS/wrapper liveness.**

| Failure                                                  | Required behavior                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault `deposit` or `redeem` reverts after a valid unwrap | `_executeRoute` returns `ExecuteOutcome.Cancel` before irreversible route logic completes. `BatcherConfidential` rewraps the from-token underlying, and the participant later recovers through `quit()` while the batch is `Canceled`.                                                                                                                                             |
| KMS/decryption outage after dispatch                     | The batch remains `Dispatched`. There is no generic base `forceCancel` or callback-deadline recovery path. No false accounting transition occurs, pending principal remains reserved, no prize counts pending output as realized yield, new investment may be paused, buffer-covered withdrawals may continue, and the asynchronous capital waits for valid callback availability. |
| Invalid KMS proof                                        | The callback reverts without advancing the batch. A valid proof remains required.                                                                                                                                                                                                                                                                                                  |
| Zero aggregate batch                                     | The batch auto-cancels rather than reaching a division by zero. Keep the v0.5.1+ behavior and test both no-join and zero-join cases.                                                                                                                                                                                                                                               |
| Strategy is paused or capped                             | New deposit routes may cancel; the manager keeps funds in the buffer and stops calling `investExcess`. Withdrawals use the buffer or the withdrawal route when available.                                                                                                                                                                                                          |
| User withdraws while capital is pending                  | The encrypted request is queued against liability; it is not silently destroyed and it does not spend another user's liquid balance.                                                                                                                                                                                                                                               |
| Strategy shares are received but not claimed             | Any keeper may claim for the manager; the batch output is credited only after the claim succeeds.                                                                                                                                                                                                                                                                                  |
| Wrapper capacity is near exhaustion                      | Pause new joins before capacity is reached. The OpenZeppelin documentation warns that wrapper capacity exhaustion can brick both completion and cancellation.                                                                                                                                                                                                                      |
| Partial route receives intermediate output               | Do not transfer `toToken` underlying during `Partial`; otherwise a concurrent batch can sweep another batch's output. Prefer a single-step route for v1.                                                                                                                                                                                                                           |
| Draw KMS outage                                          | Draw settlement remains independent of strategy settlement. A delayed prize harvest cannot alter principal or the fixed draw schedule.                                                                                                                                                                                                                                             |

Failure tests must distinguish a route failure after a valid callback, which supports `Cancel` and `quit()`, from a
dispatched batch waiting on KMS/wrapper liveness. They must prove that neither case creates false yield or loses UNVEIL
principal, while acknowledging that capital in the latter state may remain temporarily unavailable.

## Privacy boundary

For `BatcherConfidential`, joined amounts are encrypted handles rather than plaintext values. Participant accounts,
batch membership, lifecycle transitions, timing, and the aggregate cleartext amount used for the public ERC-4626
operation remain observable. UNVEIL's manager aggregation prevents an individual pool user's amount from becoming a
route-level plaintext join, but it does not make the route manager-exclusive or provide anonymity against public
transaction analysis.

| Data                                                                         | Public or confidential                                | Notes                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet addresses joining UNVEIL                                              | Public                                                | Ethereum transaction participants and draw-seat membership are public in the current design.                                                                                                                                        |
| Individual cUSDC deposit amount                                              | Confidential                                          | Encrypted input and pool ledger; do not emit a plaintext amount.                                                                                                                                                                    |
| Pool's aggregate strategy deposit                                            | Public aggregate                                      | Batcher dispatch necessarily decrypts the batch total to cross into the public ERC-4626 vault. Manager aggregation keeps an individual UNVEIL user's amount out of the route-level plaintext aggregate.                             |
| Individual strategy share balance                                            | Confidential                                          | Held as csteakcUSDC and accessed through FHE ACLs.                                                                                                                                                                                  |
| Vault address, vault exchange rate, total assets, and public strategy events | Public                                                | This is inherent in routing to a public ERC-4626/Morpho vault.                                                                                                                                                                      |
| Individual withdrawal amount                                                 | Confidential                                          | Input and per-user queue remain encrypted; batch-level withdrawal totals and timing are public.                                                                                                                                     |
| Batch membership                                                             | Public at the adapter level                           | Addresses/accounts and lifecycle are public. The manager is the recognized UNVEIL participant; direct third-party participants are outside UNVEIL's privacy and accounting guarantees and can affect route capacity and aggregates. |
| Draw weights and balances                                                    | Confidential values; addresses and round state public | Preserve the existing FHE snapshot guarantees.                                                                                                                                                                                      |
| Prize amount and winner's csteakcUSDC balance                                | Confidential                                          | Winner-only ACL and user decryption; public share price can be combined with a user-revealed value by that user, not by the chain.                                                                                                  |
| Winner address and claim transaction                                         | Public                                                | Existing finalization and custody model already exposes these facts.                                                                                                                                                                |

The correct claim is not “everything is private.” The stack hides amounts and ownership balances where ERC-7984 permits
it, while public vault state, aggregate batches, addresses, timing, and final winners remain observable.

## Permission model and automation

| Actor                 | Permission                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User                  | Deposit, immediate withdrawal, queue/cancel withdrawal under the documented state rules, and claim their own prize.                                                                                                         |
| Keeper/relayer        | Dispatch deposit/withdrawal batches after the route age, submit valid KMS callbacks, claim completed batch outputs, rebalance, settle queued withdrawals, and harvest a safe prize. All are permissionless and state-gated. |
| `VeilPoolV2`          | Update the manager's encrypted principal liability and authorize only protocol-scoped custody movements.                                                                                                                    |
| `VeilStrategyManager` | Move only configured cUSDC/csteakcUSDC assets and invoke only the configured batchers/vault.                                                                                                                                |
| Governance/guardian   | Configure risk parameters at deployment; pause new investment or new prizes through a delayed, observable path. It cannot set yield, transfer arbitrary principal, or select a winner.                                      |
| Zama KMS/coprocessor  | Produce proofs for encrypted unwraps and draw/winner decryptions; onchain contracts validate the proofs.                                                                                                                    |

The manager should emit operational events for batch IDs, route states, public exchange rates, deadlines, and failure
outcomes, but never event plaintext individual amounts.

## Mainnet versus Sepolia

| Concern              | Mainnet production                                                                         | Sepolia judge demo                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| User asset           | Official cUSDC `0xe978...72B2`                                                             | Official `cUSDCMock` `0x7c5B...3639`                                                            |
| Yield route          | Official csteakcUSDC wrapper and Steakhouse/Morpho vault, subject to ABI/fork verification | Controlled test-only ERC-4626 strategy with the same adapter interface                          |
| Yield claim          | Actual strategy performance measured from shares and public vault rate                     | Simulated strategy state, explicitly labelled as simulation; no “real yield” claim              |
| Batchers             | Two deployed, audited-version route contracts tied to the official wrappers                | Two concrete demo route contracts using the same v0.5.2 base and lifecycle                      |
| Principal withdrawal | Buffer-covered instant path, otherwise asynchronous withdrawal batch                       | Same buffer/queue UX and failure states, exercised against the mock route                       |
| Prize asset          | csteakcUSDC                                                                                | Mock confidential share token representing the same interface; not an official Steakhouse asset |
| Deployment           | Fresh versioned deployment with addresses pinned in configuration                          | Fresh versioned demo deployment; do not reuse the current owner-funded `VeilYieldSource`        |

The demo must fail closed if a production address is selected on Sepolia or if a mock strategy is presented as a
production vault.

## Required contract changes

These are future implementation steps, not changes in this research task:

1. Add a `VeilStrategyManagerV2` and move strategy custody out of the user-facing pool.
2. Replace direct `VeilYieldSource` calls with a typed manager interface for principal updates, buffer withdrawals,
   queued withdrawals, safe harvest, and strategy status.
3. Add `VeilDepositBatcher` and `VeilWithdrawalBatcher` concrete routes using the current OpenZeppelin
   confidential-contracts APIs.
4. Change prize custody to `VeilPrizeVaultV2` with `csteakcUSDC` as the configured asset.
5. Replace owner-only yield functions with permissionless, state-gated lifecycle functions; reserve governance only for
   risk configuration and emergency pause.
6. Add encrypted liability, buffer, pending route, and queued-withdrawal accounting with explicit ACL grants.
7. Add public schedule/state getters for strategy batch IDs, deadlines, buffer mode, route mode, and recoverability; do
   not expose encrypted amounts.
8. Use a fresh deployment version because the existing prize-vault configuration is one-time and the deployed demo has
   different economic semantics.
9. Pin the reviewed OpenZeppelin confidential-contracts release and its peer baseline; Slice 1 uses
   `@openzeppelin/confidential-contracts` `0.5.2`, `@openzeppelin/contracts` `5.6.1`, and
   `@openzeppelin/contracts-upgradeable` `5.6.1` with `@fhevm/solidity` `0.11.1`.
10. Preserve all current draw, FHE, ERC-7984 silent-zero, pooled-custody, snapshot, and seat-lease guarantees.

## Required new interfaces

The following interfaces should be designed before implementation:

```solidity
interface IVeilStrategyManager {
  function increasePrincipal(address account, externalEuint64 amount, bytes calldata proof) external;
  function decreasePrincipal(address account, externalEuint64 amount, bytes calldata proof) external;
  function requestWithdrawal(externalEuint64 amount, bytes calldata proof) external returns (uint256 requestId);
  function investExcess() external;
  function settleWithdrawal(uint256 requestId) external;
  function harvestSurplus(uint256 roundId) external;
  function strategyStatus() external view returns (uint8 mode, uint256 depositBatchId, uint256 withdrawalBatchId);
}
```

This is intentionally illustrative, not a final ABI. The actual implementation must use the exact current
`externalEuint64` and proof shapes, avoid putting a plaintext amount in a public return, and separate caller
authorization from any encrypted amount logic.

Concrete batcher routes need:

- configured `IERC7984ERC20Wrapper fromToken` and `toToken`;
- verified underlying vault address and ERC-4626 calls;
- `routeDescription()`;
- a manager-recognized accounting boundary; the inherited callback is not manager-exclusive;
- public route/batch recovery state;
- no owner-only economic settlement path.

## Migration plan

1. Freeze the current deployed V1 demo as an historical demo; do not change its owner-funded accounting in place.
2. Deploy the selected OpenZeppelin confidential-contracts version and concrete route contracts in a new
   namespace/version.
3. Deploy `VeilStrategyManagerV2` with the official mainnet cUSDC, csteakcUSDC, vault, and wrapper registry addresses
   after fork verification.
4. Deploy `VeilPoolV2` and `VeilPrizeVaultV2`, wiring immutable strategy and asset addresses.
5. Seed only a documented cUSDC buffer. Do not migrate principal silently; users opt into the new pool and receive no
   implicit share conversion unless a separately audited migration contract is added.
6. On Sepolia, deploy the same route boundary against `cUSDCMock` and the controlled mock ERC-4626 strategy. Mark all
   addresses and simulated performance in the deployment output.
7. Retire or clearly label `VeilYieldSource`'s `accrueYield` and `allocateToRound` as demo-only. Do not present them as
   production yield integration.

## Slice 1 implementation note

Slice 1 now pins `@openzeppelin/confidential-contracts` `0.5.2`, with its verified peer baseline of `@fhevm/solidity`
`0.11.1`, `@openzeppelin/contracts` `5.6.1`, and `@openzeppelin/contracts-upgradeable` `5.6.1`. It adds
`VeilDepositBatcher` and `VeilWithdrawalBatcher` as immutable, route-specific `BatcherConfidential` adapters. Both use a
shared permissionless `minimumBatchAge` gate; the base primitive has no timing gate of its own.

The local route fixture uses `MockUSDC`, `MockYieldVault4626`, and ERC7984 wrappers explicitly marked TEST/DEMO ONLY.
They are not official Zama assets or a production vault. The mock vault's donation and failure toggles exist only to
test share-price movement and `Complete`/`Cancel` behavior. The concrete batcher base initializes `ZamaEthereumConfig`
because `BatcherConfidential` does not do so itself.

The routes multiply the proven cleartext wrapper amount by `fromToken().rate()` before calling ERC-4626. They catch
vault deposit/redeem failures and return `ExecuteOutcome.Cancel` without an alternate irreversible transfer, and they do
not use `Partial` or introduce a timeout recovery path. Before either vault mutation, the routes compare
`previewDeposit`/`previewRedeem` output with `toToken().rate()` and cancel sub-wrapper-unit results; if a non-standard
vault disagrees with its preview or the wrapper rate changes after movement, the callback reverts so the external
operation cannot be misreported as a recoverable cancel. Direct third-party batch participation remains technically
possible, as required by the v0.5.2 callback boundary; Slice 1 has no `VeilStrategyManagerV2` and grants no UNVEIL
accounting rights to those participants.

## Slice 2A implementation note

Slice 2A adds the custody and solvency foundation without implementing withdrawals, prizes, deployment, or the frontend.
The immutable pool is the only principal-liability writer and records the exact encrypted amount returned by the
confidential asset transfer; Slice 2B adds the manager's only decrement path, restricted to actual confidential payout.
The manager reads its live ERC7984 principal and share balances rather than maintaining shadow balances.

The manager values one whole confidential share-token unit using `10 ** strategyShareAsset.decimals()` multiplied by the
wrapper rate, `vault.previewRedeem`, principal-wrapper conversion, and an immutable haircut. Required shares use
encrypted ceil division, and pending, dispatched, finalized-unclaimed, and canceled-unquit batch assets remain excluded
because they have not returned to a manager balance. This slice exposes no prize transfer or harvest path.

## Tests required before production integration

### OpenZeppelin and route compatibility

- Compile against the selected `@openzeppelin/confidential-contracts` and `@fhevm/solidity` versions.
- Assert wrapper `underlying`, `rate`, `decimals`, ERC-165 support, and all unwrap request methods.
- Assert both batchers reject unsupported wrapper versions and duplicate underlying tokens.
- Test transfer-and-call callback input, manager-recognized accounting, direct third-party participation/griefing,
  minimum-age dispatch, callback proof validation, claim, and quit.
- Test wrapper capacity limits and the v0.5.1+ zero-contribution path.

### Strategy accounting

- Deposit route records no user plaintext amount and produces the expected encrypted share output.
- Route revert returns the original from-token and leaves no partial strategy credit.
- Public exchange-rate changes alter encrypted strategy value but never expose the encrypted balance.
- Negative performance produces zero surplus and cannot fund a prize.
- Rounding, decimal conversion, `uint64` limits, fee-on-share behavior, and stale-rate haircut are covered.
- Prize extraction cannot reduce backing below encrypted aggregate principal liability, including in-flight batch state.
- A fake caller cannot set yield, choose a prize amount, or transfer principal.

### Withdrawal and recovery

- Buffer-covered withdrawals settle immediately.
- Insufficient liquidity creates a recoverable encrypted queue entry.
- Queued requests remain safe across dispatch, callback delay, route cancel, and strategy pause.
- A user cannot withdraw another user's principal or make a queued request spend the buffer twice.
- Route cancellation after a valid callback and KMS-outage-dispatched state both preserve accounting; only the former
  supports the base batcher's recoverable `Canceled`/`quit()` path.
- Share output is claimable after a complete deposit batch even if the original keeper disappears.

### UNVEIL regression suite

- Run the complete current draw lifecycle suite unchanged.
- Verify principal independence from old draw snapshots after strategy movement.
- Verify silent-zero oversized requests for both direct pool custody and strategy-manager custody.
- Verify all current draw privacy, seat lease, fixed schedule, SKIPPED/CANCELLED, and winner-proof tests.
- Verify winner-only decryption and claim with csteakcUSDC prize shares.

### Environment tests

- Mainnet-fork test at the pinned production addresses, including the exact vault ABI and wrapper behavior.
- Sepolia test against the official cUSDCMock wrapper plus the controlled mock strategy, with no production-address
  fallback.
- Never label the mock strategy's deterministic exchange-rate changes as market or real yield.

## Unresolved risks

1. The current registry verifies the production token pairing, but the exact ERC-4626 ABI and route behavior at the
   Steakhouse vault must be fork-tested before deployment.
2. BatcherConfidential provides no confidentiality guarantee by default. Joined amounts are encrypted handles, but
   addresses/accounts and lifecycle are public, and the aggregate unwrap amount becomes public. Manager aggregation
   keeps an individual UNVEIL user's amount out of the route-level plaintext aggregate; direct third-party participants
   remain outside UNVEIL's privacy/accounting guarantees and can grief capacity or affect public aggregates. A
   participant controlling most of a batch can still infer another participant's amount.
3. Public ERC-4626 share prices, vault liquidity, fees, caps, and pauses remain public and can change the value or
   availability of a prize.
4. A public share-rate snapshot is not itself a solvency oracle. The implementation needs conservative rounding,
   stale-rate handling, and in-flight asset accounting.
5. Wrapper capacity exhaustion can brick completion or cancellation. Capacity monitoring and a pause-before-capacity
   policy are mandatory.
6. Asynchronous withdrawal and KMS failures mean universal instant withdrawal is impossible without holding a
   sufficiently large buffer. Capital already committed to a dispatched external unwrap remains subject to Zama
   KMS/wrapper liveness; the buffer mitigates this risk but does not prove universal availability.
7. csteakcUSDC prizes improve privacy but impose a share-based UX and continued strategy risk on winners.
8. OpenZeppelin Confidential Contracts is evolving and documents no backward-compatibility guarantee; the selected
   release must be pinned and re-audited against its exact source commit.
9. Mainnet strategy losses can make the pool economically undercollateralized. FHE can prevent further prize extraction;
   it cannot make an external strategy solvent.
10. This document does not validate a live transaction or deploy any new contract. A production decision requires the
    fork and Sepolia adapter tests above.
