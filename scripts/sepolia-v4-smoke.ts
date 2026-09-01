import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm, network } from "hardhat";

import { V4_DEPLOYMENT_NAMES } from "../deploy/deploy-v4";
import { runKeeperCycle, type KeeperCycleResult } from "./v4-keeper";
import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilDrawBatcher,
  VeilPoolV4,
  VeilPoolV4Helper,
  VeilPrizeVaultV3,
  VeilSnapshotBatcher,
  VeilStrategyManagerV3,
  VeilWithdrawalBatcher,
} from "../types";

const EIP_170_RUNTIME_CODE_LIMIT = 24_576;
const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DEMO_DEPOSIT = 100n;
const SHARD_COUNT = 24;
const SHARD_SIZE = 24;
const MAX_ACTIVE_SAVERS = 576;
const PRIZE_SLOTS = 3;
const MAX_KEEPER_CYCLES = 256;
const KEEPER_RETRY_LIMIT = 3;
const KEEPER_RETRY_DELAY_MS = 5_000;

const V4_ADDRESS_ENV = {
  asset: "UNVEIL_V4_MOCK_USDC_ADDRESS",
  principal: "UNVEIL_V4_PRINCIPAL_WRAPPER_ADDRESS",
  vault: "UNVEIL_V4_MOCK_YIELD_VAULT_ADDRESS",
  shares: "UNVEIL_V4_SHARE_WRAPPER_ADDRESS",
  depositBatcher: "UNVEIL_V4_DEPOSIT_BATCHER_ADDRESS",
  withdrawalBatcher: "UNVEIL_V4_WITHDRAWAL_BATCHER_ADDRESS",
  pool: "UNVEIL_V4_POOL_ADDRESS",
  snapshotBatcher: "UNVEIL_V4_SNAPSHOT_BATCHER_ADDRESS",
  drawBatcher: "UNVEIL_V4_DRAW_BATCHER_ADDRESS",
  prizeVault: "UNVEIL_V4_PRIZE_VAULT_ADDRESS",
  manager: "UNVEIL_V4_MANAGER_ADDRESS",
} as const;

type AddressKey = keyof typeof V4_ADDRESS_ENV;
type V4Addresses = Record<AddressKey, string>;

type System = {
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV4;
  seatKeeper: VeilPoolV4Helper;
  snapshotBatcher: VeilSnapshotBatcher;
  drawBatcher: VeilDrawBatcher;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV3;
};

type PrizeResult = { shard: number; winner: string };

const drawStateNames = ["NONE", "SNAPSHOTTED", "DRAWN", "FINALIZED", "CANCELLED", "SKIPPED"];

function namedDrawState(state: number): string {
  return drawStateNames[state] ?? `UNKNOWN(${state})`;
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`UNVEIL_V4 wiring mismatch: ${label} is ${actual}, expected ${expected}`);
  }
}

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
    throw new Error(
      `Missing ${V4_DEPLOYMENT_NAMES[key]}. Deploy the V4 stack first or provide ${envName}; no V2/V3 fallback is allowed.`,
    );
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

  console.log(`  ${label} is not ready; target Unix timestamp: ${target}`);
  if (process.env.UNVEIL_V4_SMOKE_WAIT !== "true") {
    console.log("  Exiting cleanly. Set UNVEIL_V4_SMOKE_WAIT=true to poll Sepolia time and continue.");
    return false;
  }

  while (true) {
    const remaining = target - (await latestTimestamp());
    if (remaining <= 0) return true;
    console.log(`  waiting ${remaining}s for ${label}...`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Math.max(1_000, remaining * 1_000))));
  }
}

async function ensureGas(deployer: HardhatEthersSigner, signer: HardhatEthersSigner): Promise<void> {
  const minimum = ethers.parseEther("0.005");
  const target = ethers.parseEther("0.01");
  const balance = await ethers.provider.getBalance(signer.address);
  if (balance >= minimum) return;

  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  const topUp = target - balance;
  if (deployerBalance < topUp + minimum) {
    throw new Error(`Insufficient deployer ETH to fund ${signer.address} for the V4 smoke test`);
  }
  await (await deployer.sendTransaction({ to: signer.address, value: topUp })).wait();
}

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

