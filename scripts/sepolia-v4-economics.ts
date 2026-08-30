import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  VeilDepositBatcher,
  VeilPoolV4,
  VeilPrizeVaultV3,
  VeilStrategyManagerV3,
} from "../types";
import { V4_DEPLOYMENT_NAMES } from "../deploy/deploy-v4";
import { findManagerDepositBatchToResume, managerDepositResumeAction } from "./v2-smoke-state";

const TARGET_ROUND = 4n;
const DEMO_DONATION = 50n;
const MAX_DEPOSIT_RESUME_STEPS = 24;
const MAX_CANCELED_DEPOSIT_RETRIES = 3;

const V4_ADDRESS_ENV = {
  asset: "UNVEIL_V4_MOCK_USDC_ADDRESS",
  principal: "UNVEIL_V4_PRINCIPAL_WRAPPER_ADDRESS",
  vault: "UNVEIL_V4_MOCK_YIELD_VAULT_ADDRESS",
  depositBatcher: "UNVEIL_V4_DEPOSIT_BATCHER_ADDRESS",
  pool: "UNVEIL_V4_POOL_ADDRESS",
  prizeVault: "UNVEIL_V4_PRIZE_VAULT_ADDRESS",
  manager: "UNVEIL_V4_MANAGER_ADDRESS",
} as const;

type AddressKey = keyof typeof V4_ADDRESS_ENV;
type V4Addresses = Record<AddressKey, string>;

type System = {
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  deposits: VeilDepositBatcher;
  pool: VeilPoolV4;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV3;
};

async function resolveAddress(key: AddressKey): Promise<string> {
  const envName = V4_ADDRESS_ENV[key];
  const configured = process.env[envName];
  if (configured !== undefined) {
    const value = configured.trim();
    if (!ethers.isAddress(value)) throw new Error(`${envName} is not a valid address`);
    return value;
  }

  try {
    return (await deployments.get(V4_DEPLOYMENT_NAMES[key])).address;
  } catch {
    throw new Error(`Missing ${V4_DEPLOYMENT_NAMES[key]} or ${envName}; refusing to guess the live V4 address.`);
  }
}

async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Latest Sepolia block unavailable");
  return block.timestamp;
}

async function waitForRealTime(label: string, target: number): Promise<boolean> {
  const current = await latestTimestamp();
  if (current >= target) return true;

  console.log(`  ${label} is not mature; target Unix timestamp: ${target}`);
  if (process.env.UNVEIL_V4_ECONOMICS_WAIT !== "true") {
    console.log("  Exiting safely. Re-run with UNVEIL_V4_ECONOMICS_WAIT=true to wait and continue.");
    return false;
  }

  while (true) {
    const remaining = target - (await latestTimestamp());
    if (remaining <= 0) return true;
    console.log(`  waiting ${remaining}s for ${label}...`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Math.max(1_000, remaining * 1_000))));
  }
}

