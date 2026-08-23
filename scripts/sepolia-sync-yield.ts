import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network, deployments } from "hardhat";

import { MockConfidentialToken, VeilPool, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;

async function address(name: string, envName: string) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  const deployment = await deployments.getOrNull(name);
  if (!deployment) throw new Error(`Missing ${envName} and no ${name} deployment exists for ${network.name}`);
  return deployment.address;
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run on Sepolia: npx hardhat run scripts/sepolia-sync-yield.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();
  const [strategy] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!strategy) throw new Error("Missing configured Sepolia strategy signer");

  const assetAddress = await address("MockConfidentialToken", "UNVEIL_ASSET_ADDRESS");
  const poolAddress = await address("VeilPool", "UNVEIL_POOL_ADDRESS");
  const yieldSourceAddress = await address("VeilYieldSource", "UNVEIL_YIELD_SOURCE_ADDRESS");
  const amount = BigInt(process.env.UNVEIL_REALIZED_YIELD?.trim() || "15");
  if (amount < 0n || amount > 18_446_744_073_709_551_615n) throw new Error("UNVEIL_REALIZED_YIELD is out of range");

  const token = (await ethers.getContractAt("MockConfidentialToken", assetAddress)) as MockConfidentialToken;
  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;

  if ((await yieldSource.strategyOperator()).toLowerCase() !== strategy.address.toLowerCase()) {
    throw new Error(`Configured signer ${strategy.address} is not strategy operator ${await yieldSource.strategyOperator()}`);
  }

  const roundId = await yieldSource.yieldRoundId();
  if (await yieldSource.yieldReady()) {
    console.log(`UNVEIL round ${roundId} yield is already sealed. Nothing to do.`);
    return;
  }

  if (roundId >= (await pool.nextRoundId())) {
    throw new Error(`Round ${roundId} is still open or has not produced an eligible snapshot. Yield cannot be sealed yet.`);
  }

  console.log("UNVEIL Sepolia strategy sync");
  console.log(`  strategy:    ${strategy.address}`);
  console.log(`  round:       ${roundId}`);
  console.log(`  yieldSource: ${yieldSourceAddress}`);
  console.log(`  demo yield:  ${amount} confidential token units`);

  if (amount > 0n) {
    if (!(await token.isOperator(strategy.address, yieldSourceAddress))) {
      console.log("1/3 Authorizing the yield adapter to receive confidential strategy assets...");
      await (await token.connect(strategy).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();
    } else {
      console.log("1/3 Yield adapter already authorized.");
    }

    console.log("2/3 Encrypting and accruing realized strategy yield...");
    const encrypted = await fhevm.createEncryptedInput(yieldSourceAddress, strategy.address).add64(amount).encrypt();
    await (await yieldSource.connect(strategy).accrueYield(encrypted.handles[0], encrypted.inputProof)).wait();
  } else {
    console.log("1/3 No strategy transfer required for this legitimate zero-yield round.");
    console.log("2/3 Encrypted yield bucket remains zero without publishing a special zero-prize branch.");
  }

  console.log("3/3 Sealing the closed round's confidential yield bucket for permissionless routing...");
  await (await yieldSource.connect(strategy).sealRoundYield()).wait();

  if (!(await yieldSource.yieldReady())) throw new Error("Yield readiness was not persisted");
  console.log(`UNVEIL round ${roundId} yield is sealed. Any keeper may now route it after winner finalization.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
