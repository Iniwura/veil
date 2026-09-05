import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV4,
  VeilPrizeVaultV3,
  VeilStrategyManagerV3,
} from "../types";
import { V4_DEPLOYMENT_NAMES } from "../deploy/deploy-v4";

/** Exactly 50 raw MockUSDC units (MockUSDC has six decimals). */
export const DEMO_DONATION = 50n;
const SEPOLIA_CHAIN_ID = 11_155_111n;
const MAX_BATCH_SCAN = 64n;
const MAX_RESUME_STEPS = 32;

export const EXPECTED_V4_ADDRESSES = {
  asset: "0x50c5b93aDc4c10a392b53125C545e760f12E9466",
  principal: "0x9Ff6F110cb3162033A25A597D4528bABbEe2cA41",
  vault: "0x2FcBa2fFc62010717272B3F2223F12730C4BF4b9",
  shares: "0xF0810ef8b962ac787df0fe5FEF492A75A054F55d",
  depositBatcher: "0x391cB3D0F60F443C3018bAC600C6EA90ee6497Fe",
  pool: "0xCC7d4642557FfE810a77D2CEce0206211d15aE57",
  prizeVault: "0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C",
  manager: "0x2bA25db644515af6Bb731025e71EE493B9D5d4Db",
} as const;

type AddressKey = keyof typeof EXPECTED_V4_ADDRESSES;
export type V4Addresses = Record<AddressKey, string>;

export type PrepBatch = {
  batchId: bigint;
  state: number;
  resolved: boolean;
  current: boolean;
};

export type PositivePrizePrepSnapshot = {
  nextRoundId: bigint;
  managerPrizeRoundId: bigint;
  targetDrawState: number;
  targetFunded: boolean;
  targetDeliveredCount: number;
  targetDelivered: boolean;
  vaultTotalAssets: bigint;
  vaultTotalSupply: bigint;
  shareWrapperUnderlyingBalance: bigint;
  currentBatchId: bigint;
  currentBatchMature: boolean;
  recognizedBatches: PrepBatch[];
  /** Optional caller-local values used to resume a partially completed donation safely. */
  donationBalance?: bigint;
  donationAllowance?: bigint;
};

export type PrepStepKind =
  | "INVEST"
  | "DISPATCH"
  | "PUBLIC_CALLBACK"
  | "RESOLVE"
  | "MINT_DONATION"
  | "APPROVE_DONATION"
  | "DONATE"
  | "WAIT_FOR_BATCH";

export type PrepStep = {
  kind: PrepStepKind;
  batchId?: bigint;
  amount?: bigint;
};

export type PrepPlan = {
  targetRoundId: bigint;
  steps: PrepStep[];
  dryRun: boolean;
  appreciationAlreadyPresent: boolean;
};

type System = {
  addresses: V4Addresses;
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  pool: VeilPoolV4;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV3;
};

function sameAddress(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function assertAddress(label: string, actual: string, expected: string): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`UNVEIL_V4 address mismatch for ${label}: ${actual} (expected ${expected})`);
  }
}

