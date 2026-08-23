# UNVEIL production yield path

UNVEIL separates the Sepolia prize flow from the production yield integration.

That boundary is intentional.

The draw protocol can be tested end to end without pretending that deterministic testnet yield came from a live venue.

## Sepolia competition deployment

The competition stack uses Zama's official Sepolia `cUSDCMock` wrapper.

- `cUSDCMock`: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- mock USDC underlying: `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`

The strategy operator transfers actual confidential cUSDC into `VeilYieldSource`.

It seals the current round's encrypted realized-yield bucket after the draw closes.

Routing and prize delivery are then permissionless.

The strategy operator cannot choose the winner.

A keeper cannot redirect a sealed bucket to another round or beneficiary.

This proves the confidential accounting and prize-delivery path.

It does not claim that deterministic Sepolia yield was produced by Morpho or another live market.

## Verified production venue

Zama's Steakhouse confidential USDC route is live on Ethereum mainnet.

Zama's own protocol-apps fork tests identify the exact deployed path.

Current published addresses:

- cUSDC: `0xe978F22157048E5DB8E5d07971376e86671672B2`
- csteakcUSDC: `0x66Bf74E96900D1a19c7070D939D124f2F565C458`
- Steakhouse USDC Prime ERC-4626 vault: `0xbEEF00A59B577423653A1526c7009bdE103F542B`
- confidential deposit batcher: `0x324EA89FD3784036673BfE6Ffee2334A088F40Cc`
- confidential redeem batcher: `0x96Cd3Faa7483783Ac2Eb715f6333361500F1eec9`

Zama's manifest states that the deposit batcher routes `cUSDC -> csteakcUSDC` through `IERC4626.deposit`.

The redeem batcher routes `csteakcUSDC -> cUSDC` through `IERC4626.redeem`.

The reviewed ABI is mirrored in `contracts/interfaces/IZamaVaultBatcher.sol`.

Mainnet addresses must still be checked against Zama's registry immediately before production deployment.

## Exact asynchronous batch lifecycle

The live batchers do not expose a synchronous strategy deposit that UNVEIL can safely treat as instant.

Zama's current integration tests drive this lifecycle:

1. Confidential tokens enter through the wrapper's `confidentialTransferAndCall` path.
2. The batcher records the encrypted per-account deposit in the current batch.
3. After `minBatchAge`, a permissionless caller can call `dispatchBatch()`.
4. Dispatch creates an asynchronous confidential unwrap request.
5. The unwrap handle is publicly decrypted with a KMS proof.
6. `dispatchBatchCallback(batchId, cleartext, proof)` completes the public ERC-4626 leg.
7. The output asset is wrapped confidentially.
8. `claim(batchId, account)` returns encrypted destination tokens.
9. A pending participant may call `quit(batchId)` before irreversible progress.

The deposit and redeem batchers use the same interface in opposite directions.

The production adapter therefore needs explicit batch state.

It must not collapse this sequence into a fake synchronous abstraction.

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

A production strategy needs explicit state for:

- idle confidential cUSDC
- pending deposit batch
- active confidential Steakhouse shares
- pending redemption batch
- returned confidential cUSDC
- protected user-principal liability
- realized prize yield

Yield is not realized until confidential cUSDC returns from the redemption path.

Only then can it enter UNVEIL prize-yield custody.

## Why this is not wired into the Sepolia pool

The official Steakhouse confidential wrapper and deployed batchers are Ethereum-mainnet infrastructure.

They are not the contracts used by the Sepolia competition app.

Moving saver principal into the live asynchronous route also changes withdrawal semantics.

A correct integration needs private pending-share accounting and delayed-redemption accounting.

It also needs an idle-liquidity buffer or private withdrawal queue, failure recovery and bounded-liability math.

Adding an untested mainnet path to the competition pool would make custody less correct.

UNVEIL instead pins the real production ABI and addresses and proves the strategy boundary on Sepolia.

The asynchronous principal adapter remains an explicit future protocol version.

## Required production invariants

1. User principal remains separately accounted from prize yield.
2. Only returned cUSDC above protected liabilities can enter a prize bucket.
3. A keeper cannot decrypt strategy balances merely because it advances a batch.
4. A keeper cannot choose the destination round for a sealed yield bucket.
5. A keeper cannot choose or redirect the winner.
6. Strategy or batch failure cannot mutate historical draw snapshots.
7. Pending batch latency is represented explicitly in protocol and UI state.
8. Withdrawals use an idle-liquidity buffer or a visible private redemption queue.
9. Emergency exits return strategy assets without exposing per-user balances.
10. Share-price math and encrypted aggregates have explicit overflow and precision bounds.
11. Batchers, wrappers and vault addresses are registry-verified before migration.
12. Mainnet integration is fork-tested against deployed bytecode before user principal is enabled.

## Production adapter milestones

The next production protocol version should be implemented in this order:

1. Add strategy custody that accepts only confidential cUSDC from the pool.
2. Track encrypted idle principal separately from encrypted strategy principal.
3. Join the official deposit batcher via confidential transfer-and-call.
4. Track the dispatched batch ID and pending encrypted deposit liability.
5. Claim csteakcUSDC after the batch finalizes.
6. Track confidential share inventory separately from cUSDC-denominated liabilities.
7. Add a private redemption queue and idle-liquidity target.
8. Redeem only the shares needed for withdrawals and realized prize yield.
9. Route only returned cUSDC above protected liabilities into `VeilYieldSource`.
10. Fork-test the full mainnet round trip before activating the adapter.

The competition contracts intentionally stop before step 1.

That version cannot be validated on Sepolia against the live mainnet batchers.

## Cadence

UNVEIL targets daily production prize draws.

The competition deployment uses a shorter period so a reviewer can watch a full encrypted round.

Draw cadence and strategy settlement cadence do not need to be identical.

A draw can finalize before its prize is ready.

The UI can show `winner proved · yield settling` until realized confidential cUSDC is sealed and routed.

## Source references

This design is based on current Zama-owned sources rather than inferred selectors:

- Zama Protocol Apps Ethereum address registry.
- Zama Protocol Apps confidential wrapper documentation and source.
- Zama Protocol Apps deployed-batcher manifest used by mainnet fork tests.
- Zama Protocol Apps `IVaultBatcher` ABI used by those fork tests.
- Zama Protocol Apps `BatcherFlows` and `BatcherForkBase` tests.
- Zama Protocol Registry for current mainnet contract addresses.

Re-verify deployment addresses and implementation versions immediately before production use.
