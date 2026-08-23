# UNVEIL production yield path

UNVEIL separates the competition-safe Sepolia prize flow from the production yield integration. That boundary is
intentional. The privacy and draw protocol can be tested end to end without pretending that deterministic testnet yield
was produced by a live lending strategy.

## Sepolia competition deployment

The competition stack uses Zama's official Sepolia `cUSDCMock` wrapper as the confidential pool and prize asset.

- `cUSDCMock`: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- mock USDC underlying: `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`

The strategy operator transfers actual confidential cUSDC into `VeilYieldSource` and seals the current round's encrypted
realized-yield bucket after the draw closes. Routing and prize delivery are then permissionless.

The strategy operator cannot choose the winner. A keeper cannot redirect a sealed bucket to another round or another
beneficiary.

This proves the complete confidential accounting and prize-delivery path. It does **not** claim that the deterministic
Sepolia yield was produced by Morpho or another live lending venue.

## Verified production venue

Zama's Steakhouse confidential USDC route is live on Ethereum mainnet. Zama's own protocol-apps fork tests identify the
exact deployed path rather than leaving the integration as a generic design sketch.

Current published addresses:

- cUSDC: `0xe978F22157048E5DB8E5d07971376e86671672B2`
- csteakcUSDC: `0x66Bf74E96900D1a19c7070D939D124f2F565C458`
- Steakhouse USDC Prime ERC-4626 vault: `0xbEEF00A59B577423653A1526c7009bdE103F542B`
- confidential deposit batcher: `0x324EA89FD3784036673BfE6Ffee2334A088F40Cc`
- confidential redeem batcher: `0x96Cd3Faa7483783Ac2Eb715f6333361500F1eec9`

Zama's deployed-batcher manifest states that the deposit batcher routes `cUSDC -> csteakcUSDC` through
`IERC4626.deposit`, while the redeem batcher routes `csteakcUSDC -> cUSDC` through `IERC4626.redeem`.

The ABI boundary used by Zama's own mainnet fork tests is mirrored in `contracts/interfaces/IZamaVaultBatcher.sol`.

Mainnet addresses must still be checked against Zama's protocol registry immediately before any production deployment.

## Exact asynchronous batch lifecycle

The live batchers do not expose a synchronous `deposit()` that UNVEIL can safely pretend is an instant strategy call.

Zama's current integration tests drive the deployed batchers through this lifecycle:

1. Confidential tokens enter the batcher through the wrapper's `confidentialTransferAndCall` path.
2. The batcher records the encrypted per-account deposit in its current batch.
3. After `minBatchAge`, a permissionless caller can call `dispatchBatch()`.
4. Dispatch creates an asynchronous confidential unwrap request.
5. The unwrap handle is publicly decrypted with a KMS proof.
6. `dispatchBatchCallback(batchId, cleartext, proof)` completes the public ERC-4626 vault leg.
7. The output asset is wrapped confidentially.
8. `claim(batchId, account)` returns an encrypted amount of the destination confidential token.
9. A pending participant may call `quit(batchId)` before the batch has irreversibly progressed.

The deposit and redeem batchers use the same interface but opposite token directions.

This means the production adapter needs explicit batch state. It cannot collapse this sequence into a fake synchronous
`deposit`/`withdraw` abstraction.

## Production strategy architecture

```text
UNVEIL private principal accounting
        |
        | confidential strategy allocation
        v
Zama cUSDC wrapper
        |
        | confidentialTransferAndCall
        v
Zama deposit batcher
        |
        | dispatch + public-decryption proof callback
        v
Steakhouse USDC Prime ERC-4626 vault
        |
        | vault shares
        v
Zama csteakcUSDC wrapper
        |
        | confidential share custody / appreciation
        v
Zama redeem batcher
        |
        | dispatch + proof callback
        v
realized confidential cUSDC
        |
        v
UNVEIL realized-yield custody
        |
        | sealed sequential round bucket
        v
VeilPrizeVault
        |
        v
proof-finalized winner
```