function assertBigint(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Pure state machine for the one-time preparation flow. It deliberately emits at most
 * one custody transition at a time when used by the runtime (the runtime re-reads state
 * after every receipt), so a rerun cannot invest, resolve, or donate twice.
 */
export function planPositivePrizePrep(snapshot: PositivePrizePrepSnapshot, dryRun = false): PrepPlan {
  const targetRoundId = snapshot.nextRoundId;
  if (snapshot.managerPrizeRoundId !== targetRoundId) {
    throw new Error(`Manager prize pointer ${snapshot.managerPrizeRoundId} does not equal target ${targetRoundId}`);
  }
  if (snapshot.targetDrawState < 0 || snapshot.targetDrawState > 3) {
    throw new Error(`Target round ${targetRoundId} has unsupported draw state ${snapshot.targetDrawState}`);
  }
  if (snapshot.targetFunded || snapshot.targetDeliveredCount !== 0 || snapshot.targetDelivered) {
    throw new Error(`Target prize round ${targetRoundId} is already funded or delivered`);
  }
  if (snapshot.vaultTotalAssets < snapshot.vaultTotalSupply) {
    throw new Error(`Vault is below par (assets=${snapshot.vaultTotalAssets}, supply=${snapshot.vaultTotalSupply})`);
  }
  if (snapshot.vaultTotalSupply === 0n && snapshot.shareWrapperUnderlyingBalance !== 0n) {
    throw new Error("Vault reports zero total supply but the share wrapper holds shares");
  }
  if (snapshot.vaultTotalSupply > 0n && snapshot.shareWrapperUnderlyingBalance === 0n) {
    throw new Error("Vault has shares but the configured confidential share wrapper holds none");
  }

  const unresolved = snapshot.recognizedBatches.filter((batch) => !batch.resolved);
  if (unresolved.length > 1) {
    throw new Error("Multiple unresolved manager deposit batches found; manual review required");
  }
  const canceled = snapshot.recognizedBatches.find((batch) => batch.resolved && batch.state === 3);
  if (canceled) {
    throw new Error(`Manager deposit batch ${canceled.batchId} was canceled; refusing an automatic retry`);
  }

  let steps: PrepStep[] = [];
  if (unresolved.length === 1) {
    const batch = unresolved[0];
    if (batch.state === 0) {
      if (!batch.current) {
        throw new Error(`Pending manager deposit batch ${batch.batchId} is no longer current`);
      }
      steps = [
        snapshot.currentBatchMature
          ? { kind: "DISPATCH", batchId: batch.batchId }
          : { kind: "WAIT_FOR_BATCH", batchId: batch.batchId },
      ];
    } else if (batch.state === 1) {
      steps = [{ kind: "PUBLIC_CALLBACK", batchId: batch.batchId }];
    } else if (batch.state === 2) {
      steps = [{ kind: "RESOLVE", batchId: batch.batchId }];
    } else if (batch.state === 3) {
      throw new Error(`Manager deposit batch ${batch.batchId} was canceled; refusing automatic recovery`);
    } else {
      throw new Error(`Manager deposit batch ${batch.batchId} has unknown state ${batch.state}`);
    }
  } else if (snapshot.vaultTotalSupply === 0n) {
    const finalized = snapshot.recognizedBatches.find((batch) => batch.resolved && batch.state === 2);
    if (finalized) {
      throw new Error(`Manager batch ${finalized.batchId} resolved but the vault has no shares`);
    }
    steps = [{ kind: "INVEST" }];
  } else if (snapshot.vaultTotalAssets === snapshot.vaultTotalSupply) {
    // When caller-local ERC20 state is available, emit only the next missing donation
    // transition. This makes a crash/restart between mint, approve, and donate safe.
    if (snapshot.donationBalance === undefined && snapshot.donationAllowance === undefined) {
      steps = [
        { kind: "MINT_DONATION", amount: DEMO_DONATION },
        { kind: "APPROVE_DONATION", amount: DEMO_DONATION },
        { kind: "DONATE", amount: DEMO_DONATION },
      ];
    } else if (snapshot.donationBalance === undefined || snapshot.donationBalance < DEMO_DONATION) {
      steps = [{ kind: "MINT_DONATION", amount: DEMO_DONATION }];
    } else if (snapshot.donationAllowance === undefined || snapshot.donationAllowance < DEMO_DONATION) {
      steps = [{ kind: "APPROVE_DONATION", amount: DEMO_DONATION }];
    } else {
      steps = [{ kind: "DONATE", amount: DEMO_DONATION }];
    }
  }

  return {
    targetRoundId,
    steps,
    dryRun,
    appreciationAlreadyPresent: snapshot.vaultTotalAssets > snapshot.vaultTotalSupply,
  };
}

export function formatPrepStep(step: PrepStep): string {
  const suffix = step.batchId === undefined ? "" : ` batch=${step.batchId}`;
  const amount = step.amount === undefined ? "" : ` amount=${step.amount}`;
  return `${step.kind}${suffix}${amount}`;
}

/** Executes a plan only when `apply` is true; useful for proving dry-run write safety. */
export async function executePlannedSteps(
  steps: PrepStep[],
  apply: boolean,
  execute: (step: PrepStep) => Promise<void>,
  log: (message: string) => void = () => undefined,
): Promise<void> {
  for (const step of steps) {
    log(`planned ${formatPrepStep(step)}`);
    if (apply) await execute(step);
  }
}

async function resolveAddresses(): Promise<V4Addresses> {
  const entries = await Promise.all(
    (Object.keys(EXPECTED_V4_ADDRESSES) as AddressKey[]).map(async (key) => {
      const deployment = await deployments.get(V4_DEPLOYMENT_NAMES[key]);
      const actual = deployment.address;
      assertAddress(key, actual, EXPECTED_V4_ADDRESSES[key]);
      return [key, actual] as const;
    }),
  );
  return Object.fromEntries(entries) as V4Addresses;
}

async function loadSystem(addresses: V4Addresses): Promise<System> {
  const system: System = {
    addresses,
    asset: (await ethers.getContractAt("MockUSDC", addresses.asset)) as MockUSDC,
    principal: (await ethers.getContractAt(
      "MockUSDCConfidentialWrapper",
      addresses.principal,
    )) as MockUSDCConfidentialWrapper,
    vault: (await ethers.getContractAt("MockYieldVault4626", addresses.vault)) as MockYieldVault4626,
    shares: (await ethers.getContractAt(
      "MockYieldVaultShareConfidentialWrapper",
      addresses.shares,
    )) as MockYieldVaultShareConfidentialWrapper,
    deposits: (await ethers.getContractAt("VeilDepositBatcher", addresses.depositBatcher)) as VeilDepositBatcher,
    pool: (await ethers.getContractAt("VeilPoolV4", addresses.pool)) as VeilPoolV4,
    prizeVault: (await ethers.getContractAt("VeilPrizeVaultV3", addresses.prizeVault)) as VeilPrizeVaultV3,
    manager: (await ethers.getContractAt("VeilStrategyManagerV3", addresses.manager)) as VeilStrategyManagerV3,
  };

  assertAddress("pool.asset", await system.pool.asset(), addresses.principal);
  assertAddress("pool.strategyManager", await system.pool.strategyManager(), addresses.manager);
  assertAddress("manager.pool", await system.manager.pool(), addresses.pool);
  assertAddress("manager.principalAsset", await system.manager.principalAsset(), addresses.principal);
  assertAddress("manager.strategyShareAsset", await system.manager.strategyShareAsset(), addresses.shares);
  assertAddress("manager.depositBatcher", await system.manager.depositBatcher(), addresses.depositBatcher);
  assertAddress("manager.vault", await system.manager.vault(), addresses.vault);
  assertAddress("manager.prizeVault", await system.manager.prizeVault(), addresses.prizeVault);
  assertAddress("vault.asset", await system.vault.asset(), addresses.asset);
  assertAddress("shares.underlying", await system.shares.underlying(), addresses.vault);
  return system;
}

async function recognizedBatches(system: System, currentBatchId: bigint): Promise<PrepBatch[]> {
  if (currentBatchId > MAX_BATCH_SCAN) {
    throw new Error(
      `Current deposit batch ${currentBatchId} exceeds bounded scan limit ${MAX_BATCH_SCAN}; manual review required`,
    );
  }
  const batches: PrepBatch[] = [];
  for (let batchId = currentBatchId; batchId >= 1n; batchId--) {
    if (await system.manager.managerDepositBatch(batchId)) {
      batches.push({
        batchId,
        state: Number(await system.deposits.batchState(batchId)),
        resolved: await system.manager.managerDepositBatchResolved(batchId),
        current: batchId === currentBatchId,
      });
    }
    if (batchId === 1n) break;
  }
  return batches;
}

async function readSnapshot(system: System, donationCaller?: string): Promise<PositivePrizePrepSnapshot> {
  const [nextRoundId, managerPrizeRoundId] = await Promise.all([
    system.pool.nextRoundId(),
    system.manager.nextPrizeRoundId(),
  ]);
  const targetDrawState = Number(await system.pool.getDrawState(nextRoundId));
  const status = await system.prizeVault.roundStatus(nextRoundId);
  const [totalAssets, totalSupply, shareBalance, currentBatchId, openedAt, minimumAge, latestBlock] = await Promise.all(
    [
      system.vault.totalAssets(),
      system.vault.totalSupply(),
      system.vault.balanceOf(system.addresses.shares),
      system.deposits.currentBatchId(),
      system.deposits.currentBatchOpenedAt(),
      system.deposits.minimumBatchAge(),
      ethers.provider.getBlock("latest"),
    ],
  );
  if (!latestBlock) throw new Error("Latest Sepolia block unavailable");
  const callerBalances = donationCaller
    ? await Promise.all([
        system.asset.balanceOf(donationCaller),
        system.asset.allowance(donationCaller, system.addresses.vault),
      ])
    : undefined;
  return {
    nextRoundId,
    managerPrizeRoundId,
    targetDrawState,
    targetFunded: status.funded,
    targetDeliveredCount: Number(status.deliveredCount),
    targetDelivered: status.delivered,
    vaultTotalAssets: totalAssets,
    vaultTotalSupply: totalSupply,
    shareWrapperUnderlyingBalance: shareBalance,
    currentBatchId,
    currentBatchMature: openedAt + minimumAge <= BigInt(latestBlock.timestamp),
    recognizedBatches: await recognizedBatches(system, currentBatchId),
    donationBalance: callerBalances?.[0],
    donationAllowance: callerBalances?.[1],
  };
}

async function assertTargetStillSafe(system: System, targetRoundId: bigint): Promise<void> {
  const [nextRoundId, managerPrizeRoundId, state, status] = await Promise.all([
    system.pool.nextRoundId(),
    system.manager.nextPrizeRoundId(),
    system.pool.getDrawState(targetRoundId),
    system.prizeVault.roundStatus(targetRoundId),
  ]);
  assertBigint(nextRoundId === targetRoundId, `Pool advanced from target round ${targetRoundId} to ${nextRoundId}`);
  assertBigint(
    managerPrizeRoundId === targetRoundId,
    `Manager prize pointer changed from target ${targetRoundId} to ${managerPrizeRoundId}`,
  );
  const numericState = Number(state);
  assertBigint(numericState >= 0 && numericState <= 3, `Target round has unsupported draw state ${numericState}`);
  assertBigint(
    !status.funded && status.deliveredCount === 0n && !status.delivered,
    `Target prize round ${targetRoundId} became funded or delivered`,
  );
}

async function publicCallback(system: System, batchId: bigint, targetRoundId: bigint): Promise<void> {
  await fhevm.initializeCLIApi();
  const requestId = await system.deposits.unwrapRequestId(batchId);
  const encryptedAmount = await system.principal.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const values = Object.values(result.clearValues);
  if (values.length !== 1) throw new Error(`Expected one public-decrypt value for batch ${batchId}`);
  const clearAmount = BigInt(values[0]);
  await assertTargetStillSafe(system, targetRoundId);
  await (await system.deposits.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function executeStep(system: System, step: PrepStep, caller: HardhatEthersSigner, target: bigint): Promise<void> {
  await assertTargetStillSafe(system, target);
  switch (step.kind) {
    case "INVEST":
      console.log("sending manager.investExcess()");
      await (await system.manager.connect(caller).investExcess()).wait();
      return;
    case "DISPATCH":
      if (step.batchId === undefined) throw new Error("DISPATCH step is missing batch id");
      console.log(`sending dispatchBatch() for batch ${step.batchId}`);
      await (await system.deposits.connect(caller).dispatchBatch()).wait();
      return;
    case "PUBLIC_CALLBACK":
      if (step.batchId === undefined) throw new Error("PUBLIC_CALLBACK step is missing batch id");
      console.log(`public-decrypting and completing callback for batch ${step.batchId}`);
      await publicCallback(system, step.batchId, target);
      return;
    case "RESOLVE":
      if (step.batchId === undefined) throw new Error("RESOLVE step is missing batch id");
      console.log(`sending resolveDepositBatch(${step.batchId})`);
      await (await system.manager.connect(caller).resolveDepositBatch(step.batchId)).wait();
      return;
    case "MINT_DONATION":
      console.log(`sending mint(${DEMO_DONATION}) to ${caller.address}`);
      await (await system.asset.connect(caller).mint(caller.address, DEMO_DONATION)).wait();
      return;
    case "APPROVE_DONATION":
      console.log(`sending approve(${DEMO_DONATION}) to vault`);
      await (await system.asset.connect(caller).approve(system.addresses.vault, DEMO_DONATION)).wait();
      return;
    case "DONATE":
      console.log(`sending donate(${DEMO_DONATION}) to vault`);
      await (await system.vault.connect(caller).donate(DEMO_DONATION)).wait();
      return;
    case "WAIT_FOR_BATCH":
      console.log("batch is not mature; no write sent (rerun later)");
      return;
  }
}

async function run(): Promise<void> {
  const apply = process.env.UNVEIL_V4_POSITIVE_PRIZE_APPLY === "true";
  if (network.name !== "sepolia") throw new Error("Run this helper only on the Sepolia network");
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Wrong chain ${chain.chainId}; expected Sepolia ${SEPOLIA_CHAIN_ID}`);
  }

  const addresses = await resolveAddresses();
  const system = await loadSystem(addresses);
  const signers = await ethers.getSigners();
  const caller = signers[0] as HardhatEthersSigner | undefined;
  if (apply) {
    if (!caller) throw new Error("No configured Sepolia signer; refusing APPLY mode");
    const owner = await system.pool.owner();
    if (!sameAddress(owner, caller.address)) {
      throw new Error(`Configured caller ${caller.address} is not the V4 pool owner ${owner}`);
    }
  }
  const initial = await readSnapshot(system, caller?.address);
  const targetRoundId = initial.nextRoundId;

  console.log(`UNVEIL V4 positive prize preparation (${apply ? "APPLY" : "DRY RUN"})`);
  console.log(`target round: ${targetRoundId}`);
  console.log(`manager prize pointer: ${initial.managerPrizeRoundId}`);
  console.log(`draw state: ${initial.targetDrawState}; prize funded: ${initial.targetFunded}`);

  for (let stepNumber = 0; stepNumber < MAX_RESUME_STEPS; stepNumber++) {
    const snapshot = await readSnapshot(system, caller?.address);
    if (snapshot.nextRoundId !== targetRoundId) {
      throw new Error(`Target round changed from ${targetRoundId} to ${snapshot.nextRoundId}`);
    }
    const plan = planPositivePrizePrep(snapshot, !apply);
    if (plan.steps.length === 0) break;
    await executePlannedSteps(
      plan.steps.slice(0, 1),
      apply,
      async (step) => {
        if (!caller) throw new Error("No signer available for a state-changing step");
        await executeStep(system, step, caller, targetRoundId);
      },
      (message) => console.log(`  ${message}`),
    );
    if (!apply || plan.steps[0].kind === "WAIT_FOR_BATCH") break;
  }

  const finalBeforeDonation = await readSnapshot(system, caller?.address);
  if (
    finalBeforeDonation.vaultTotalSupply === 0n ||
    finalBeforeDonation.vaultTotalAssets === 0n ||
    finalBeforeDonation.shareWrapperUnderlyingBalance === 0n ||
    finalBeforeDonation.recognizedBatches.some((batch) => !batch.resolved)
  ) {
    if (!apply) {
      console.log("UNVEIL V4 POSITIVE PRIZE PREP DRY RUN");
      console.log("writes skipped");
      return;
    }
    throw new Error("Strategy position is not ready after bounded resume; rerun to continue safely");
  }

  for (let stepNumber = 0; stepNumber < 4; stepNumber++) {
    const snapshot = await readSnapshot(system, caller?.address);
    const plan = planPositivePrizePrep(snapshot, !apply);
    if (plan.steps.length === 0) break;
    await executePlannedSteps(
      plan.steps.slice(0, 1),
      apply,
      async (step) => {
        if (!caller) throw new Error("No signer available for a state-changing step");
        await executeStep(system, step, caller, targetRoundId);
      },
      (message) => console.log(`  ${message}`),
    );
    if (!apply) break;
  }

  const final = await readSnapshot(system, caller?.address);
  if (
    final.vaultTotalSupply === 0n ||
    final.vaultTotalAssets <= final.vaultTotalSupply ||
    final.shareWrapperUnderlyingBalance === 0n ||
    final.recognizedBatches.some((batch) => !batch.resolved)
  ) {
    if (!apply) {
      console.log("UNVEIL V4 POSITIVE PRIZE PREP DRY RUN");
      console.log(`planned appreciation: ${final.vaultTotalAssets === final.vaultTotalSupply}`);
      console.log("writes skipped");
      return;
    }
    throw new Error("Final appreciation assertion failed; prize funding was not attempted");
  }
  if (final.targetFunded || final.targetDeliveredCount !== 0 || final.targetDelivered) {
    throw new Error("Target prize round became funded unexpectedly");
  }
  if (final.nextRoundId !== targetRoundId || final.managerPrizeRoundId !== targetRoundId) {
    throw new Error("Round pointers changed during preparation");
  }
  if (!apply) {
    console.log("UNVEIL V4 POSITIVE PRIZE PREP DRY RUN");
    console.log(`appreciation already present: ${final.vaultTotalAssets > final.vaultTotalSupply}`);
    console.log("writes skipped");
    return;
  }
  console.log("UNVEIL V4 POSITIVE PRIZE PREP PASSED");
  console.log(`target round: ${targetRoundId}`);
  console.log(`vault totalAssets: ${final.vaultTotalAssets}`);
  console.log(`vault totalSupply: ${final.vaultTotalSupply}`);
  console.log("appreciation: true");
  console.log("prize round remains unfunded");
}

if (require.main === module) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