async function encryptedInput(contractAddress: string, signer: HardhatEthersSigner, amount: bigint) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function ensureOperator(
  token: MockUSDCConfidentialWrapper,
  holder: HardhatEthersSigner,
  operator: string,
): Promise<void> {
  if (!(await token.isOperator(holder.address, operator))) {
    await (await token.connect(holder).setOperator(operator, MAX_OPERATOR_UNTIL)).wait();
  }
}

async function ensureDeposit(system: System, account: HardhatEthersSigner): Promise<void> {
  const poolAddress = await system.pool.getAddress();
  const principalAddress = await system.principal.getAddress();
  await ensureOperator(system.principal, account, poolAddress);

  const joined = await system.pool.joined(account.address);
  let currentBalance = 0n;
  if (joined) {
    currentBalance = await decrypt64(poolAddress, await system.pool.connect(account).encryptedBalanceOf(), account);
  }
  const currentPrincipal = await decrypt64(
    principalAddress,
    await system.principal.confidentialBalanceOf(account.address),
    account,
  );
  if (currentBalance > DEMO_DEPOSIT) {
    throw new Error(`${account.address} has more than the expected V4 demo principal`);
  }
  if (!joined && currentPrincipal > DEMO_DEPOSIT) {
    throw new Error(`${account.address} has excess confidential principal before joining V4`);
  }

  const needed = DEMO_DEPOSIT - currentBalance;
  if (needed > 0n) {
    if (currentPrincipal < needed) {
      const additional = needed - currentPrincipal;
      const underlyingBalance = await system.asset.balanceOf(account.address);
      if (underlyingBalance < additional) {
        await (await system.asset.mint(account.address, additional - underlyingBalance)).wait();
      }
      await (await system.asset.connect(account).approve(principalAddress, additional)).wait();
      await (await system.principal.connect(account).wrap(account.address, additional)).wait();
    }
    const input = await encryptedInput(poolAddress, account, needed);
    await (await system.pool.connect(account).deposit(input.handles[0], input.inputProof)).wait();
  }

  const active = await decrypt64(poolAddress, await system.pool.connect(account).encryptedBalanceOf(), account);
  const reserved = await decrypt64(
    poolAddress,
    await system.pool.connect(account).encryptedReservedWithdrawalOf(),
    account,
  );
  if (active !== DEMO_DEPOSIT || reserved !== 0n) {
    throw new Error(`${account.address} is not in the expected active 100 / reserved 0 V4 smoke position`);
  }
}

async function loadSystem(addresses: V4Addresses): Promise<System> {
  const pool = (await ethers.getContractAt("VeilPoolV4", addresses.pool)) as VeilPoolV4;
  return {
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
    withdrawals: (await ethers.getContractAt(
      "VeilWithdrawalBatcher",
      addresses.withdrawalBatcher,
    )) as VeilWithdrawalBatcher,
    pool,
    seatKeeper: (await ethers.getContractAt("VeilPoolV4Helper", await pool.seatKeeper())) as VeilPoolV4Helper,
    snapshotBatcher: (await ethers.getContractAt(
      "VeilSnapshotBatcher",
      addresses.snapshotBatcher,
    )) as VeilSnapshotBatcher,
    drawBatcher: (await ethers.getContractAt("VeilDrawBatcher", addresses.drawBatcher)) as VeilDrawBatcher,
    prizeVault: (await ethers.getContractAt("VeilPrizeVaultV3", addresses.prizeVault)) as VeilPrizeVaultV3,
    manager: (await ethers.getContractAt("VeilStrategyManagerV3", addresses.manager)) as VeilStrategyManagerV3,
  };
}

