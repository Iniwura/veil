import { expect } from "chai";
import { deployments, ethers } from "hardhat";

import {
  V4_DEPLOYMENT_NAMES,
  assertV4DeploymentArgumentsMatch,
  batchAgeForV4Deployment,
  bufferReserveBpsForV4Deployment,
  drawPeriodForV4Deployment,
  v4DeploymentArgumentsMatch,
  valuationHaircutBpsForV4Deployment,
} from "../deploy/deploy-v4";

describe("UNVEIL V4 deployment", function () {
  beforeEach(async function () {
    await deployments.fixture(["UNVEIL_V4"]);
  });

  it("deploys an isolated 576-seat V4 stack with reviewed wiring", async function () {
    const records = await Promise.all(
      Object.values(V4_DEPLOYMENT_NAMES).map(async (name) => [name, await deployments.get(name)] as const),
    );
    for (const [name, record] of records) {
      expect(record.address, name).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(await ethers.provider.getCode(record.address), name).to.not.equal("0x");
    }

    const addressOf = (name: keyof typeof V4_DEPLOYMENT_NAMES) =>
      records.find(([recordName]) => recordName === V4_DEPLOYMENT_NAMES[name])?.[1].address as string;
    const asset = addressOf("asset");
    const principal = addressOf("principal");
    const vault = addressOf("vault");
    const shares = addressOf("shares");
    const depositBatcher = addressOf("depositBatcher");
    const withdrawalBatcher = addressOf("withdrawalBatcher");
    const pool = addressOf("pool");
    const snapshotBatcher = addressOf("snapshotBatcher");
    const drawBatcher = addressOf("drawBatcher");
    const prizeVault = addressOf("prizeVault");
    const manager = addressOf("manager");

    const poolContract = await ethers.getContractAt("VeilPoolV4", pool);
    const managerContract = await ethers.getContractAt("VeilStrategyManagerV3", manager);
    const prizeVaultContract = await ethers.getContractAt("VeilPrizeVaultV3", prizeVault);
    const principalContract = await ethers.getContractAt("MockUSDCConfidentialWrapper", principal);
    const sharesContract = await ethers.getContractAt("MockYieldVaultShareConfidentialWrapper", shares);
    const vaultContract = await ethers.getContractAt("MockYieldVault4626", vault);
    const depositsContract = await ethers.getContractAt("VeilDepositBatcher", depositBatcher);
    const withdrawalsContract = await ethers.getContractAt("VeilWithdrawalBatcher", withdrawalBatcher);
    const snapshotBatcherContract = await ethers.getContractAt("VeilSnapshotBatcher", snapshotBatcher);
    const drawBatcherContract = await ethers.getContractAt("VeilDrawBatcher", drawBatcher);

    expect(await poolContract.strategyManager()).to.equal(manager);
    expect(await poolContract.strategyManagerConfigured()).to.equal(true);
    expect(await poolContract.asset()).to.equal(principal);
    expect(await poolContract.SHARD_COUNT()).to.equal(24n);
    expect(await poolContract.SHARD_SIZE()).to.equal(24n);
    expect(await poolContract.MAX_ACTIVE_SAVERS()).to.equal(576n);
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
    expect(await snapshotBatcherContract.pool()).to.equal(pool);
    expect(await drawBatcherContract.pool()).to.equal(pool);
  });

  it("uses explicit V4 parameters and Sepolia defaults", async function () {
    expect(drawPeriodForV4Deployment(true)).to.equal(900);
    expect(batchAgeForV4Deployment(true)).to.equal(120);
    expect(
      await (
        await ethers.getContractAt("VeilPoolV4", (await deployments.get(V4_DEPLOYMENT_NAMES.pool)).address)
      ).drawPeriod(),
    ).to.equal(BigInt(drawPeriodForV4Deployment(false)));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV3",
          (await deployments.get(V4_DEPLOYMENT_NAMES.manager)).address,
        )
      ).bufferReserveBps(),
    ).to.equal(BigInt(bufferReserveBpsForV4Deployment()));
    expect(
      await (
        await ethers.getContractAt(
          "VeilStrategyManagerV3",
          (await deployments.get(V4_DEPLOYMENT_NAMES.manager)).address,
        )
      ).valuationHaircutBps(),
    ).to.equal(BigInt(valuationHaircutBpsForV4Deployment()));
  });

  it("rejects invalid V4 deployment configuration", function () {
    const original = {
      draw: process.env.UNVEIL_V4_DRAW_PERIOD_SECONDS,
      batch: process.env.UNVEIL_V4_BATCH_AGE_SECONDS,
      reserve: process.env.UNVEIL_V4_BUFFER_RESERVE_BPS,
      haircut: process.env.UNVEIL_V4_VALUATION_HAIRCUT_BPS,
    };
    try {
      process.env.UNVEIL_V4_DRAW_PERIOD_SECONDS = "0";
      expect(() => drawPeriodForV4Deployment(false)).to.throw("UNVEIL_V4_DRAW_PERIOD_SECONDS");
      process.env.UNVEIL_V4_BATCH_AGE_SECONDS = "invalid";
      expect(() => batchAgeForV4Deployment(false)).to.throw("UNVEIL_V4_BATCH_AGE_SECONDS");
      process.env.UNVEIL_V4_BUFFER_RESERVE_BPS = "10001";
      expect(() => bufferReserveBpsForV4Deployment()).to.throw("UNVEIL_V4_BUFFER_RESERVE_BPS");
      process.env.UNVEIL_V4_VALUATION_HAIRCUT_BPS = "10000";
      expect(() => valuationHaircutBpsForV4Deployment()).to.throw("UNVEIL_V4_VALUATION_HAIRCUT_BPS");
    } finally {
      if (original.draw === undefined) delete process.env.UNVEIL_V4_DRAW_PERIOD_SECONDS;
      else process.env.UNVEIL_V4_DRAW_PERIOD_SECONDS = original.draw;
      if (original.batch === undefined) delete process.env.UNVEIL_V4_BATCH_AGE_SECONDS;
      else process.env.UNVEIL_V4_BATCH_AGE_SECONDS = original.batch;
      if (original.reserve === undefined) delete process.env.UNVEIL_V4_BUFFER_RESERVE_BPS;
      else process.env.UNVEIL_V4_BUFFER_RESERVE_BPS = original.reserve;
      if (original.haircut === undefined) delete process.env.UNVEIL_V4_VALUATION_HAIRCUT_BPS;
      else process.env.UNVEIL_V4_VALUATION_HAIRCUT_BPS = original.haircut;
    }
  });

  it("reuses only matching V4 records", async function () {
    const first = await deployments.get(V4_DEPLOYMENT_NAMES.pool);
    await deployments.fixture(["UNVEIL_V4"]);
    const second = await deployments.get(V4_DEPLOYMENT_NAMES.pool);

    expect(second.address).to.equal(first.address);
    expect(second.transactionHash ?? second.receipt?.transactionHash).to.equal(
      first.transactionHash ?? first.receipt?.transactionHash,
    );
    expect(v4DeploymentArgumentsMatch(second.args, first.args ?? [])).to.equal(true);
    expect(v4DeploymentArgumentsMatch(second.args, [...(first.args ?? []), 1])).to.equal(false);
    expect(() =>
      assertV4DeploymentArgumentsMatch(V4_DEPLOYMENT_NAMES.pool, second.args, [...(first.args ?? []), 1]),
    ).to.throw("constructor arguments differ");
  });
});
