# UNVEIL V4 Sepolia Deployment

Status: deployed successfully on Ethereum Sepolia.

Network: Sepolia  
Chain ID: 11155111  
Asset mode: SEPOLIA TESTNET / DEMO ASSET  
Confidential principal symbol: `t-cUSDC`

## Runtime configuration

- Draw period: 900 seconds
- Batch age: 120 seconds
- Buffer reserve: 2000 BPS
- Valuation haircut: 0 BPS
- Draw model: 24 shards × 24 seats = 576 active savers
- Prize slots: 3
- Maturity: one complete draw period

## Contract addresses

| Component | Address |
| --- | --- |
| MockUSDC | `0x3E6CF78DC80ccc4921fBd641C937AA80fD2BE6a4` |
| Principal confidential wrapper (`t-cUSDC`) | `0xE792dddcbe8a112CeA2061B02822A4ba041F21AD` |
| Mock ERC4626 strategy | `0xE0F130b9e5667486C2fA6Ddf8c701362ac865609` |
| Strategy-share confidential wrapper | `0x616B2e4d1eBa6F6c846E046f80557c2fBc8d4C81` |
| Deposit batcher | `0xF43CB3bf5Af83c874EC801e2a912B55faE51937A` |
| Withdrawal batcher | `0x26B9A8BDB7b1d1cDbA4c3f22C49b4Ea060aEb2c1` |
| VeilPoolV4 | `0x7d52f69d129D298BDDD6Deeb838541e020Cc265f` |
| VeilPrizeVaultV3 | `0xbfcc93BbB2121a69b9E0516E4039122BFFaFbD11` |
| VeilStrategyManagerV3 | `0xdEf45aC259025b2833030DCC42aCD66225A0f3d1` |

## Deployment transactions

| Step | Transaction |
| --- | --- |
| MockUSDC | `0x7a3cb30f6fdb1a0d601d85eba07a870fe5f26ab9a0124bf1100b0674729323ef` |
| Principal wrapper | `0x2a7ef0af0217779589c41cff3758bf5dd3e2c799bb7c592be963e2125aa1b915` |
| Mock ERC4626 strategy | `0x38c0843316adb6ab459654e3385f006cc46e187c2b4e73c342b6bc596c6e4c1e` |
| Strategy-share wrapper | `0x7dc58f1bc6574f24aaf4148ceaefcbaa0070f189f95ab0f02b60e278c596816b` |
| Deposit batcher | `0x42a7d82e261e4f845672bd7d466fde3a0ebf463820c97780d847a17ea5367292` |
| Withdrawal batcher | `0x739fdc446f21f5b56e233d46ccbb3beaa9c964b7b1ef3af96a1e10615a5a8003` |
| VeilPoolV4 | `0x7913993996679e99ef73cf8851549c1480836ac2f50fc4ec5132af9b95ea2423` |
| VeilPrizeVaultV3 | `0xa54dc78cc53a2af93947886530c21448bd71127a555508b87b5815645d1fcc2f` |
| VeilStrategyManagerV3 | `0xdef19cfe903461872e90afd7e460cddbf3048a23ad2735af5b1d13c5902da808` |
| Configure strategy manager | `0x8b1aaf915bc4c177bc7e6e334261c1a8fd5a5cea302c148c16868151c8ab13bd` |

## Deployment validation

The deployment command compiled the V4 stack successfully, deployed all nine fresh `UNVEIL_V4_*` records, configured the strategy manager, and completed the deployment script's post-deployment runtime checks before printing the final summary.

Those checks cover pool/manager/prize-vault wiring, principal/share/vault/batcher routes, draw period, 24-shard count, 24-seat shard size, 576-saver maximum, 3 prize slots, batch age, buffer reserve, and valuation haircut.

The compiler emitted the OpenZeppelin EIP-1153 transient-storage warning while compiling dependencies. The deployment itself completed successfully.

## Validation status

Before deployment, the branch had already passed the full local protocol regression (`210 passing`), the dedicated V4 deployment test (`4 passing`), TypeScript build, Solidity lint, TypeScript lint, and Prettier check.

A separate live V4 end-to-end Sepolia smoke flow should be recorded after it is executed. This deployment document does not claim that an end-to-end live sharded draw has already been completed on these addresses.