async function validateWiring(system: System, addresses: V4Addresses): Promise<void> {
  for (const [label, address] of Object.entries(addresses)) {
    if ((await ethers.provider.getCode(address)) === "0x") throw new Error(`${label} has no bytecode at ${address}`);
  }

  const poolCode = await ethers.provider.getCode(addresses.pool);
  const poolRuntimeBytes = (poolCode.length - 2) / 2;
  if (poolRuntimeBytes > EIP_170_RUNTIME_CODE_LIMIT) {
    throw new Error(`VeilPoolV4 runtime bytecode is ${poolRuntimeBytes} bytes, above EIP-170`);
  }

  const seatKeeperAddress = await system.pool.seatKeeper();
  requireAddress("pool.seatKeeper", seatKeeperAddress, await system.seatKeeper.getAddress());
  requireAddress("seatKeeper.pool", await system.seatKeeper.pool(), addresses.pool);
  if ((await ethers.provider.getCode(seatKeeperAddress)) === "0x") {
    throw new Error(`pool.seatKeeper has no bytecode at ${seatKeeperAddress}`);
  }

  requireAddress("pool.asset", await system.pool.asset(), addresses.principal);
  requireAddress("pool.strategyManager", await system.pool.strategyManager(), addresses.manager);
  requireAddress("manager.pool", await system.manager.pool(), addresses.pool);
  requireAddress("manager.principalAsset", await system.manager.principalAsset(), addresses.principal);
  requireAddress("manager.strategyShareAsset", await system.manager.strategyShareAsset(), addresses.shares);
  requireAddress("manager.depositBatcher", await system.manager.depositBatcher(), addresses.depositBatcher);
  requireAddress("manager.withdrawalBatcher", await system.manager.withdrawalBatcher(), addresses.withdrawalBatcher);
  requireAddress("manager.vault", await system.manager.vault(), addresses.vault);
  requireAddress("manager.prizeVault", await system.manager.prizeVault(), addresses.prizeVault);
  requireAddress("prizeVault.pool", await system.prizeVault.pool(), addresses.pool);
  requireAddress("prizeVault.asset", await system.prizeVault.asset(), addresses.shares);
  requireAddress("principal.underlying", await system.principal.underlying(), addresses.asset);
  requireAddress("shares.underlying", await system.shares.underlying(), addresses.vault);
  requireAddress("vault.asset", await system.vault.asset(), addresses.asset);
  requireAddress("depositBatcher.fromToken", await system.deposits.fromToken(), addresses.principal);
  requireAddress("depositBatcher.toToken", await system.deposits.toToken(), addresses.shares);
  requireAddress("depositBatcher.vault", await system.deposits.vault(), addresses.vault);
  requireAddress("withdrawalBatcher.fromToken", await system.withdrawals.fromToken(), addresses.shares);
  requireAddress("withdrawalBatcher.toToken", await system.withdrawals.toToken(), addresses.principal);
  requireAddress("withdrawalBatcher.vault", await system.withdrawals.vault(), addresses.vault);
  requireAddress("snapshotBatcher.pool", await system.snapshotBatcher.pool(), addresses.pool);
  requireAddress("drawBatcher.pool", await system.drawBatcher.pool(), addresses.pool);

  if ((await system.pool.SHARD_COUNT()) !== BigInt(SHARD_COUNT)) throw new Error("V4 SHARD_COUNT is not 24");
  if ((await system.pool.SHARD_SIZE()) !== BigInt(SHARD_SIZE)) throw new Error("V4 SHARD_SIZE is not 24");
  if ((await system.pool.MAX_ACTIVE_SAVERS()) !== BigInt(MAX_ACTIVE_SAVERS)) {
    throw new Error("V4 MAX_ACTIVE_SAVERS is not 576");
  }
  if ((await system.pool.PRIZE_SLOTS()) !== BigInt(PRIZE_SLOTS)) throw new Error("V4 PRIZE_SLOTS is not 3");
  if ((await system.prizeVault.PRIZE_SLOTS()) !== BigInt(PRIZE_SLOTS)) {
    throw new Error("V4 prize vault PRIZE_SLOTS is not 3");
  }
  console.log(`  VeilPoolV4 runtime bytecode: ${poolRuntimeBytes} bytes`);
}

