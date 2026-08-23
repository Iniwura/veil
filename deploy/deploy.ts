import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const ZAMA_SEPOLIA_CUSDC_MOCK = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const ZAMA_SEPOLIA_USDC_MOCK = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, get } = hre.deployments;

  const isSepolia = hre.network.config.chainId === 11155111;
  const configuredAsset = process.env.UNVEIL_ASSET_ADDRESS?.trim() || process.env.VEIL_ASSET_ADDRESS?.trim();
  const deployLocalDemoAsset =
    process.env.UNVEIL_DEPLOY_DEMO_ASSET === "true" || process.env.VEIL_DEPLOY_DEMO_ASSET === "true";
  const configuredDrawPeriod = process.env.UNVEIL_DRAW_PERIOD_SECONDS?.trim();
  const drawPeriod = BigInt(configuredDrawPeriod || (isSepolia ? "900" : "86400"));
  const strategyOperator = process.env.UNVEIL_STRATEGY_OPERATOR_ADDRESS?.trim() || deployer;

  if (drawPeriod <= 0n || drawPeriod > 31_536_000n) {
    throw new Error("UNVEIL_DRAW_PERIOD_SECONDS must be between 1 second and 365 days");
  }
  if (!hre.ethers.isAddress(strategyOperator) || strategyOperator === hre.ethers.ZeroAddress) {
    throw new Error("UNVEIL_STRATEGY_OPERATOR_ADDRESS must be a non-zero Ethereum address");
  }

  let assetAddress = configuredAsset;
  let assetMode = "configured ERC-7984 asset";

  if (!assetAddress && isSepolia && !deployLocalDemoAsset) {
    assetAddress = ZAMA_SEPOLIA_CUSDC_MOCK;
    assetMode = `official Zama cUSDCMock wrapper (underlying ${ZAMA_SEPOLIA_USDC_MOCK})`;
  }

  if (!assetAddress) {
    const demoAsset = await deploy("MockConfidentialToken", {
      from: deployer,
      log: true,
    });
    assetAddress = demoAsset.address;
    assetMode = "local/test-only MockConfidentialToken";
  }

  const pool = await deploy("VeilPool", {
    from: deployer,
    args: [assetAddress, drawPeriod],
    log: true,
  });

  const yieldSource = await deploy("VeilYieldSource", {
    from: deployer,
    args: [assetAddress, pool.address, strategyOperator],
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
  console.log(`  strategy:    ${strategyOperator}`);
  console.log(`  drawPeriod:  ${drawPeriod.toString()} seconds`);
  console.log(`  nextClose:   ${nextDrawClosesAt.toString()}`);
  console.log(`  asset mode:  ${assetMode}`);
};

export default func;
func.id = "deploy_unveil_v4";
func.tags = ["UNVEIL", "VEIL"];
