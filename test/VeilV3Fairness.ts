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

const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;

type System = {
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV3;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV2TestHarness;
};

async function deploySystem(): Promise<System> {
  const asset = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
  const vault = (await (
    await ethers.getContractFactory("MockYieldVault4626")
  ).deploy(await asset.getAddress())) as MockYieldVault4626;
  const principal = (await (
    await ethers.getContractFactory("MockUSDCConfidentialWrapper")
  ).deploy(await asset.getAddress())) as MockUSDCConfidentialWrapper;
  const shares = (await (
    await ethers.getContractFactory("MockYieldVaultShareConfidentialWrapper")
  ).deploy(await vault.getAddress())) as MockYieldVaultShareConfidentialWrapper;
  const deposits = (await (
    await ethers.getContractFactory("VeilDepositBatcher")
  ).deploy(
    await principal.getAddress(),
    await shares.getAddress(),
    await vault.getAddress(),
    BATCH_AGE,
  )) as VeilDepositBatcher;
  const withdrawals = (await (
    await ethers.getContractFactory("VeilWithdrawalBatcher")
  ).deploy(
    await shares.getAddress(),
    await principal.getAddress(),
    await vault.getAddress(),
    BATCH_AGE,
  )) as VeilWithdrawalBatcher;
  const pool = (await (
    await ethers.getContractFactory("VeilPoolV3")
  ).deploy(await principal.getAddress(), DRAW_PERIOD)) as VeilPoolV3;
  const prizeVault = (await (
    await ethers.getContractFactory("VeilPrizeVaultV3")
  ).deploy(await pool.getAddress(), await shares.getAddress())) as VeilPrizeVaultV3;
  const manager = (await (
    await ethers.getContractFactory("VeilStrategyManagerV2TestHarness")
  ).deploy(
    await pool.getAddress(),
    await principal.getAddress(),
    await shares.getAddress(),
    await deposits.getAddress(),
    await withdrawals.getAddress(),
    await vault.getAddress(),
    await prizeVault.getAddress(),
    2_000,
    0,
  )) as VeilStrategyManagerV2TestHarness;

  await (await pool.configureStrategyManager(await manager.getAddress())).wait();
  return { asset, principal, vault, shares, deposits, withdrawals, pool, prizeVault, manager };
}

async function fundAndApprove(
  system: System,
  signer: HardhatEthersSigner,
  amount = 1_000n,
): Promise<void> {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.principal.getAddress(), amount)).wait();
  await (await system.principal.connect(signer).wrap(signer.address, amount)).wait();
  await (
    await system.principal.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)
  ).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number): Promise<void> {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
}

async function withdraw(system: System, signer: HardhatEthersSigner, amount: bigint | number): Promise<void> {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).withdraw(input.handles[0], input.inputProof)).wait();
}

async function advanceToClose(pool: VeilPoolV3): Promise<void> {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function reachFirstMatureRound(system: System, keeper: HardhatEthersSigner): Promise<void> {
  await advanceToClose(system.pool);
  await (await system.pool.connect(keeper).cancelInsufficientRound()).wait();
  await advanceToClose(system.pool);
}

async function snapshotWeight(
  system: System,
  signer: HardhatEthersSigner,
  roundId = 2n,
): Promise<bigint> {
  const handle = await system.pool.connect(signer).encryptedSnapshotWeightOf(roundId);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.pool.getAddress(), signer);
}

async function drawAndFinalize(
  system: System,
  keeper: HardhatEthersSigner,
  roundId: bigint,
  prizeIndex: number,
): Promise<string> {
  await (await system.pool.connect(keeper).blindDrawPrize(roundId, prizeIndex)).wait();
  const handle = await system.pool.getEncryptedPrizeWinner(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([handle]);
  const winner = proof.clearValues[Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues] as string;
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [winner]);
  await (
    await system.pool.connect(keeper).finalizePrizeWinner(roundId, prizeIndex, encoded, proof.decryptionProof)
  ).wait();
  return winner;
}

