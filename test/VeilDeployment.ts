import { expect } from "chai";
import { deployments, ethers } from "hardhat";

describe("UNVEIL deployment", function () {
  beforeEach(async function () {
    await deployments.fixture(["UNVEIL"]);
  });

  it("deploys and wires the confidential prize-savings stack", async function () {
    const [deployer] = await ethers.getSigners();
    const asset = await deployments.get("MockConfidentialToken");
    const poolDeployment = await deployments.get("VeilPool");
    const yieldDeployment = await deployments.get("VeilYieldSource");
    const vaultDeployment = await deployments.get("VeilPrizeVault");

    const pool = await ethers.getContractAt("VeilPool", poolDeployment.address);
    const yieldSource = await ethers.getContractAt("VeilYieldSource", yieldDeployment.address);
    const prizeVault = await ethers.getContractAt("VeilPrizeVault", vaultDeployment.address);

    expect(await pool.asset()).to.equal(asset.address);
    expect(await pool.drawPeriod()).to.be.greaterThan(0);
    expect(await pool.nextDrawClosesAt()).to.be.greaterThan(0);
    expect(await yieldSource.asset()).to.equal(asset.address);
    expect(await yieldSource.pool()).to.equal(poolDeployment.address);
    expect(await yieldSource.configurationAdmin()).to.equal(deployer.address);
    expect(await yieldSource.strategyOperator()).to.equal(deployer.address);
    expect(await yieldSource.yieldRoundId()).to.equal(1);
    expect(await yieldSource.prizeVault()).to.equal(vaultDeployment.address);
    expect(await prizeVault.pool()).to.equal(poolDeployment.address);
    expect(await prizeVault.asset()).to.equal(asset.address);
    expect(await prizeVault.yieldSource()).to.equal(yieldDeployment.address);
  });
});
