import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const DEFAULT_DRAW_PERIOD_SECONDS = 24 * 60 * 60;
const SEPOLIA_DRAW_PERIOD_SECONDS = 15 * 60;

export function drawPeriodForDeployment(isSepolia: boolean): number {
  const configured = process.env.VEIL_DRAW_PERIOD_SECONDS?.trim();
  if (!configured) return isSepolia ? SEPOLIA_DRAW_PERIOD_SECONDS : DEFAULT_DRAW_PERIOD_SECONDS;

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("VEIL_DRAW_PERIOD_SECONDS must be a positive integer number of seconds");
  }

  return parsed;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, get } = hre.deployments;

  const isSepolia = hre.network.config.chainId === 11155111;
  const drawPeriod = drawPeriodForDeployment(isSepolia);
  const configuredAsset = process.env.VEIL_ASSET_ADDRESS?.trim();
  const deployDemoAsset = process.env.VEIL_DEPLOY_DEMO_ASSET === "true";

  if (isSepolia && !configuredAsset && !deployDemoAsset) {
    throw new Error(
      "Sepolia deployment requires VEIL_ASSET_ADDRESS or explicit VEIL_DEPLOY_DEMO_ASSET=true for the test-only asset",
    );
  }

  let assetAddress = configuredAsset;

  if (!assetAddress) {
    const demoAsset = await deploy("MockConfidentialToken", {
      from: deployer,
      log: true,
    });
    assetAddress = demoAsset.address;
  }

  const pool = await deploy("VeilPool", {
    from: deployer,
    args: [assetAddress, drawPeriod],
    log: true,
  });

  const yieldSource = await deploy("VeilYieldSource", {
    from: deployer,
    args: [assetAddress],
    log: true,
  });

  const prizeVault = await deploy("VeilPrizeVault", {
    from: deployer,
    args: [pool.address, assetAddress, yieldSource.address],
    log: true,
  });

  const deployedYieldSource = await get("VeilYieldSource");
  const yieldSourceContract = await hre.ethers.getContractAt("VeilYieldSource", deployedYieldSource.address);
  const configuredPrizeVault = await yieldSourceContract.prizeVault();

  if (configuredPrizeVault === hre.ethers.ZeroAddress) {
    await execute("VeilYieldSource", { from: deployer, log: true }, "configurePrizeVault", prizeVault.address);
  } else if (configuredPrizeVault.toLowerCase() !== prizeVault.address.toLowerCase()) {
    throw new Error(`VeilYieldSource already points to a different prize vault: ${configuredPrizeVault}`);
  }

  console.log("VEIL deployment");
  console.log(`  asset:       ${assetAddress}`);
  console.log(`  pool:        ${pool.address}`);
  console.log(`  draw period: ${drawPeriod} seconds`);
  console.log(`  yieldSource: ${yieldSource.address}`);
  console.log(`  prizeVault:  ${prizeVault.address}`);
  if (!configuredAsset) {
    console.log("  asset mode:  TEST-ONLY MockConfidentialToken");
  }
};

export default func;
func.id = "deploy_veil_v1";
func.tags = ["VEIL"];
