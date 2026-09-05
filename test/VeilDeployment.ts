import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { drawPeriodForDeployment } from "../deploy/deploy";

describe("VEIL deployment", function () {
  beforeEach(async function () {
    await deployments.fixture(["VEIL"]);
  });

  it("deploys and wires the confidential custody stack", async function () {
    const asset = await deployments.get("MockConfidentialToken");
    const poolDeployment = await deployments.get("VeilPool");
    const yieldDeployment = await deployments.get("VeilYieldSource");
    const vaultDeployment = await deployments.get("VeilPrizeVault");

    const pool = await ethers.getContractAt("VeilPool", poolDeployment.address);
    const yieldSource = await ethers.getContractAt("VeilYieldSource", yieldDeployment.address);
    const prizeVault = await ethers.getContractAt("VeilPrizeVault", vaultDeployment.address);

    expect(await pool.asset()).to.equal(asset.address);
    expect(await pool.drawPeriod()).to.equal(86_400);
    expect(await pool.nextDrawOpensAt()).to.be.greaterThan(0);
    expect((await pool.getDrawSchedule()).ready).to.equal(false);
    expect(await yieldSource.asset()).to.equal(asset.address);
    expect(await yieldSource.prizeVault()).to.equal(vaultDeployment.address);
    expect(await prizeVault.pool()).to.equal(poolDeployment.address);
    expect(await prizeVault.asset()).to.equal(asset.address);
    expect(await prizeVault.yieldSource()).to.equal(yieldDeployment.address);
  });

  it("selects explicit and network-specific draw cadence defaults", async function () {
    const original = process.env.VEIL_DRAW_PERIOD_SECONDS;

    try {
      delete process.env.VEIL_DRAW_PERIOD_SECONDS;
      expect(drawPeriodForDeployment(true)).to.equal(900);
      expect(drawPeriodForDeployment(false)).to.equal(86_400);

      process.env.VEIL_DRAW_PERIOD_SECONDS = "1234";
      expect(drawPeriodForDeployment(true)).to.equal(1234);
      expect(drawPeriodForDeployment(false)).to.equal(1234);
    } finally {
      if (original === undefined) delete process.env.VEIL_DRAW_PERIOD_SECONDS;
      else process.env.VEIL_DRAW_PERIOD_SECONDS = original;
    }
  });
});