async function runKeeperPass(): Promise<KeeperCycleResult> {
  const waitMode = process.env.UNVEIL_V4_SMOKE_WAIT === "true";
  let lastError: unknown;
  for (let attempt = 1; attempt <= (waitMode ? KEEPER_RETRY_LIMIT : 1); attempt++) {
    try {
      const result = await runKeeperCycle();
      if (result.actions.length === 0) console.log("  keeper: idle");
      else for (const action of result.actions) console.log(`  keeper: ${action}`);
      return result;
    } catch (error) {
      lastError = error;
      if (!waitMode || attempt === KEEPER_RETRY_LIMIT) throw error;
      console.warn(`  keeper attempt ${attempt}/${KEEPER_RETRY_LIMIT} failed; retrying in wait mode`, error);
      await new Promise((resolve) => setTimeout(resolve, KEEPER_RETRY_DELAY_MS));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readMatureWeights(
  system: System,
  roundId: bigint,
  alice: HardhatEthersSigner,
  bob: HardhatEthersSigner,
): Promise<{ alice: bigint; bob: bigint }> {
  const aliceWeight = await decrypt64(
    await system.pool.getAddress(),
    await system.pool.connect(alice).encryptedSnapshotWeightOf(roundId),
    alice,
  );
  const bobWeight = await decrypt64(
    await system.pool.getAddress(),
    await system.pool.connect(bob).encryptedSnapshotWeightOf(roundId),
    bob,
  );
  return { alice: aliceWeight, bob: bobWeight };
}

async function readFinalizedPrizes(pool: VeilPoolV4, roundId: bigint): Promise<PrizeResult[]> {
  const results: PrizeResult[] = [];
  for (let prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
    const status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
    if (!status[4]) throw new Error(`Round ${roundId} prize ${prizeIndex} is not finalized`);
    results.push({ shard: Number(status[2]), winner: status[5] });
  }
  return results;
}

async function verifyMatureRound(
  system: System,
  roundId: bigint,
  alice: HardhatEthersSigner,
  bob: HardhatEthersSigner,
): Promise<void> {
  const info = await system.pool.getDrawInfo(roundId);
  if (Number(info[1]) < 2) throw new Error(`Round ${roundId} has fewer than two mature snapshot participants`);
  const weights = await readMatureWeights(system, roundId, alice, bob);
  console.log(`  round ${roundId} private snapshot weights: Alice=${weights.alice}, Bob=${weights.bob}`);
  if (weights.alice !== DEMO_DEPOSIT || weights.bob !== DEMO_DEPOSIT) {
    throw new Error(`Round ${roundId} did not snapshot Alice/Bob at 100 / 100`);
  }

  const positive = new Set([alice.address.toLowerCase(), bob.address.toLowerCase()]);
  const results = await readFinalizedPrizes(system.pool, roundId);
  for (const result of results) {
    if (!positive.has(result.winner.toLowerCase())) {
      throw new Error(`Round ${roundId} selected an unexpected winner ${result.winner}`);
    }
  }
  if (Number(await system.pool.getDrawState(roundId)) !== 3) {
    throw new Error(`Mature V4 round ${roundId} is not FINALIZED`);
  }
  const finalInfo = await system.pool.getDrawInfo(roundId);
  if (Number(finalInfo[2]) !== PRIZE_SLOTS || Number(finalInfo[3]) !== PRIZE_SLOTS) {
    throw new Error(`Mature V4 round ${roundId} did not finalize all three prize slots`);
  }
}

async function verifyFirstRoundSkip(system: System, roundId: bigint): Promise<boolean> {
  const state = Number(await system.pool.getDrawState(roundId));
  if (state !== 4 && state !== 5) return false;
  const info = await system.pool.getDrawInfo(roundId);
  if (Number(info[1]) >= 2) throw new Error(`Pre-maturity round ${roundId} has mature participants`);
  console.log(`  round ${roundId}: ${namedDrawState(state)} with fewer than two mature participants`);
  return true;
}

async function verifyEconomicProgress(
  system: System,
  roundId: bigint,
): Promise<"complete" | "pending" | "unavailable"> {
  const managerRound = await system.manager.nextPrizeRoundId();
  const vaultStatus = await system.prizeVault.roundStatus(roundId);
  const strategyShares = await system.vault.totalSupply();
  const strategyAssets = await system.vault.totalAssets();
  if (managerRound === roundId && (strategyShares === 0n || strategyAssets === 0n)) {
    console.log(
      "  TEST/DEMO asset has no strategy shares; manager funding and prize delivery are not economically enabled",
    );
    return "unavailable";
  }
  if (managerRound <= roundId) return "pending";
  if (vaultStatus[0] && !vaultStatus[2]) return "pending";
  if (vaultStatus[0]) console.log(`  round ${roundId}: manager-funded prize vault fully delivered`);
  else console.log(`  round ${roundId}: no prize vault funding was required`);
  return "complete";
}

async function progressWithKeeper(
  system: System,
  firstMaturityRound: bigint,
  alice: HardhatEthersSigner,
  bob: HardhatEthersSigner,
): Promise<boolean> {
  const preMaturityRound = firstMaturityRound - 1n;
  let skipVerified = preMaturityRound === 0n;

  for (let cycle = 0; cycle < MAX_KEEPER_CYCLES; cycle++) {
    const schedule = await system.seatKeeper.getDrawSchedule();
    const currentRoundId = BigInt(schedule[0]);
    const currentClosesAt = Number(schedule[3]);
    const timeReady = Boolean(schedule[4]);
    const managerRound = await system.manager.nextPrizeRoundId();

    if (!skipVerified && currentRoundId > preMaturityRound) {
      skipVerified = await verifyFirstRoundSkip(system, preMaturityRound);
    }

    const targetState = Number(await system.pool.getDrawState(firstMaturityRound));
    if (targetState === 4 || targetState === 5) {
      throw new Error(`Expected mature round ${firstMaturityRound} to draw, found ${namedDrawState(targetState)}`);
    }
    if (targetState === 3) {
      await verifyMatureRound(system, firstMaturityRound, alice, bob);
      const economics = await verifyEconomicProgress(system, firstMaturityRound);
      if (economics === "complete" || economics === "unavailable") {
        if (!skipVerified) throw new Error(`Pre-maturity round ${preMaturityRound} was not safely skipped`);
        return true;
      }
    }

    const keeperHasUnsettledWork = managerRound < currentRoundId;
    if (!timeReady && !keeperHasUnsettledWork) {
      if (!(await waitForRealTime(`draw ${currentRoundId}`, currentClosesAt))) return false;
      continue;
    }

    const result = await runKeeperPass();
    if (result.idle && targetState !== 3) {
      throw new Error(`Keeper made no progress at cycle ${cycle + 1} while round ${firstMaturityRound} is incomplete`);
    }
  }
  throw new Error(`V4 smoke exceeded ${MAX_KEEPER_CYCLES} keeper cycles before completing the mature round`);
}

async function run(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("Run this script on Sepolia: npm run smoke:v4:sepolia");

  // TEST/DEMO asset warning: this stack uses MockUSDC and MockYieldVault4626, not production economics.
  console.log("UNVEIL V4 Sepolia sharded-draw smoke — TEST/DEMO asset (MockUSDC + MockYieldVault4626)");
  await fhevm.initializeCLIApi();
  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected deployer, Alice, and Bob Sepolia signers");

  const addresses = {} as V4Addresses;
  for (const key of Object.keys(V4_ADDRESS_ENV) as AddressKey[]) addresses[key] = await resolveAddress(key);
  const system = await loadSystem(addresses);

  console.log(`  deployer: ${deployer.address}`);
  console.log(`  Alice:    ${alice.address}`);
  console.log(`  Bob:      ${bob.address}`);
  console.log(`  pool:     ${addresses.pool}`);
  console.log(`  helper:   ${await system.seatKeeper.getAddress()}`);
  await validateWiring(system, addresses);
  console.log("  deployment bytecode and V4 wiring: verified");

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);
  console.log("  signer ETH balances: sufficient");

  console.log("A. CONFIDENTIAL DEPOSITS / PRIVATE REVEALS");
  await ensureDeposit(system, alice);
  await ensureDeposit(system, bob);
  const aliceBalance = await decrypt64(addresses.pool, await system.pool.connect(alice).encryptedBalanceOf(), alice);
  const bobBalance = await decrypt64(addresses.pool, await system.pool.connect(bob).encryptedBalanceOf(), bob);
  if (aliceBalance !== DEMO_DEPOSIT || bobBalance !== DEMO_DEPOSIT) {
    throw new Error(`Private live balances are not Alice=100 / Bob=100 (${aliceBalance} / ${bobBalance})`);
  }
  if ((await system.principal.confidentialBalanceOf(addresses.pool)) !== ethers.ZeroHash) {
    throw new Error("Pool principal wrapper custody is nonzero");
  }
  const managerPrincipal = await system.principal.confidentialBalanceOf(addresses.manager);
  const pendingPrincipal = await system.principal.confidentialBalanceOf(addresses.depositBatcher);
  const managerShares = await system.shares.confidentialBalanceOf(addresses.manager);
  if (
    managerPrincipal === ethers.ZeroHash &&
    pendingPrincipal === ethers.ZeroHash &&
    managerShares === ethers.ZeroHash &&
    (await system.vault.totalSupply()) === 0n
  ) {
    throw new Error("V4 manager custody is empty after deposits");
  }

  const pendingAlice = await system.seatKeeper.pendingSeatAttestationRequestId(alice.address);
  const pendingBob = await system.seatKeeper.pendingSeatAttestationRequestId(bob.address);
  console.log(`  private balances: Alice=${aliceBalance}, Bob=${bobBalance}`);
  console.log(`  pending seat attestations: Alice=${pendingAlice}, Bob=${pendingBob}`);
  if ((pendingAlice !== 0n || pendingBob !== 0n) && (await system.pool.playerCount()) === 2n) {
    throw new Error("Draw seats became active before their KMS attestations were finalized");
  }

  console.log("B. KMS SEAT ATTESTATION THROUGH THE KEEPER");
  await runKeeperPass();
  for (const account of [alice, bob]) {
    if ((await system.seatKeeper.pendingSeatAttestationRequestId(account.address)) !== 0n) {
      throw new Error(`Seat attestation remains pending for ${account.address}`);
    }
    if (!(await system.pool.seated(account.address))) throw new Error(`Seat was not activated for ${account.address}`);
    if ((await system.pool.seatExpiresAt(account.address)) === 0n) {
      throw new Error(`Seat expiry was not recorded for ${account.address}`);
    }
  }
  if ((await system.pool.playerCount()) !== 2n) {
    throw new Error("V4 playerCount did not become exactly two after successful KMS attestations");
  }

  const aliceEligible = await system.pool.seatEligibleFromRoundId(alice.address);
  const bobEligible = await system.pool.seatEligibleFromRoundId(bob.address);
  if (aliceEligible !== bobEligible || aliceEligible < 2n) {
    throw new Error(`Unexpected seat maturity boundary: Alice=${aliceEligible}, Bob=${bobEligible}`);
  }
  console.log(`  playerCount=2 after attestation; first mature snapshot round: ${aliceEligible}`);

  console.log("C. KEEPER-ONLY SNAPSHOT, DRAW, MANAGER, AND DELIVERY PROGRESSION");
  if (!(await progressWithKeeper(system, aliceEligible, alice, bob))) return;
  console.log("\nUNVEIL V4 Sepolia sharded-draw smoke PASSED");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
