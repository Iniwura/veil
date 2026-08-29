# UNVEIL V3 Sepolia Deployment

Status: deployed successfully on Ethereum Sepolia.

Network: Sepolia Chain ID: 11155111 Asset mode: SEPOLIA TESTNET / DEMO ASSET Confidential principal symbol: `t-cUSDC`
User-facing demo asset label: `cUSDC`

## Runtime configuration

- Draw period: 900 seconds
- Batch age: 120 seconds
- Buffer reserve: 2000 BPS
- Valuation haircut: 0 BPS
- Draw model: 24 seats, 3 prize slots, boundary maturity

## Contract addresses

| Component                                  | Address                                      |
| ------------------------------------------ | -------------------------------------------- |
| MockUSDC                                   | `0xA10dEAb98E31892318ddF938eca4Be44BD710B5c` |
| Principal confidential wrapper (`t-cUSDC`) | `0xf4D3785c82421597d2f9C725d797F78E20f7eC3c` |
| Mock ERC4626 strategy                      | `0x70f78e13ead7a012C88384534ae3798B89026a52` |
| Strategy-share confidential wrapper        | `0x5a697D883c078222C9f8452F5593aC4EdABB49C2` |
| Deposit batcher                            | `0xC888D15AA96679eEDcEfAd137E00068b1bAaea0e` |
| Withdrawal batcher                         | `0x200Db9c328Be314C8d6586e8DA3573f556353969` |
| VeilPoolV3                                 | `0x7307AF2a3f4690554CaeDc4b1496b813F2A9836b` |
| VeilPrizeVaultV3                           | `0xbb868C1189b9822E321FDC94Dc641D2311acfF81` |
| VeilStrategyManagerV3                      | `0x9eA6E4553151bC2b9F86f8a3F2e85A8C9D05Bb7b` |

## Deployment transactions

| Step                       | Transaction                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| MockUSDC                   | `0x5761d5bec1ecfb2f554a3ab526617ae7bc6a86437376fbaa729d9af96c9cfb60` |
| Principal wrapper          | `0x0782bccfbaa3a452f8024138567fe84a656484496a8883d962f2bc131f0da5de` |
| Mock ERC4626 strategy      | `0xe8779a38adaae8dc99df19c413a356b880a4f2801692fa7e2b63f40eb0bbcd16` |
| Strategy-share wrapper     | `0x7bddc3473bbbf53ffa958e37a3bb25b732a65bd060a872b60a7113c4bf231ea2` |
| Deposit batcher            | `0x1240141ff0879d6ad0018a1662c26aebd8ff07142ae3d8abb9d91c8b9e24eafc` |
| Withdrawal batcher         | `0xbc93f13ab40e056b125a74890c8fbd70f1e9e5f8b20ea309e80748ed75993d5a` |
| VeilPoolV3                 | `0x5ac1f36c83bd883fb8a168ee3160a5facff07890c657111e0154a1a5ee715c23` |
| VeilPrizeVaultV3           | `0xb02f9e9b6255f4d1a86642ec30aa1bd3197727f914155c28723a0bbb86a5a9f6` |
| VeilStrategyManagerV3      | `0xca6056824674b3b550c11ca12874949d31defd0596234a6577ced38584eb91e4` |
| Configure strategy manager | `0xc2b7ec4eae2717088dfe11a6984c7ec478ba34402047c701870a2657d9ca597f` |

## Deployment validation

The deployment script completed its post-deployment runtime checks before printing the final summary. Those checks
include the V3 pool/manager/prize-vault wiring, principal/share/vault/batcher routes, draw period, 24-seat cap, 3 prize
slots, batch age, buffer reserve, and valuation haircut.

The existing V2 Sepolia stack was not reused or overwritten. V3 uses separate `UNVEIL_V3_*` deployment records.

## Frontend status

The V3 contracts are live, but the frontend must not simply swap addresses yet. The current client still uses V2
single-winner and single-prize ABI/lifecycle methods. Frontend V3 activation requires the multi-prize
draw/finalization/delivery flow and the principal-coverage attestation UI/client support first.
