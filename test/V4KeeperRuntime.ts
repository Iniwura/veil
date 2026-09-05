import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { runKeeperCycle } from "../scripts/v4-keeper";
import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilDrawBatcher,
  VeilPoolV4,
  VeilPoolV4Helper,
  VeilPrizeVaultV3,
  VeilSnapshotBatcher,
  VeilStrategyManagerV2TestHarness,
  VeilWithdrawalBatcher,
} from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

type System = {
  asset: MockUSDC;
  source: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV4;
  seatKeeper: VeilPoolV4Helper;
  snapshotBatcher: VeilSnapshotBatcher;
  drawBatcher: VeilDrawBatcher;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV2TestHarness;
};

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const KEEPER_ADDRESS_ENV = [
  "UNVEIL_V4_POOL_ADDRESS",
  "UNVEIL_V4_SNAPSHOT_BATCHER_ADDRESS",
  "UNVEIL_V4_DRAW_BATCHER_ADDRESS",
  "UNVEIL_V4_PRIZE_VAULT_ADDRESS",
  "UNVEIL_V4_MANAGER_ADDRESS",
  "UNVEIL_V4_KEEPER_FROM_BLOCK",
  "UNVEIL_V4_KEEPER_ALLOW_LOCAL",
  "UNVEIL_V4_KEEPER_MAX_STEPS",
] as const;

let signers: Signers;
let previousKeeperEnv: Partial<Record<(typeof KEEPER_ADDRESS_ENV)[number], string | undefined>> = {};

async function deploySystem(): Promise<System> {
  const asset = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
  const vault = (await (
    await ethers.getContractFactory("MockYieldVault4626")
  ).deploy(await asset.getAddress())) as MockYieldVault4626;
  const source = (await (
    await ethers.getContractFactory("MockUSDCConfidentialWrapper")
  ).deploy(await asset.getAddress())) as MockUSDCConfidentialWrapper;
  const shares = (await (
    await ethers.getContractFactory("MockYieldVaultShareConfidentialWrapper")
  ).deploy(await vault.getAddress())) as MockYieldVaultShareConfidentialWrapper;
  const deposits = (await (
    await ethers.getContractFactory("VeilDepositBatcher")
  ).deploy(
    await source.getAddress(),
    await shares.getAddress(),
    await vault.getAddress(),
    BATCH_AGE,
  )) as VeilDepositBatcher;
  const withdrawals = (await (
    await ethers.getContractFactory("VeilWithdrawalBatcher")
  ).deploy(
    await shares.getAddress(),
    await source.getAddress(),
    await vault.getAddress(),
    BATCH_AGE,
  )) as VeilWithdrawalBatcher;
  const pool = (await (
    await ethers.getContractFactory("VeilPoolV4")
  ).deploy(await source.getAddress(), DRAW_PERIOD)) as VeilPoolV4;
  const seatKeeper = (await ethers.getContractAt("VeilPoolV4Helper", await pool.seatKeeper())) as VeilPoolV4Helper;
  const snapshotBatcher = (await (
    await ethers.getContractFactory("VeilSnapshotBatcher")
  ).deploy(await pool.getAddress())) as VeilSnapshotBatcher;
  const drawBatcher = (await (
    await ethers.getContractFactory("VeilDrawBatcher")
  ).deploy(await pool.getAddress())) as VeilDrawBatcher;
  const prizeVault = (await (
    await ethers.getContractFactory("VeilPrizeVaultV3")
  ).deploy(await pool.getAddress(), await shares.getAddress())) as VeilPrizeVaultV3;
  const manager = (await (
    await ethers.getContractFactory("VeilStrategyManagerV2TestHarness")
  ).deploy(
    await pool.getAddress(),
    await source.getAddress(),
    await shares.getAddress(),
    await deposits.getAddress(),
    await withdrawals.getAddress(),
    await vault.getAddress(),
    await prizeVault.getAddress(),
    2_000,
    0,
  )) as VeilStrategyManagerV2TestHarness;

  await (await pool.configureStrategyManager(await manager.getAddress())).wait();
  return {
    asset,
    source,
    vault,
    shares,
    deposits,
    withdrawals,
    pool,
    seatKeeper,
    snapshotBatcher,
    drawBatcher,
    prizeVault,
    manager,
  };
}