describe("UNVEIL V3 fairness invariants", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("gives equal mature cUSDC balances equal encrypted ticket power", async function () {
    const [, alice, bob, keeper] = await ethers.getSigners();
    const system = await deploySystem();
    await fundAndApprove(system, alice);
    await fundAndApprove(system, bob);
    await deposit(system, alice, 100);
    await deposit(system, bob, 100);

    await reachFirstMatureRound(system, keeper);
    await (await system.pool.connect(keeper).snapshotRound()).wait();

    expect(await snapshotWeight(system, alice)).to.equal(100n);
    expect(await snapshotWeight(system, bob)).to.equal(100n);
  });

  it("does not increase aggregate ticket power when 100 cUSDC is split across ten wallets", async function () {
    const accounts = await ethers.getSigners();
    const whale = accounts[1];
    const anchor = accounts[2];
    const keeper = accounts[3];
    const bots = accounts.slice(4, 14);
    expect(bots.length).to.equal(10);

    const single = await deploySystem();
    await fundAndApprove(single, whale);
    await fundAndApprove(single, anchor);
    await deposit(single, whale, 100);
    await deposit(single, anchor, 1);
    await reachFirstMatureRound(single, keeper);
    await (await single.pool.connect(keeper).snapshotRound()).wait();
    const singlePower = await snapshotWeight(single, whale);

    const split = await deploySystem();
    await fundAndApprove(split, anchor);
    await deposit(split, anchor, 1);
    for (const bot of bots) {
      await fundAndApprove(split, bot, 20n);
      await deposit(split, bot, 10);
    }
    await reachFirstMatureRound(split, keeper);
    await (await split.pool.connect(keeper).snapshotRound()).wait();

    let splitPower = 0n;
    for (const bot of bots) splitPower += await snapshotWeight(split, bot);

    expect(singlePower).to.equal(100n);
    expect(splitPower).to.equal(100n);
    expect(splitPower).to.equal(singlePower);
  });

  it("reduces future mature ticket power when principal is withdrawn before the draw closes", async function () {
    const [, alice, bob, keeper] = await ethers.getSigners();
    const system = await deploySystem();
    await fundAndApprove(system, alice);
    await fundAndApprove(system, bob);
    await deposit(system, alice, 100);
    await deposit(system, bob, 100);

    await advanceToClose(system.pool);
    await (await system.pool.connect(keeper).cancelInsufficientRound()).wait();
    await withdraw(system, alice, 60);
    await advanceToClose(system.pool);
    await (await system.pool.connect(keeper).snapshotRound()).wait();

    expect(await snapshotWeight(system, alice)).to.equal(40n);
    expect(await snapshotWeight(system, bob)).to.equal(100n);
  });

  it("cannot backfill a closed mature round with a post-close deposit", async function () {
    const [, alice, bob, keeper] = await ethers.getSigners();
    const system = await deploySystem();
    await fundAndApprove(system, alice, 2_000n);
    await fundAndApprove(system, bob);
    await deposit(system, alice, 100);
    await deposit(system, bob, 100);

    await advanceToClose(system.pool);
    await (await system.pool.connect(keeper).cancelInsufficientRound()).wait();
    await advanceToClose(system.pool);

    // Round 2 is already closed. This deposit must be sealed into later state only.
    await deposit(system, alice, 900);
    await (await system.pool.connect(keeper).snapshotRound()).wait();

    expect(await snapshotWeight(system, alice)).to.equal(100n);
    expect(await snapshotWeight(system, bob)).to.equal(100n);
  });

  it("never selects a zero-weight mature seat while another seat has positive ticket power", async function () {
    const [, zeroSaver, fundedSaver, keeper] = await ethers.getSigners();
    const system = await deploySystem();
    await fundAndApprove(system, zeroSaver);
    await fundAndApprove(system, fundedSaver);
    await deposit(system, zeroSaver, 0);
    await deposit(system, fundedSaver, 100);

    await reachFirstMatureRound(system, keeper);
    await (await system.pool.connect(keeper).snapshotRound()).wait();
    expect(await snapshotWeight(system, zeroSaver)).to.equal(0n);
    expect(await snapshotWeight(system, fundedSaver)).to.equal(100n);

    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex += 1) {
      const winner = await drawAndFinalize(system, keeper, 2n, prizeIndex);
      expect(winner.toLowerCase()).to.equal(fundedSaver.address.toLowerCase());
    }
  });

  it("cancels an all-zero mature round instead of fabricating a winner", async function () {
    const [, alice, bob, keeper] = await ethers.getSigners();
    const system = await deploySystem();
    await fundAndApprove(system, alice);
    await fundAndApprove(system, bob);
    await deposit(system, alice, 0);
    await deposit(system, bob, 0);

    await reachFirstMatureRound(system, keeper);
    await (await system.pool.connect(keeper).snapshotRound()).wait();

    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex += 1) {
      const winner = await drawAndFinalize(system, keeper, 2n, prizeIndex);
      expect(winner).to.equal(ethers.ZeroAddress);
    }

    expect(await system.pool.getDrawState(2)).to.equal(4n);
    expect(await system.pool.unsettledRoundCount()).to.equal(0n);
  });
});
