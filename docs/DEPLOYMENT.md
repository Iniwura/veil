# VEIL Sepolia deployment

VEIL uses Hardhat Deploy and Zama's fhEVM Hardhat integration. The deployment script creates and wires the pool, yield
source, and prize vault in one reviewable flow.

## 1. Configure Hardhat secrets

Store secrets with Hardhat vars instead of committing them:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat vars set ETHERSCAN_API_KEY
```

`SEPOLIA_RPC_URL` is preferred. `INFURA_API_KEY` remains supported as a fallback for the template's Infura URL.

The deployer must have Sepolia ETH before deployment.

## 2. Choose the confidential asset

For a real deployment, provide an existing compatible confidential asset address:

```bash
export VEIL_ASSET_ADDRESS=0x...
npm run deploy:sepolia
```

`VeilPool`, `VeilYieldSource`, and `VeilPrizeVault` will all use that same asset.

### Test-only Sepolia asset

`MockConfidentialToken` has unrestricted minting and exists only for protocol integration tests and controlled demos. It
must never be presented as a production asset.

A Sepolia deployment will refuse to deploy it unless the choice is explicit:

```bash
VEIL_DEPLOY_DEMO_ASSET=true npm run deploy:sepolia
```

## 3. Deployment wiring

The deployment script performs these steps in order:

1. Uses `VEIL_ASSET_ADDRESS`, or deploys the explicitly requested test-only asset.
2. Deploys `VeilPool(asset)`.
3. Deploys `VeilYieldSource(asset)`.
4. Deploys `VeilPrizeVault(pool, asset, yieldSource)`.
5. Configures `VeilYieldSource` to point to the deployed prize vault.
6. Refuses to overwrite a previously configured prize-vault address.

The final console output prints the four addresses needed by the demo frontend.

## 4. Verification

Compile and test locally before any network deployment:

```bash
npm run compile
npm run build:ts
npm test
npm run lint
```

After a successful Sepolia deployment, verify each contract with the exact constructor arguments used by the deployment.
Do not claim a deployment is successful until the network transaction receipts and deployed bytecode are confirmed.

## Privacy boundary

Deployment does not change VEIL's FHE access policy. Individual principal, snapshot weights, withdrawals, unallocated
yield, and prize amounts remain encrypted. The finalized winner address is public because settlement requires it. The
prize ciphertext is authorized only to the finalized winner.
