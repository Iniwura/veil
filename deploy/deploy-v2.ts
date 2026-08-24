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

export const V2_DEPLOYMENT_NAMES = {
  asset: "UNVEIL_V2_MockUSDC",
  principal: "UNVEIL_V2_PrincipalWrapper",
  vault: "UNVEIL_V2_MockYieldVault4626",
  shares: "UNVEIL_V2_ShareWrapper",
  depositBatcher: "UNVEIL_V2_DepositBatcher",
  withdrawalBatcher: "UNVEIL_V2_WithdrawalBatcher",
  pool: "UNVEIL_V2_VeilPool",
  prizeVault: "UNVEIL_V2_VeilPrizeVault",
  manager: "UNVEIL_V2_VeilStrategyManager",
} as const;

function parseInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;

  const value = configured.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a decimal integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function drawPeriodForV2Deployment(isSepolia: boolean): number {
  return parseInteger(
    "UNVEIL_V2_DRAW_PERIOD_SECONDS",
    isSepolia ? SEPOLIA_DRAW_PERIOD_SECONDS : DEFAULT_DRAW_PERIOD_SECONDS,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function batchAgeForV2Deployment(isSepolia: boolean): number {
  return parseInteger(
    "UNVEIL_V2_BATCH_AGE_SECONDS",
    isSepolia ? SEPOLIA_BATCH_AGE_SECONDS : DEFAULT_BATCH_AGE_SECONDS,
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function bufferReserveBpsForV2Deployment(): number {
  return parseInteger("UNVEIL_V2_BUFFER_RESERVE_BPS", DEFAULT_BUFFER_RESERVE_BPS, 0, MAX_BPS);
}

export function valuationHaircutBpsForV2Deployment(): number {
  return parseInteger("UNVEIL_V2_VALUATION_HAIRCUT_BPS", DEFAULT_VALUATION_HAIRCUT_BPS, 0, MAX_BPS - 1);
}

function sameAddress(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`UNVEIL_V2 wiring mismatch: ${label} is ${actual}, expected ${expected}`);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, get } = hre.deployments;
  const isSepolia = hre.network.config.chainId === SEPOLIA_CHAIN_ID;
  const drawPeriod = drawPeriodForV2Deployment(isSepolia);
  const batchAge = batchAgeForV2Deployment(isSepolia);
  const bufferReserveBps = bufferReserveBpsForV2Deployment();
  const valuationHaircutBps = valuationHaircutBpsForV2Deployment();
  const deployment = async (name: string, contract: string, args: unknown[]) =>
    deploy(name, {
      contract,
      from: deployer,
      args,
      log: true,
      skipIfAlreadyDeployed: true,
    });

  // This is intentionally a fresh test/demo strategy route. No V1 deployment record or canonical
  // address is read by this script.
  const asset = await deployment(V2_DEPLOYMENT_NAMES.asset, "MockUSDC", []);
  const principal = await deployment(V2_DEPLOYMENT_NAMES.principal, "MockUSDCConfidentialWrapper", [asset.address]);
  const vault = await deployment(V2_DEPLOYMENT_NAMES.vault, "MockYieldVault4626", [asset.address]);
  const shares = await deployment(V2_DEPLOYMENT_NAMES.shares, "MockYieldVaultShareConfidentialWrapper", [
    vault.address,
  ]);
  const depositBatcher = await deployment(V2_DEPLOYMENT_NAMES.depositBatcher, "VeilDepositBatcher", [
    principal.address,
    shares.address,
    vault.address,
    batchAge,
  ]);
  const withdrawalBatcher = await deployment(V2_DEPLOYMENT_NAMES.withdrawalBatcher, "VeilWithdrawalBatcher", [
    shares.address,
    principal.address,
    vault.address,
    batchAge,
  ]);
  const pool = await deployment(V2_DEPLOYMENT_NAMES.pool, "VeilPoolV2", [principal.address, drawPeriod]);
  const prizeVault = await deployment(V2_DEPLOYMENT_NAMES.prizeVault, "VeilPrizeVaultV2", [
    pool.address,
    shares.address,
  ]);
  const manager = await deployment(V2_DEPLOYMENT_NAMES.manager, "VeilStrategyManagerV2", [
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

  const poolContract = await hre.ethers.getContractAt("VeilPoolV2", pool.address);
  const principalContract = await hre.ethers.getContractAt("MockUSDCConfidentialWrapper", principal.address);
  const vaultContract = await hre.ethers.getContractAt("MockYieldVault4626", vault.address);
  const sharesContract = await hre.ethers.getContractAt("MockYieldVaultShareConfidentialWrapper", shares.address);
  const depositBatcherContract = await hre.ethers.getContractAt("VeilDepositBatcher", depositBatcher.address);
  const withdrawalBatcherContract = await hre.ethers.getContractAt("VeilWithdrawalBatcher", withdrawalBatcher.address);
  const prizeVaultContract = await hre.ethers.getContractAt("VeilPrizeVaultV2", prizeVault.address);
  const managerContract = await hre.ethers.getContractAt("VeilStrategyManagerV2", manager.address);

  const configuredManager = await poolContract.strategyManager();
  const managerConfigured = await poolContract.strategyManagerConfigured();
  if (managerConfigured) {
    if (!sameAddress(configuredManager, manager.address)) {
      throw new Error(
        `UNVEIL_V2 pool is already configured with another manager: ${configuredManager}; refusing to repair it`,
      );
    }
  } else {
    await execute(V2_DEPLOYMENT_NAMES.pool, { from: deployer, log: true }, "configureStrategyManager", manager.address);
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

  const records = [
    ["underlying MockUSDC", asset.address],
    ["principal confidential wrapper", principal.address],
    ["mock ERC4626 strategy", vault.address],
    ["strategy-share confidential wrapper", shares.address],
    ["deposit batcher", depositBatcher.address],
    ["withdrawal batcher", withdrawalBatcher.address],
    ["VeilPoolV2", pool.address],
    ["VeilPrizeVaultV2", prizeVault.address],
    ["VeilStrategyManagerV2", manager.address],
  ];
  const recordAddresses: Record<string, string> = {
    [V2_DEPLOYMENT_NAMES.asset]: asset.address,
    [V2_DEPLOYMENT_NAMES.principal]: principal.address,
    [V2_DEPLOYMENT_NAMES.vault]: vault.address,
    [V2_DEPLOYMENT_NAMES.shares]: shares.address,
    [V2_DEPLOYMENT_NAMES.depositBatcher]: depositBatcher.address,
    [V2_DEPLOYMENT_NAMES.withdrawalBatcher]: withdrawalBatcher.address,
    [V2_DEPLOYMENT_NAMES.pool]: pool.address,
    [V2_DEPLOYMENT_NAMES.prizeVault]: prizeVault.address,
    [V2_DEPLOYMENT_NAMES.manager]: manager.address,
  };

  console.log("UNVEIL V2 deployment — TEST/DEMO simulated strategy");
  for (const [label, address] of records) console.log(`  ${label.padEnd(36)} ${address}`);
  console.log(`  draw period:                         ${drawPeriod} seconds`);
  console.log(`  batch age:                           ${batchAge} seconds`);
  console.log(`  buffer reserve BPS:                  ${bufferReserveBps}`);
  console.log(`  valuation haircut BPS:               ${valuationHaircutBps}`);
  console.log("  asset mode:                          TEST/DEMO simulated yield");

  // Keep the named deployment lookup live so a stale/partial deployment cannot be mistaken for
  // an unverified V2 stack by callers that use this script's records.
  for (const name of Object.values(V2_DEPLOYMENT_NAMES)) {
    const record = await get(name);
    requireAddress(`deployment record ${name}`, record.address, recordAddresses[name]);
  }
};

export default func;
func.id = "deploy_unveil_v2";
func.tags = ["UNVEIL_V2"];