async function configureKeeperEnv(system: System, fromBlock: number): Promise<void> {
  previousKeeperEnv = {};
  for (const name of KEEPER_ADDRESS_ENV) previousKeeperEnv[name] = process.env[name];
  process.env.UNVEIL_V4_POOL_ADDRESS = await system.pool.getAddress();
  process.env.UNVEIL_V4_SNAPSHOT_BATCHER_ADDRESS = await system.snapshotBatcher.getAddress();
  process.env.UNVEIL_V4_DRAW_BATCHER_ADDRESS = await system.drawBatcher.getAddress();
  process.env.UNVEIL_V4_PRIZE_VAULT_ADDRESS = await system.prizeVault.getAddress();
  process.env.UNVEIL_V4_MANAGER_ADDRESS = await system.manager.getAddress();
  process.env.UNVEIL_V4_KEEPER_FROM_BLOCK = String(fromBlock);
  process.env.UNVEIL_V4_KEEPER_ALLOW_LOCAL = "true";
  process.env.UNVEIL_V4_KEEPER_MAX_STEPS = "1";
}

function restoreKeeperEnv(): void {
  for (const name of KEEPER_ADDRESS_ENV) {
    const value = previousKeeperEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function fundAndApprove(system: System, signer: HardhatEthersSigner, amount = 10_000n): Promise<void> {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.source.getAddress(), amount)).wait();
  await (await system.source.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.source.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number): Promise<void> {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
}

async function advanceToClose(pool: VeilPoolV4): Promise<void> {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
}

describe("V4 keeper runtime", function () {
  let system: System;

  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { deployer: accounts[0], alice: accounts[1], bob: accounts[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    const fromBlock = await ethers.provider.getBlockNumber();
    system = await deploySystem();
    await configureKeeperEnv(system, fromBlock);
  });

  afterEach(function () {
    restoreKeeperEnv();
  });

  it("reads the schedule during an idle cycle without missing ABI methods", async function () {
    const result = await runKeeperCycle();
    expect(result.idle).to.equal(true);
    expect(result.transactions).to.equal(0);
  });

  it("finalizes pending seats and then reads seated and expiry state", async function () {
    await fundAndApprove(system, signers.alice);
    await deposit(system, signers.alice, 100);

    expect(await system.seatKeeper.pendingSeatAttestationRequestId(signers.alice.address)).to.equal(1n);
    const finalized = await runKeeperCycle();
    expect(finalized.actions.some((action) => action.includes("finalize seat attestation"))).to.equal(true);
    expect(await system.seatKeeper.pendingSeatAttestationRequestId(signers.alice.address)).to.equal(0n);
    expect(await system.pool.seated(signers.alice.address)).to.equal(true);
    expect(await system.pool.playerCount()).to.equal(1);

    const idle = await runKeeperCycle();
    expect(idle.idle).to.equal(true);
    expect(idle.actions).to.deep.equal([]);
    expect(await system.pool.seatExpiresAt(signers.alice.address)).to.be.greaterThan(0n);
  });

  it("begins snapshot progression through the keeper after the draw window closes", async function () {
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 200);

    const finalized = await runKeeperCycle();
    expect(finalized.actions.filter((action) => action.includes("finalize seat attestation"))).to.have.length(2);
    await advanceToClose(system.pool);

    const progressed = await runKeeperCycle();
    expect(progressed.actions.some((action) => action.includes("begin"))).to.equal(true);
    const snapshot = await system.pool.getShardedSnapshotRound(1n);
    expect(snapshot.begun).to.equal(true);
    expect(await system.pool.getDrawState(1n)).to.equal(5n);
  });
});
