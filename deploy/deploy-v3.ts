import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const SEPOLIA_CHAIN_ID = 11_155_111;
const DEFAULT_DRAW_PERIOD_SECONDS = 86_400;
const SEPOLIA_DRAW_PERIOD_SECONDS = 900;
const DEFAULT_BATCH_AGE_SECONDS = 3_600;
const SEPOLIA_BATCH_AGE_SECONDS = 120;
const DEFAULT_BUFFER_RESERVE_BPS = 2_000;
const DEFAULT_VALUATION_HAIRCUT_BPS = 0;
const MAX_BPS = 10_000;

export const V3_DEPLOYMENT_NAMES = {
  asset: "UNVEIL_V3_MockUSDC",
  principal: "UNVEIL_V3_PrincipalWrapper",
  vault: "UNVEIL_V3_MockYieldVault4626",
  shares: "UNVEIL_V3_ShareWrapper",
  depositBatcher: "UNVEIL_V3_DepositBatcher",
  withdrawalBatcher: "UNVEIL_V3_WithdrawalBatcher",
  pool: "UNVEIL_V3_VeilPool",
  prizeVault: "UNVEIL_V3_VeilPrizeVault",
  manager: "UNVEIL_V3_VeilStrategyManager",
} as const;

function parseInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;

  const value = configured.trim();
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a decimal integer`);

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function drawPeriodForV3Deployment(isSepolia: boolean): number {
  return parseInteger(
    "UNVEIL_V3_DRAW_PERIOD_SECONDS",
    isSepolia ? SEPOLIA_DRAW_PERIOD_SECONDS : DEFAULT_DRAW_PERIOD_SECONDS,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function batchAgeForV3Deployment(isSepolia: boolean): number {
  return parseInteger(
    "UNVEIL_V3_BATCH_AGE_SECONDS",
    isSepolia ? SEPOLIA_BATCH_AGE_SECONDS : DEFAULT_BATCH_AGE_SECONDS,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function bufferReserveBpsForV3Deployment(): number {
  return parseInteger("UNVEIL_V3_BUFFER_RESERVE_BPS", DEFAULT_BUFFER_RESERVE_BPS, 0, MAX_BPS);
}

export function valuationHaircutBpsForV3Deployment(): number {
  return parseInteger("UNVEIL_V3_VALUATION_HAIRCUT_BPS", DEFAULT_VALUATION_HAIRCUT_BPS, 0, MAX_BPS - 1);
}

function sameAddress(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`UNVEIL_V3 wiring mismatch: ${label} is ${actual}, expected ${expected}`);
  }
}

function canonicalDeploymentValue(value: unknown): unknown {
  if (typeof value === "bigint" || typeof value === "number") return value.toString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed).toString();
    return trimmed;
  }
  if (Array.isArray(value)) return value.map(canonicalDeploymentValue);
  return value;
}

export function v3DeploymentArgumentsMatch(existingArgs: unknown[] | undefined, requestedArgs: unknown[]): boolean {
  if (!existingArgs || existingArgs.length !== requestedArgs.length) return false;
  return (
    JSON.stringify(canonicalDeploymentValue(existingArgs)) === JSON.stringify(canonicalDeploymentValue(requestedArgs))
  );
}

export function assertV3DeploymentArgumentsMatch(
  name: string,
  existingArgs: unknown[] | undefined,
  requestedArgs: unknown[],
): void {
  if (!v3DeploymentArgumentsMatch(existingArgs, requestedArgs)) {
    throw new Error(`UNVEIL_V3 deployment mismatch for ${name}: constructor arguments differ; refusing reuse`);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, fetchIfDifferent, get, getOrNull } = hre.deployments;
  const isSepolia = hre.network.config.chainId === SEPOLIA_CHAIN_ID;
  const drawPeriod = drawPeriodForV3Deployment(isSepolia);
  const batchAge = batchAgeForV3Deployment(isSepolia);
  const bufferReserveBps = bufferReserveBpsForV3Deployment();
  const valuationHaircutBps = valuationHaircutBpsForV3Deployment();

  const deployment = async (name: string, contract: string, args: unknown[]) => {
    const options = { contract, from: deployer, args, log: true };
    const existing = await getOrNull(name);
    if (!existing) return deploy(name, options);

    assertV3DeploymentArgumentsMatch(name, existing.args, args);
    const transactionHash = existing.transactionHash ?? existing.receipt?.transactionHash;
    if (!transactionHash) {
      throw new Error(
        `UNVEIL_V3 deployment mismatch for ${name}: existing record has no verifiable deployment transaction`,
      );
    }

    const comparison = await fetchIfDifferent(name, options);
    if (comparison.differences) {
      throw new Error(
        `UNVEIL_V3 deployment mismatch for ${name}: artifact or constructor arguments differ; refusing redeploy`,
      );
    }
    return { ...existing, newlyDeployed: false };
  };

  // V3 is always a fresh stack. It intentionally does not reuse any V2 deployment record or address.
  const asset = await deployment(V3_DEPLOYMENT_NAMES.asset, "MockUSDC", []);
  const principal = await deployment(V3_DEPLOYMENT_NAMES.principal, "MockUSDCConfidentialWrapper", [asset.address]);
  const vault = await deployment(V3_DEPLOYMENT_NAMES.vault, "MockYieldVault4626", [asset.address]);
  const shares = await deployment(V3_DEPLOYMENT_NAMES.shares, "MockYieldVaultShareConfidentialWrapper", [
    vault.address,
  ]);
  const depositBatcher = await deployment(V3_DEPLOYMENT_NAMES.depositBatcher, "VeilDepositBatcher", [
    principal.address,
    shares.address,
    vault.address,
    batchAge,
  ]);
  const withdrawalBatcher = await deployment(V3_DEPLOYMENT_NAMES.withdrawalBatcher, "VeilWithdrawalBatcher", [
    shares.address,
    principal.address,
    vault.address,
    batchAge,
  ]);
  const pool = await deployment(V3_DEPLOYMENT_NAMES.pool, "VeilPoolV3", [principal.address, drawPeriod]);
  const prizeVault = await deployment(V3_DEPLOYMENT_NAMES.prizeVault, "VeilPrizeVaultV3", [pool.address, shares.address]);
  const manager = await deployment(V3_DEPLOYMENT_NAMES.manager, "VeilStrategyManagerV3", [
    pool.address,
    principal.address,
    shares.address,
    depositBatcher.address,
    withdrawalBatcher.address,
    vault.address,
    prizeVault.address,
    bufferReserveBps,
    valuationHaircutBps,
  ]);

  const poolContract = await hre.ethers.getContractAt("VeilPoolV3", pool.address);
  const principalContract = await hre.ethers.getContractAt("MockUSDCConfidentialWrapper", principal.address);
  const vaultContract = await hre.ethers.getContractAt("MockYieldVault4626", vault.address);
  const sharesContract = await hre.ethers.getContractAt("MockYieldVaultShareConfidentialWrapper", shares.address);
  const depositBatcherContract = await hre.ethers.getContractAt("VeilDepositBatcher", depositBatcher.address);
  const withdrawalBatcherContract = await hre.ethers.getContractAt("VeilWithdrawalBatcher", withdrawalBatcher.address);
  const prizeVaultContract = await hre.ethers.getContractAt("VeilPrizeVaultV3", prizeVault.address);
  const managerContract = await hre.ethers.getContractAt("VeilStrategyManagerV3", manager.address);

  const configuredManager = await poolContract.strategyManager();
  const managerConfigured = await poolContract.strategyManagerConfigured();
  if (managerConfigured) {
    if (!sameAddress(configuredManager, manager.address)) {
      throw new Error(
        `UNVEIL_V3 pool is already configured with another manager: ${configuredManager}; refusing to repair it`,
      );
    }
  } else {
    await execute(V3_DEPLOYMENT_NAMES.pool, { from: deployer, log: true }, "configureStrategyManager", manager.address);
  }

  requireAddress("pool.asset", await poolContract.asset(), principal.address);
  requireAddress("manager.pool", await managerContract.pool(), pool.address);
  requireAddress("manager.principalAsset", await managerContract.principalAsset(), principal.address);
  requireAddress("manager.strategyShareAsset", await managerContract.strategyShareAsset(), shares.address);
  requireAddress("manager.depositBatcher", await managerContract.depositBatcher(), depositBatcher.address);
  requireAddress("manager.withdrawalBatcher", await managerContract.withdrawalBatcher(), withdrawalBatcher.address);
  requireAddress("manager.vault", await managerContract.vault(), vault.address);
  requireAddress("manager.prizeVault", await managerContract.prizeVault(), prizeVault.address);
  requireAddress("prizeVault.pool", await prizeVaultContract.pool(), pool.address);
  requireAddress("prizeVault.asset", await prizeVaultContract.asset(), shares.address);
  requireAddress("principal.underlying", await principalContract.underlying(), asset.address);
  requireAddress("shares.underlying", await sharesContract.underlying(), vault.address);
  requireAddress("vault.asset", await vaultContract.asset(), asset.address);
  requireAddress("depositBatcher.fromToken", await depositBatcherContract.fromToken(), principal.address);
  requireAddress("depositBatcher.toToken", await depositBatcherContract.toToken(), shares.address);
  requireAddress("depositBatcher.vault", await depositBatcherContract.vault(), vault.address);
  requireAddress("withdrawalBatcher.fromToken", await withdrawalBatcherContract.fromToken(), shares.address);
  requireAddress("withdrawalBatcher.toToken", await withdrawalBatcherContract.toToken(), principal.address);
  requireAddress("withdrawalBatcher.vault", await withdrawalBatcherContract.vault(), vault.address);
  requireAddress("pool.strategyManager", await poolContract.strategyManager(), manager.address);

  if ((await poolContract.drawPeriod()) !== BigInt(drawPeriod)) {
    throw new Error(`UNVEIL_V3 runtime mismatch: pool.drawPeriod is not ${drawPeriod}`);
  }
  if ((await poolContract.MAX_PLAYERS()) !== 24n) {
    throw new Error("UNVEIL_V3 runtime mismatch: pool.MAX_PLAYERS is not 24");
  }
  if ((await poolContract.PRIZE_SLOTS()) !== 3n) {
    throw new Error("UNVEIL_V3 runtime mismatch: pool.PRIZE_SLOTS is not 3");
  }
  if ((await prizeVaultContract.PRIZE_SLOTS()) !== 3n) {
    throw new Error("UNVEIL_V3 runtime mismatch: prizeVault.PRIZE_SLOTS is not 3");
  }
  if ((await depositBatcherContract.minimumBatchAge()) !== BigInt(batchAge)) {
    throw new Error(`UNVEIL_V3 runtime mismatch: deposit batch age is not ${batchAge}`);
  }
  if ((await withdrawalBatcherContract.minimumBatchAge()) !== BigInt(batchAge)) {
    throw new Error(`UNVEIL_V3 runtime mismatch: withdrawal batch age is not ${batchAge}`);
  }
  if ((await managerContract.bufferReserveBps()) !== BigInt(bufferReserveBps)) {
    throw new Error(`UNVEIL_V3 runtime mismatch: buffer reserve BPS is not ${bufferReserveBps}`);
  }
  if ((await managerContract.valuationHaircutBps()) !== BigInt(valuationHaircutBps)) {
    throw new Error(`UNVEIL_V3 runtime mismatch: valuation haircut BPS is not ${valuationHaircutBps}`);
  }

  const records = [
    ["underlying MockUSDC", asset.address],
    ["principal confidential wrapper (t-cUSDC)", principal.address],
    ["mock ERC4626 strategy", vault.address],
    ["strategy-share confidential wrapper", shares.address],
    ["deposit batcher", depositBatcher.address],
    ["withdrawal batcher", withdrawalBatcher.address],
    ["VeilPoolV3", pool.address],
    ["VeilPrizeVaultV3", prizeVault.address],
    ["VeilStrategyManagerV3", manager.address],
  ];
  const recordAddresses: Record<string, string> = {
    [V3_DEPLOYMENT_NAMES.asset]: asset.address,
    [V3_DEPLOYMENT_NAMES.principal]: principal.address,
    [V3_DEPLOYMENT_NAMES.vault]: vault.address,
    [V3_DEPLOYMENT_NAMES.shares]: shares.address,
    [V3_DEPLOYMENT_NAMES.depositBatcher]: depositBatcher.address,
    [V3_DEPLOYMENT_NAMES.withdrawalBatcher]: withdrawalBatcher.address,
    [V3_DEPLOYMENT_NAMES.pool]: pool.address,
    [V3_DEPLOYMENT_NAMES.prizeVault]: prizeVault.address,
    [V3_DEPLOYMENT_NAMES.manager]: manager.address,
  };

  console.log("UNVEIL V3 deployment — SEPOLIA TESTNET / DEMO ASSET");
  for (const [label, address] of records) console.log(`  ${label.padEnd(42)} ${address}`);
  console.log(`  draw period:                               ${drawPeriod} seconds`);
  console.log(`  batch age:                                 ${batchAge} seconds`);
  console.log(`  buffer reserve BPS:                        ${bufferReserveBps}`);
  console.log(`  valuation haircut BPS:                     ${valuationHaircutBps}`);
  console.log("  draw model:                                24 seats · 3 prize slots · boundary maturity");
  console.log("  asset mode:                                TEST/DEMO simulated yield");

  for (const name of Object.values(V3_DEPLOYMENT_NAMES)) {
    const record = await get(name);
    requireAddress(`deployment record ${name}`, record.address, recordAddresses[name]);
  }
};

export default func;
func.id = "deploy_unveil_v3";
func.tags = ["UNVEIL_V3"];
