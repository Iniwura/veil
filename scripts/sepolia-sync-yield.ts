import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import { deployments, ethers, fhevm, network } from "hardhat";

import { VeilPool, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const CUSDC_UNIT = 1_000_000n;

const WRAPPER_ABI = [
  "function underlying() view returns (address)",
  "function setOperator(address operator,uint48 until)",
  "function isOperator(address holder,address spender) view returns (bool)",
  "function wrap(address to,uint256 amount) returns (bytes32)",
] as const;

const UNDERLYING_ABI = [
  "function mint(address to,uint256 amount)",
  "function approve(address spender,uint256 amount) returns (bool)",
] as const;

async function address(name: string, envName: string) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  const deployment = await deployments.getOrNull(name);
  if (!deployment) throw new Error(`Missing ${envName} and no ${name} deployment exists for ${network.name}`);
  return deployment.address;
}

function wrapperFor(assetAddress: string, signer: HardhatEthersSigner) {
  return new Contract(assetAddress, WRAPPER_ABI, signer);
}

function underlyingFor(underlyingAddress: string, signer: HardhatEthersSigner) {
  return new Contract(underlyingAddress, UNDERLYING_ABI, signer);
}

async function fundDemoYieldAsset(assetAddress: string, strategy: HardhatEthersSigner, amount: bigint) {
  if (amount === 0n) return;

  const wrapper = wrapperFor(assetAddress, strategy);
  const underlyingAddress = (await wrapper.underlying()) as string;
  const underlying = underlyingFor(underlyingAddress, strategy);

  await (await underlying.mint(strategy.address, amount)).wait();
  await (await underlying.approve(assetAddress, amount)).wait();
  await (await wrapper.wrap(strategy.address, amount)).wait();
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run on Sepolia: npx hardhat run scripts/sepolia-sync-yield.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();
  const [strategy] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!strategy) throw new Error("Missing configured Sepolia strategy signer");

  const poolAddress = await address("VeilPool", "UNVEIL_POOL_ADDRESS");
  const yieldSourceAddress = await address("VeilYieldSource", "UNVEIL_YIELD_SOURCE_ADDRESS");
  const wholeCusdc = BigInt(process.env.UNVEIL_REALIZED_YIELD?.trim() || "15");
  if (wholeCusdc < 0n || wholeCusdc > 18_446_744_073_709n) {
    throw new Error("UNVEIL_REALIZED_YIELD is out of range");
  }
  const amount = wholeCusdc * CUSDC_UNIT;

  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;
  const assetAddress = process.env.UNVEIL_ASSET_ADDRESS?.trim() || (await pool.asset());
  const wrapper = wrapperFor(assetAddress, strategy);

  if ((await yieldSource.strategyOperator()).toLowerCase() !== strategy.address.toLowerCase()) {
    throw new Error(
      `Configured signer ${strategy.address} is not strategy operator ${await yieldSource.strategyOperator()}`,
    );
  }

  const roundId = await yieldSource.yieldRoundId();
  if (await yieldSource.yieldReady()) {
    console.log(`UNVEIL round ${roundId} yield is already sealed. Nothing to do.`);
    return;
  }

  if (roundId >= (await pool.nextRoundId())) {
    throw new Error(
      `Round ${roundId} is still open or has not produced an eligible snapshot. Yield cannot be sealed yet.`,
    );
  }

  console.log("UNVEIL Sepolia strategy sync");
  console.log(`  strategy:    ${strategy.address}`);
  console.log(`  round:       ${roundId}`);
  console.log(`  cUSDC:       ${assetAddress}`);
  console.log(`  yieldSource: ${yieldSourceAddress}`);
  console.log(`  demo yield:  ${wholeCusdc} cUSDC`);

  if (amount > 0n) {
    console.log("1/4 Minting mock USDC and wrapping it through Zama's official cUSDC wrapper...");
    await fundDemoYieldAsset(assetAddress, strategy, amount);

    if (!(await wrapper.isOperator(strategy.address, yieldSourceAddress))) {
      console.log("2/4 Authorizing the yield adapter to receive confidential cUSDC...");
      await (await wrapper.setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();
    } else {
      console.log("2/4 Yield adapter already authorized.");
    }

    console.log("3/4 Encrypting and accruing realized strategy yield...");
    const encrypted = await fhevm.createEncryptedInput(yieldSourceAddress, strategy.address).add64(amount).encrypt();
    await (await yieldSource.connect(strategy).accrueYield(encrypted.handles[0], encrypted.inputProof)).wait();
  } else {
    console.log("1/4 No strategy transfer required for this legitimate zero-yield round.");
    console.log("2/4 No confidential operator change required.");
    console.log("3/4 Encrypted yield bucket remains zero without publishing a special zero-prize branch.");
  }

  console.log("4/4 Sealing the closed round's confidential yield bucket for permissionless routing...");
  await (await yieldSource.connect(strategy).sealRoundYield()).wait();

  if (!(await yieldSource.yieldReady())) throw new Error("Yield readiness was not persisted");
  console.log(`UNVEIL round ${roundId} yield is sealed. Any keeper may now route it after winner finalization.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
