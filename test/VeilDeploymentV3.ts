import { expect } from "chai";
import { deployments, ethers } from "hardhat";

import {
  V3_DEPLOYMENT_NAMES,
  assertV3DeploymentArgumentsMatch,
  batchAgeForV3Deployment,
  bufferReserveBpsForV3Deployment,
  drawPeriodForV3Deployment,
  v3DeploymentArgumentsMatch,
  valuationHaircutBpsForV3Deployment,
} from "../deploy/deploy-v3";

describe("UNVEIL V3 deployment", function () {
  beforeEach(async function () {
    await deployments.fixture(["UNVEIL_V3"]);
  });

  it("deploys an isolated V3 stack with the reviewed wiring", async function () {
    const records = await Promise.all(
      Object.values(V3_DEPLOYMENT_NAMES).map(async (name) => [name, await deployments.get(name)] as const),
    );
    for (const [name, record] of records) {
      expect(record.address, name).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(await ethers.provider.getCode(record.address), name).to.not.equal("0x");
    }

    const addressOf = (name: keyof typeof V3_DEPLOYMENT_NAMES) =>
      records.find(([recordName]) => recordName === V3_DEPLOYMENT_NAMES[name])?.[1].address as string;
    const asset = addressOf("asset");
    const principal = addressOf("principal");
    const vault = addressOf("vault");
    const shares = addressOf("shares");
    const depositBatcher = addressOf("depositBatcher");
    const withdrawalBatcher = addressOf("withdrawalBatcher");
    const pool = addressOf("pool");
    const prizeVault = addressOf("prizeVault");
    const manager = addressOf("manager");

    const poolContract = await ethers.getContractAt("VeilPoolV3", pool);
    const managerContract = await ethers.getContractAt("VeilStrategyManagerV3", manager);
    const prizeVaultContract = await ethers.getContractAt("VeilPrizeVaultV3", prizeVault);
    const principalContract = await ethers.getContractAt("MockUSDCConfidentialWrapper", principal);
    const sharesContract = await ethers.getContractAt("MockYieldVaultShareConfidentialWrapper", shares);
    const vaultContract = await ethers.getContractAt("MockYieldVault4626", vault);
    const depositsContract = await ethers.getContractAt("VeilDepositBatcher", depositBatcher);
    const withdrawalsContract = await ethers.getContractAt("VeilWithdrawalBatcher", withdrawalBatcher);

    expect(await poolContract.strategyManager()).to.equal(manager);
    expect(await poolContract.strategyManagerConfigured()).to.equal(true);
    expect(await poolContract.asset()).to.equal(principal);
    expect(await poolContract.MAX_PLAYERS()).to.equal(24n);
    expect(await poolContract.PRIZE_SLOTS()).to.equal(3n);
    expect(await managerContract.pool()).to.equal(pool);
    expect(await managerContract.principalAsset()).to.equal(principal);
    expect(await managerContract.strategyShareAsset()).to.equal(shares);
    expect(await managerContract.depositBatcher()).to.equal(depositBatcher);
    expect(await managerContract.withdrawalBatcher()).to.equal(withdrawalBatcher);
    expect(await managerContract.vault()).to.equal(vault);
    expect(await managerContract.prizeVault()).to.equal(prizeVault);
    expect(await prizeVaultContract.pool()).to.equal(pool);
    expect(await prizeVaultContract.asset()).to.equal(shares);
    expect(await prizeVaultContract.PRIZE_SLOTS()).to.equal(3n);
    expect(await principalContract.underlying()).to.equal(asset);
    expect(await principalContract.symbol()).to.equal("t-cUSDC");
    expect(await sharesContract.underlying()).to.equal(vault);
    expect(await vaultContract.asset()).to.equal(asset);
    expect(await depositsContract.fromToken()).to.equal(principal);
    expect(await depositsContract.toToken()).to.equal(shares);
    expect(await withdrawalsContract.fromToken()).to.equal(shares);
    expect(await withdrawalsContract.toToken()).to.equal(principal);
  });

  it("uses explicit V3 parameters and Sepolia defaults", async function () {
    expect(drawPeriodForV3Deployment(true)).to.equal(900);
    expect(batchAgeForV3Deployment(true)).to.equal(120);
    expect(
      await (
        await ethers.getContractAt("VeilPoolV3", (await deployments.get(V3_DEPLOYMENT_NAMES.pool)).address)
      ).drawPeriod(),
    ).to.equal(BigInt(drawPeriodForV3Deployment(false)));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV3",
          (await deployments.get(V3_DEPLOYMENT_NAMES.manager)).address,
        )
      ).bufferReserveBps(),
    ).to.equal(BigInt(bufferReserveBpsForV3Deployment()));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV3",
          (await deployments.get(V3_DEPLOYMENT_NAMES.manager)).address,
        )
      ).valuationHaircutBps(),
    ).to.equal(BigInt(valuationHaircutBpsForV3Deployment()));
  });

  it("rejects invalid V3 deployment configuration", function () {
    const original = {
      draw: process.env.UNVEIL_V3_DRAW_PERIOD_SECONDS,
      batch: process.env.UNVEIL_V3_BATCH_AGE_SECONDS,
      reserve: process.env.UNVEIL_V3_BUFFER_RESERVE_BPS,
      haircut: process.env.UNVEIL_V3_VALUATION_HAIRCUT_BPS,
    };
    try {
      process.env.UNVEIL_V3_DRAW_PERIOD_SECONDS = "0";
      expect(() => drawPeriodForV3Deployment(false)).to.throw("UNVEIL_V3_DRAW_PERIOD_SECONDS");
      process.env.UNVEIL_V3_BATCH_AGE_SECONDS = "invalid";
      expect(() => batchAgeForV3Deployment(false)).to.throw("UNVEIL_V3_BATCH_AGE_SECONDS");
      process.env.UNVEIL_V3_BUFFER_RESERVE_BPS = "10001";
      expect(() => bufferReserveBpsForV3Deployment()).to.throw("UNVEIL_V3_BUFFER_RESERVE_BPS");
      process.env.UNVEIL_V3_VALUATION_HAIRCUT_BPS = "10000";
      expect(() => valuationHaircutBpsForV3Deployment()).to.throw("UNVEIL_V3_VALUATION_HAIRCUT_BPS");
    } finally {
      if (original.draw === undefined) delete process.env.UNVEIL_V3_DRAW_PERIOD_SECONDS;
      else process.env.UNVEIL_V3_DRAW_PERIOD_SECONDS = original.draw;
      if (original.batch === undefined) delete process.env.UNVEIL_V3_BATCH_AGE_SECONDS;
      else process.env.UNVEIL_V3_BATCH_AGE_SECONDS = original.batch;
      if (original.reserve === undefined) delete process.env.UNVEIL_V3_BUFFER_RESERVE_BPS;
      else process.env.UNVEIL_V3_BUFFER_RESERVE_BPS = original.reserve;
      if (original.haircut === undefined) delete process.env.UNVEIL_V3_VALUATION_HAIRCUT_BPS;
      else process.env.UNVEIL_V3_VALUATION_HAIRCUT_BPS = original.haircut;
    }
  });

  it("reuses only matching V3 records", async function () {
    const first = await deployments.get(V3_DEPLOYMENT_NAMES.pool);
    await deployments.fixture(["UNVEIL_V3"]);
    const second = await deployments.get(V3_DEPLOYMENT_NAMES.pool);

    expect(second.address).to.equal(first.address);
    expect(second.transactionHash ?? second.receipt?.transactionHash).to.equal(
      first.transactionHash ?? first.receipt?.transactionHash,
    );
    expect(v3DeploymentArgumentsMatch(second.args, first.args ?? [])).to.equal(true);
    expect(v3DeploymentArgumentsMatch(second.args, [...(first.args ?? []), 1])).to.equal(false);
    expect(() =>
      assertV3DeploymentArgumentsMatch(V3_DEPLOYMENT_NAMES.pool, second.args, [...(first.args ?? []), 1]),
    ).to.throw("constructor arguments differ");
  });
});