A production UNVEIL strategy therefore needs explicit states for:

- idle confidential cUSDC
- pending deposit batch
- active confidential Steakhouse shares
- pending redemption batch
- returned confidential cUSDC
- protected user-principal liability
- realized prize yield

Yield must not be called realized until confidential cUSDC has returned from the redemption path and entered UNVEIL's
prize-yield custody.

## Why this is not wired into the Sepolia pool

The official Steakhouse confidential share wrapper and the deployed mainnet batchers are Ethereum-mainnet infrastructure.
They are not the Sepolia contracts used by the competition app.

More importantly, moving saver principal into the live asynchronous route changes withdrawal semantics. A correct
integration needs private pending-share accounting, delayed-redemption accounting, an idle-liquidity buffer or private
withdrawal queue, failure recovery and bounded-liability math.

Adding an untested mainnet call path to the competition pool would make the demo look more complete while making custody
less correct. UNVEIL instead pins the real production ABI and addresses, proves the confidential strategy/prize boundary
on Sepolia, and leaves the asynchronous principal adapter as an explicit protocol version rather than hidden behavior.

## Required production invariants

1. User principal remains separately accounted from prize yield.
2. Only cUSDC realized above the protected principal and liability floor can enter a prize bucket.
3. A keeper cannot decrypt strategy balances merely because it advances a batch.
4. A keeper cannot choose the destination round for a sealed yield bucket.
5. A keeper cannot choose or redirect the winner.
6. Strategy or batch failure cannot mutate historical draw snapshots.
7. Pending batch latency is represented explicitly in protocol and UI state.
8. Withdrawals use either an idle-liquidity buffer or a visible private redemption queue.
9. Emergency exits return strategy assets to a custody path without exposing per-user balances.
10. Share-price math and encrypted aggregate arithmetic have explicit overflow and precision bounds.
11. Batchers, wrappers and vault addresses are registry-verified before a production migration.
12. Mainnet integration is fork-tested against the deployed batcher bytecode before user principal is enabled.

## Production adapter milestones

The next production protocol version should be implemented in this order:

1. Add a strategy custody contract that accepts only confidential cUSDC from the pool.
2. Track encrypted idle principal separately from encrypted strategy principal.
3. Join the official deposit batcher via confidential transfer-and-call.
4. Track the dispatched batch ID and pending encrypted deposit liability.
5. Claim csteakcUSDC after the batch finalizes.
6. Track confidential share inventory separately from the user's cUSDC-denominated liability.
7. Add a private redemption queue and idle-liquidity target.
8. Redeem only the share amount needed for withdrawals and realized prize yield.
9. Route only returned cUSDC above protected liabilities into `VeilYieldSource`.
10. Fork-test the complete mainnet round trip before activating the adapter.

The current competition contracts intentionally stop before step 1 because that version cannot be validated on Sepolia
against the live mainnet batchers.

## Cadence

UNVEIL targets daily production prize draws. The competition deployment uses a shorter contract-configured period so a
reviewer can watch a full encrypted round.

Draw cadence and strategy settlement cadence do not need to be identical. A draw can finalize before its prize is ready.
The UI should show `winner proved · yield settling` until the strategy seals realized confidential cUSDC and a
permissionless keeper routes it.

## Source references

The production design above is based on the current Zama-owned sources rather than inferred selectors:

- Zama Protocol Apps Ethereum address registry.
- Zama Protocol Apps confidential wrapper documentation and source.
- Zama Protocol Apps deployed-batcher manifest used by mainnet fork tests.
- Zama Protocol Apps `IVaultBatcher` ABI used by those fork tests.
- Zama Protocol Apps `BatcherFlows` and `BatcherForkBase` tests for the live batch lifecycle.
- Zama Protocol Registry for current mainnet contract addresses.

The exact deployment addresses and implementation versions must be re-verified immediately before production use.