async function proveAndCallbackDeposit(
  batcher: VeilDepositBatcher,
  principal: MockUSDCConfidentialWrapper,
  batchId: bigint,
): Promise<void> {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await principal.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await batcher.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function finishOutstandingDepositBatch(system: System): Promise<boolean> {
  let canceledRetries = 0;

  for (let step = 0; step < MAX_DEPOSIT_RESUME_STEPS; step++) {
    const batch = await findManagerDepositBatchToResume(system.manager, system.deposits);
    if (!batch || batch.resolved) return true;

    const action = managerDepositResumeAction(batch);
    console.log(`  existing manager deposit batch ${batch.batchId}: action=${action}`);

    if (action === "WAIT_AND_DISPATCH") {
      const openedAt = Number(await system.deposits.currentBatchOpenedAt());
      const age = Number(await system.deposits.minimumBatchAge());
      if (!(await waitForRealTime(`deposit batch ${batch.batchId}`, openedAt + age))) return false;
      await (await system.deposits.dispatchBatch()).wait();
      continue;
    }
    if (action === "PUBLIC_CALLBACK") {
      await proveAndCallbackDeposit(system.deposits, system.principal, batch.batchId);
      continue;
    }
    if (action === "RESOLVE_FINALIZED" || action === "RESOLVE_CANCELED") {
      await (await system.manager.resolveDepositBatch(batch.batchId)).wait();
      if (action === "RESOLVE_CANCELED") {
        canceledRetries++;
        if (canceledRetries > MAX_CANCELED_DEPOSIT_RETRIES) {
          throw new Error("V4 strategy deposit batches canceled repeatedly; manual review required");
        }
      }
      continue;
    }
    if (action === "COMPLETE") return true;
    if (action === "RETRY_CANCELED") return true;
    if (action === "INVEST") return true;
  }

  throw new Error("Outstanding V4 deposit-batch recovery exceeded its bounded step limit");
}

async function investCurrentExcessAndResolve(system: System): Promise<boolean> {
  if (!(await finishOutstandingDepositBatch(system))) return false;

  const currentBatchId = await system.deposits.currentBatchId();
  if (await system.manager.managerDepositBatch(currentBatchId)) {
    const resolved = await system.manager.managerDepositBatchResolved(currentBatchId);
    if (!resolved) throw new Error(`Current manager deposit batch ${currentBatchId} remains unresolved`);
    console.log(`  current batch ${currentBatchId} is already a resolved manager batch; no second investment submitted`);
    return true;
  }

  console.log(`  investing current confidential excess into deposit batch ${currentBatchId}`);
  await (await system.manager.investExcess()).wait();

  for (let step = 0; step < MAX_DEPOSIT_RESUME_STEPS; step++) {
    const batch = await findManagerDepositBatchToResume(system.manager, system.deposits);
    if (!batch || batch.batchId !== currentBatchId) {
      throw new Error(`Expected manager deposit batch ${currentBatchId} after investExcess`);
    }

    const action = managerDepositResumeAction(batch);
    console.log(`  deposit batch ${batch.batchId}: action=${action}`);

    if (action === "WAIT_AND_DISPATCH") {
      const openedAt = Number(await system.deposits.currentBatchOpenedAt());
      const age = Number(await system.deposits.minimumBatchAge());
      if (!(await waitForRealTime(`deposit batch ${batch.batchId}`, openedAt + age))) return false;
      await (await system.deposits.dispatchBatch()).wait();
      continue;
    }
    if (action === "PUBLIC_CALLBACK") {
      await proveAndCallbackDeposit(system.deposits, system.principal, batch.batchId);
      continue;
    }
    if (action === "RESOLVE_FINALIZED") {
      await (await system.manager.resolveDepositBatch(batch.batchId)).wait();
      continue;
    }
    if (action === "RESOLVE_CANCELED") {
      await (await system.manager.resolveDepositBatch(batch.batchId)).wait();
      throw new Error(`V4 deposit batch ${batch.batchId} canceled; principal was refunded. Review before retrying.`);
    }
    if (action === "COMPLETE") return true;
    if (action === "RETRY_CANCELED") {
      throw new Error(`V4 deposit batch ${batch.batchId} was canceled and resolved. Review before retrying.`);
    }
    if (action === "INVEST") throw new Error("Manager investment disappeared before the batch was recognized");
  }

  throw new Error("V4 investment resume exceeded its bounded step limit");
}

async function simulateYield(system: System, caller: HardhatEthersSigner, addresses: V4Addresses): Promise<void> {
  const totalAssets = await system.vault.totalAssets();
  const totalShares = await system.vault.totalSupply();

  if (totalShares === 0n) throw new Error("Strategy vault has no shares after investment; refusing to simulate yield");
  if (totalAssets < totalShares) throw new Error("Strategy vault is already below par; refusing to simulate yield");

  if (totalAssets === totalShares) {
    console.log(`  simulating ${DEMO_DONATION} TEST units of ERC4626 appreciation`);
    await (await system.asset.mint(caller.address, DEMO_DONATION)).wait();
    await (await system.asset.connect(caller).approve(addresses.vault, DEMO_DONATION)).wait();
    await (await system.vault.connect(caller).donate(DEMO_DONATION)).wait();
  } else {
    console.log("  simulated appreciation already exists; not donating again");
  }

  console.log(`  vault totalAssets=${await system.vault.totalAssets()} totalSupply=${await system.vault.totalSupply()}`);
}

async function loadSystem(addresses: V4Addresses): Promise<System> {
  return {
    asset: (await ethers.getContractAt("MockUSDC", addresses.asset)) as MockUSDC,
    principal: (await ethers.getContractAt(
      "MockUSDCConfidentialWrapper",
      addresses.principal,
    )) as MockUSDCConfidentialWrapper,
    vault: (await ethers.getContractAt("MockYieldVault4626", addresses.vault)) as MockYieldVault4626,
    deposits: (await ethers.getContractAt("VeilDepositBatcher", addresses.depositBatcher)) as VeilDepositBatcher,
    pool: (await ethers.getContractAt("VeilPoolV4", addresses.pool)) as VeilPoolV4,
    prizeVault: (await ethers.getContractAt("VeilPrizeVaultV3", addresses.prizeVault)) as VeilPrizeVaultV3,
    manager: (await ethers.getContractAt("VeilStrategyManagerV3", addresses.manager)) as VeilStrategyManagerV3,
  };
}

async function run(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("Run this helper only on Sepolia");

  await fhevm.initializeCLIApi();
  const [caller] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!caller) throw new Error("No Sepolia signer is configured in Hardhat vars");

  const addresses = Object.fromEntries(
    await Promise.all(
      (Object.keys(V4_ADDRESS_ENV) as AddressKey[]).map(async (key) => [key, await resolveAddress(key)] as const),
    ),
  ) as V4Addresses;
  const system = await loadSystem(addresses);

  const roundState = Number(await system.pool.getDrawState(TARGET_ROUND));
  const roundStatus = await system.prizeVault.roundStatus(TARGET_ROUND);
  const nextPrizeRoundId = await system.manager.nextPrizeRoundId();

  console.log("UNVEIL V4 Sepolia economics preparation");
  console.log(`  caller: ${caller.address}`);
  console.log(`  round ${TARGET_ROUND}: state=${roundState} funded=${Boolean(roundStatus.funded)}`);
  console.log(`  manager nextPrizeRoundId=${nextPrizeRoundId}`);

  if (Boolean(roundStatus.funded)) {
    console.log(`  Round ${TARGET_ROUND} is already funded. No economic preparation was changed.`);
    return;
  }
  if (roundState !== 3) throw new Error(`Round ${TARGET_ROUND} is not FINALIZED; refusing economic preparation`);
  if (nextPrizeRoundId !== TARGET_ROUND) {
    throw new Error(`Manager prize pointer is ${nextPrizeRoundId}, expected ${TARGET_ROUND}; refusing economic preparation`);
  }

  if (!(await investCurrentExcessAndResolve(system))) return;
  await simulateYield(system, caller, addresses);

  const finalRoundStatus = await system.prizeVault.roundStatus(TARGET_ROUND);
  if (Boolean(finalRoundStatus.funded)) {
    throw new Error(`Round ${TARGET_ROUND} became funded unexpectedly during preparation`);
  }

  console.log(`UNVEIL V4 Sepolia economics prep PASSED — Round ${TARGET_ROUND} remains unfunded and is ready for UI funding.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
