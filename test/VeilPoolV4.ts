import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV4,
  VeilPrizeVaultV3,
  VeilStrategyManagerV2TestHarness,
  VeilWithdrawalBatcher,
} from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

type System = {
  asset: MockUSDC;
  source: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV4;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV2TestHarness;
};

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const SHARD_COUNT = 24;

let signers: Signers;

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
  return { asset, source, vault, shares, deposits, withdrawals, pool, prizeVault, manager };
}

async function fundAndApprove(system: System, signer: HardhatEthersSigner, amount = 10_000n) {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.source.getAddress(), amount)).wait();
  await (await system.source.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.source.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number) {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
}

async function advanceToClose(pool: VeilPoolV4) {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function snapshotCurrentRound(pool: VeilPoolV4) {
  const roundId = await pool.nextRoundId();
  await (await pool.beginSnapshotRound()).wait();
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    await (await pool.snapshotRoundShard(roundId, shard)).wait();
  }
  await (await pool.completeSnapshotRound(roundId)).wait();
  return roundId;
}

async function decryptSnapshotWeight(system: System, signer: HardhatEthersSigner, roundId: bigint) {
  const handle = await system.pool.connect(signer).encryptedSnapshotWeightOf(roundId);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.pool.getAddress(), signer);
}

async function runPrize(system: System, roundId: bigint, prizeIndex: number) {
  await (await system.pool.connect(signers.outsider).drawPrizeShard(roundId, prizeIndex)).wait();
  const shardHandle = await system.pool.getEncryptedPrizeShard(roundId, prizeIndex);
  const shardProof = await fhevm.publicDecrypt([shardHandle]);
  const shardKey = Object.keys(shardProof.clearValues)[0] as keyof typeof shardProof.clearValues;
  const shard = Number(shardProof.clearValues[shardKey]);
  await (
    await system.pool
      .connect(signers.outsider)
      .finalizePrizeShard(roundId, prizeIndex, shard, shardProof.decryptionProof)
  ).wait();

  await (await system.pool.connect(signers.outsider).drawPrizeMember(roundId, prizeIndex)).wait();
  const winnerHandle = await system.pool.getEncryptedPrizeWinner(roundId, prizeIndex);
  const winnerProof = await fhevm.publicDecrypt([winnerHandle]);
  const winnerKey = Object.keys(winnerProof.clearValues)[0] as keyof typeof winnerProof.clearValues;
  const winner = String(winnerProof.clearValues[winnerKey]);
  const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [winner]);
  await (
    await system.pool
      .connect(signers.outsider)
      .finalizePrizeMember(roundId, prizeIndex, encodedWinner, winnerProof.decryptionProof)
  ).wait();

  return { shard, winner };
}

describe("VeilPoolV4", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { deployer: accounts[0], alice: accounts[1], bob: accounts[2], outsider: accounts[3] };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("preserves confidential custody and full-round maturity across the 24-shard snapshot", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    expect(await system.pool.MAX_ACTIVE_SAVERS()).to.equal(576);
    expect(await system.pool.seatEligibleFromRoundId(signers.alice.address)).to.equal(2);
    expect(await system.pool.seatEligibleFromRoundId(signers.bob.address)).to.equal(2);

    await advanceToClose(system.pool);
    expect(await snapshotCurrentRound(system.pool)).to.equal(1);
    expect(await system.pool.getDrawState(1)).to.equal(5);

    await advanceToClose(system.pool);
    expect(await snapshotCurrentRound(system.pool)).to.equal(2);
    expect(await system.pool.getDrawState(2)).to.equal(1);

    const info = await system.pool.getDrawInfo(2);
    expect(info.participantCount).to.equal(2);
    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.bob, 2n)).to.equal(100n);
  });

  it("finalizes three sharded prizes and remains compatible with V3 prize funding", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system.pool);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system.pool);

    const eligible = new Set([signers.alice.address.toLowerCase(), signers.bob.address.toLowerCase()]);
    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex++) {
      const result = await runPrize(system, 2n, prizeIndex);
      expect(result.shard).to.be.lessThan(SHARD_COUNT);
      expect(eligible.has(result.winner.toLowerCase())).to.equal(true);
    }

    expect(await system.pool.getDrawState(2)).to.equal(3);
    const info = await system.pool.getDrawInfo(2);
    expect(info.drawnPrizeCount).to.equal(3);
    expect(info.finalizedPrizeCount).to.equal(3);
    expect(info.winningPrizeCount).to.equal(3);

    await (await system.manager.processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2);
    await (await system.manager.processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(3);

    const funded = await system.prizeVault.roundStatus(2);
    expect(funded.funded).to.equal(true);
  });
});
