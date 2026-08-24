import { expect } from "chai";
import { deployments, ethers } from "hardhat";

import {
  V2_DEPLOYMENT_NAMES,
  batchAgeForV2Deployment,
  bufferReserveBpsForV2Deployment,
  drawPeriodForV2Deployment,
  valuationHaircutBpsForV2Deployment,
} from "../deploy/deploy-v2";

describe("UNVEIL V2 deployment", function () {
  beforeEach(async function () {
    await deployments.fixture(["UNVEIL_V2"]);
  });

  it("deploys the fresh V2 records in the reviewed route and verifies immutable wiring", async function () {
    const records = await Promise.all(
      Object.values(V2_DEPLOYMENT_NAMES).map(async (name) => [name, await deployments.get(name)] as const),
    );
    for (const [name, record] of records) {
      expect(record.address, name).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(await ethers.provider.getCode(record.address), name).to.not.equal("0x");
    }

    const addressOf = (name: keyof typeof V2_DEPLOYMENT_NAMES) =>
      records.find(([recordName]) => recordName === V2_DEPLOYMENT_NAMES[name])?.[1].address as string;
    const asset = addressOf("asset");
    const principal = addressOf("principal");
    const vault = addressOf("vault");
    const shares = addressOf("shares");
    const depositBatcher = addressOf("depositBatcher");
    const withdrawalBatcher = addressOf("withdrawalBatcher");
    const pool = addressOf("pool");
    const prizeVault = addressOf("prizeVault");
    const manager = addressOf("manager");

    const poolContract = await ethers.getContractAt("VeilPoolV2", pool);
    const managerContract = await ethers.getContractAt("VeilStrategyManagerV2", manager);
    const prizeVaultContract = await ethers.getContractAt("VeilPrizeVaultV2", prizeVault);
    const principalContract = await ethers.getContractAt("MockUSDCConfidentialWrapper", principal);
    const sharesContract = await ethers.getContractAt("MockYieldVaultShareConfidentialWrapper", shares);
    const vaultContract = await ethers.getContractAt("MockYieldVault4626", vault);
    const depositsContract = await ethers.getContractAt("VeilDepositBatcher", depositBatcher);
    const withdrawalsContract = await ethers.getContractAt("VeilWithdrawalBatcher", withdrawalBatcher);

    expect(await poolContract.strategyManager()).to.equal(manager);
    expect(await poolContract.strategyManagerConfigured()).to.equal(true);
    expect(await poolContract.asset()).to.equal(principal);
    expect(await managerContract.pool()).to.equal(pool);
    expect(await managerContract.principalAsset()).to.equal(principal);
    expect(await managerContract.strategyShareAsset()).to.equal(shares);
    expect(await managerContract.depositBatcher()).to.equal(depositBatcher);
    expect(await managerContract.withdrawalBatcher()).to.equal(withdrawalBatcher);
    expect(await managerContract.vault()).to.equal(vault);
    expect(await managerContract.prizeVault()).to.equal(prizeVault);
    expect(await prizeVaultContract.pool()).to.equal(pool);
    expect(await prizeVaultContract.asset()).to.equal(shares);
    expect(await principalContract.underlying()).to.equal(asset);
    expect(await sharesContract.underlying()).to.equal(vault);
    expect(await vaultContract.asset()).to.equal(asset);
    expect(await depositsContract.fromToken()).to.equal(principal);
    expect(await depositsContract.toToken()).to.equal(shares);
    expect(await depositsContract.vault()).to.equal(vault);
    expect(await withdrawalsContract.fromToken()).to.equal(shares);
    expect(await withdrawalsContract.toToken()).to.equal(principal);
    expect(await withdrawalsContract.vault()).to.equal(vault);
  });

  it("uses explicit V2 parameters and local production-style defaults", async function () {
    expect(drawPeriodForV2Deployment(true)).to.equal(900);
    expect(batchAgeForV2Deployment(true)).to.equal(120);
    expect(
      await (
        await ethers.getContractAt("VeilPoolV2", (await deployments.get(V2_DEPLOYMENT_NAMES.pool)).address)
      ).drawPeriod(),
    ).to.equal(BigInt(drawPeriodForV2Deployment(false)));
    expect(
      await (
        await ethers.getContractAt(
          "VeilDepositBatcher",
          (await deployments.get(V2_DEPLOYMENT_NAMES.depositBatcher)).address,
        )
      ).minimumBatchAge(),
    ).to.equal(BigInt(batchAgeForV2Deployment(false)));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV2",
          (await deployments.get(V2_DEPLOYMENT_NAMES.manager)).address,
        )
      ).bufferReserveBps(),
    ).to.equal(BigInt(bufferReserveBpsForV2Deployment()));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV2",
          (await deployments.get(V2_DEPLOYMENT_NAMES.manager)).address,
        )
      ).valuationHaircutBps(),
    ).to.equal(BigInt(valuationHaircutBpsForV2Deployment()));

    const originalDraw = process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS;
    const originalBatch = process.env.UNVEIL_V2_BATCH_AGE_SECONDS;
    try {
      process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS = "1234";
      process.env.UNVEIL_V2_BATCH_AGE_SECONDS = "567";
      expect(drawPeriodForV2Deployment(true)).to.equal(1234);
      expect(batchAgeForV2Deployment(true)).to.equal(567);
    } finally {
      if (originalDraw === undefined) delete process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS;
      else process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS = originalDraw;
      if (originalBatch === undefined) delete process.env.UNVEIL_V2_BATCH_AGE_SECONDS;
      else process.env.UNVEIL_V2_BATCH_AGE_SECONDS = originalBatch;
    }
  });

  it("rejects invalid V2 timing and BPS configuration", async function () {
    const original = {
      draw: process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS,
      batch: process.env.UNVEIL_V2_BATCH_AGE_SECONDS,
      reserve: process.env.UNVEIL_V2_BUFFER_RESERVE_BPS,
      haircut: process.env.UNVEIL_V2_VALUATION_HAIRCUT_BPS,
    };
    try {
      process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS = "0";
      expect(() => drawPeriodForV2Deployment(false)).to.throw("UNVEIL_V2_DRAW_PERIOD_SECONDS");
      process.env.UNVEIL_V2_BATCH_AGE_SECONDS = "not-a-number";
      expect(() => batchAgeForV2Deployment(false)).to.throw("UNVEIL_V2_BATCH_AGE_SECONDS");
      process.env.UNVEIL_V2_BUFFER_RESERVE_BPS = "10001";
      expect(() => bufferReserveBpsForV2Deployment()).to.throw("UNVEIL_V2_BUFFER_RESERVE_BPS");
      process.env.UNVEIL_V2_VALUATION_HAIRCUT_BPS = "10000";
      expect(() => valuationHaircutBpsForV2Deployment()).to.throw("UNVEIL_V2_VALUATION_HAIRCUT_BPS");
    } finally {
      if (original.draw === undefined) delete process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS;
      else process.env.UNVEIL_V2_DRAW_PERIOD_SECONDS = original.draw;
      if (original.batch === undefined) delete process.env.UNVEIL_V2_BATCH_AGE_SECONDS;
      else process.env.UNVEIL_V2_BATCH_AGE_SECONDS = original.batch;
      if (original.reserve === undefined) delete process.env.UNVEIL_V2_BUFFER_RESERVE_BPS;
      else process.env.UNVEIL_V2_BUFFER_RESERVE_BPS = original.reserve;
      if (original.haircut === undefined) delete process.env.UNVEIL_V2_VALUATION_HAIRCUT_BPS;
      else process.env.UNVEIL_V2_VALUATION_HAIRCUT_BPS = original.haircut;
    }
  });
});
