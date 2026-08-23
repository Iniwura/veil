import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, get } = hre.deployments;

  const isSepolia = hre.network.config.chainId === 11155111;
  const configuredAsset = process.env.UNVEIL_ASSET_ADDRESS?.trim() || process.env.VEIL_ASSET_ADDRESS?.trim();
  const deployDemoAsset = process.env.UNVEIL_DEPLOY_DEMO_ASSET === "true" || process.env.VEIL_DEPLOY_DEMO_ASSET === "true";
  const configuredDrawPeriod = process.env.UNVEIL_DRAW_PERIOD_SECONDS?.trim();
  const drawPeriod = BigInt(configuredDrawPeriod || (isSepolia ? "900" : "86400"));

  if (drawPeriod <= 0n || drawPeriod > 31_536_000n) {
    throw new Error("UNVEIL_DRAW_PERIOD_SECONDS must be between 1 second and 365 days");
  }

  if (isSepolia && !configuredAsset && !deployDemoAsset) {
    throw new Error(
      "Sepolia deployment requires UNVEIL_ASSET_ADDRESS or explicit UNVEIL_DEPLOY_DEMO_ASSET=true for the test-only asset",
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
    args: [assetAddress, deployer],
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

  const poolContract = await hre.ethers.getContractAt("VeilPool", pool.address);
  const nextDrawClosesAt = await poolContract.nextDrawClosesAt();

  console.log("UNVEIL deployment");
  console.log(`  asset:       ${assetAddress}`);
  console.log(`  pool:        ${pool.address}`);
  console.log(`  yieldSource: ${yieldSource.address}`);
  console.log(`  prizeVault:  ${prizeVault.address}`);
  console.log(`  drawPeriod:  ${drawPeriod.toString()} seconds`);
  console.log(`  nextClose:   ${nextDrawClosesAt.toString()}`);
  if (!configuredAsset) {
    console.log("  asset mode:  TEST-ONLY MockConfidentialToken");
  }
};

export default func;
func.id = "deploy_unveil_v2";
func.tags = ["UNVEIL", "VEIL"];
