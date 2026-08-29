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
  VeilPoolV3,
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
  pool: VeilPoolV3;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV2TestHarness;
};

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;

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
    await ethers.getContractFactory("VeilPoolV3")
  ).deploy(await source.getAddress(), DRAW_PERIOD)) as VeilPoolV3;
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

async function advanceToClose(pool: VeilPoolV3) {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function decryptSnapshotWeight(system: System, signer: HardhatEthersSigner, roundId: bigint) {
  const handle = await system.pool.connect(signer).encryptedSnapshotWeightOf(roundId);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.pool.getAddress(), signer);
}

async function drawAndFinalizePrize(system: System, roundId: bigint, prizeIndex: number): Promise<string> {
  await (await system.pool.connect(signers.outsider).blindDrawPrize(roundId, prizeIndex)).wait();
  const winnerHandle = await system.pool.getEncryptedPrizeWinner(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([winnerHandle]);
  const winner = proof.clearValues[Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues] as string;
  const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [winner]);
  await (
    await system.pool
      .connect(signers.outsider)
      .finalizePrizeWinner(roundId, prizeIndex, encodedWinner, proof.decryptionProof)
  ).wait();
  return winner;
}

describe("VeilPoolV3", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { deployer: accounts[0], alice: accounts[1], bob: accounts[2], outsider: accounts[3] };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("requires a full draw period before new cUSDC principal becomes prize-eligible", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    expect(await system.pool.seatEligibleFromRoundId(signers.alice.address)).to.equal(2n);
    expect(await system.pool.seatEligibleFromRoundId(signers.bob.address)).to.equal(2n);

    await advanceToClose(system.pool);
    expect(await system.pool.getDrawAvailability()).to.equal(2n);
    await (await system.pool.connect(signers.outsider).cancelInsufficientRound()).wait();
    expect(await system.pool.getDrawState(1)).to.equal(5n);

    await advanceToClose(system.pool);
    expect(await system.pool.getDrawAvailability()).to.equal(1n);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();

    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.bob, 2n)).to.equal(100n);
  });

  it("does not let a same-round top-up increase already-mature ticket power", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await advanceToClose(system.pool);
    await (await system.pool.cancelInsufficientRound()).wait();

    await deposit(system, signers.alice, 900);
    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();

    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.bob, 2n)).to.equal(100n);
  });

  it("draws three independently proven prize slots and prevents rerolls", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await advanceToClose(system.pool);
    await (await system.pool.cancelInsufficientRound()).wait();
    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();

    await (await system.pool.blindDrawPrize(2, 0)).wait();
    await expect(system.pool.blindDrawPrize(2, 0)).to.be.revertedWith("Prize already drawn");

    const firstHandle = await system.pool.getEncryptedPrizeWinner(2, 0);
    const firstProof = await fhevm.publicDecrypt([firstHandle]);
    const firstWinner = firstProof.clearValues[
      Object.keys(firstProof.clearValues)[0] as keyof typeof firstProof.clearValues
    ] as string;
    const encodedFirstWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [firstWinner]);
    await (
      await system.pool.finalizePrizeWinner(2, 0, encodedFirstWinner, firstProof.decryptionProof)
    ).wait();

    const secondWinner = await drawAndFinalizePrize(system, 2n, 1);
    const thirdWinner = await drawAndFinalizePrize(system, 2n, 2);
    const eligible = new Set([signers.alice.address.toLowerCase(), signers.bob.address.toLowerCase()]);

    expect(eligible.has(firstWinner.toLowerCase())).to.equal(true);
    expect(eligible.has(secondWinner.toLowerCase())).to.equal(true);
    expect(eligible.has(thirdWinner.toLowerCase())).to.equal(true);

    const info = await system.pool.getDrawInfo(2);
    expect(info[2]).to.equal(3n);
    expect(info[3]).to.equal(3n);
    expect(info[4]).to.equal(3n);
    expect(info[5]).to.equal(3n);
    expect(await system.pool.unsettledRoundCount()).to.equal(0n);
  });

  it("rejects a forged clear winner even when the decryption proof is otherwise valid", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await advanceToClose(system.pool);
    await (await system.pool.cancelInsufficientRound()).wait();
    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();
    await (await system.pool.blindDrawPrize(2, 0)).wait();

    const handle = await system.pool.getEncryptedPrizeWinner(2, 0);
    const proof = await fhevm.publicDecrypt([handle]);
    const forged = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers.outsider.address]);

    await expect(system.pool.finalizePrizeWinner(2, 0, forged, proof.decryptionProof)).to.be.reverted;
  });
});
