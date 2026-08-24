import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { HDNodeWallet } from "ethers";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV2,
  VeilStrategyManagerV2TestHarness,
  VeilWithdrawalBatcher,
} from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

let signers: Signers;

type System = {
  asset: MockUSDC;
  source: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV2;
  manager: VeilStrategyManagerV2TestHarness;
};

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;

type TestSigner = HardhatEthersSigner | HDNodeWallet;

async function decrypt64(contractAddress: string, handle: string, signer: TestSigner): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

async function encryptedInput(pool: VeilPoolV2, signer: TestSigner, amount: bigint | number) {
  return fhevm
    .createEncryptedInput(await pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
}

async function deploySystem(drawPeriod = DRAW_PERIOD): Promise<System> {
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
    await ethers.getContractFactory("VeilPoolV2")
  ).deploy(await source.getAddress(), drawPeriod)) as VeilPoolV2;
  const manager = (await (
    await ethers.getContractFactory("VeilStrategyManagerV2TestHarness")
  ).deploy(
    await pool.getAddress(),
    await source.getAddress(),
    await shares.getAddress(),
    await deposits.getAddress(),
    await withdrawals.getAddress(),
    await vault.getAddress(),
    2_000,
    0,
  )) as VeilStrategyManagerV2TestHarness;

  await (await pool.configureStrategyManager(await manager.getAddress())).wait();
  return { asset, source, vault, shares, deposits, withdrawals, pool, manager };
}

async function fundAndApprove(system: System, signer: TestSigner, amount = 10_000n) {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.source.getAddress(), amount)).wait();
  await (await system.source.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.source.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function deposit(system: System, signer: TestSigner, amount: bigint | number) {
  const input = await encryptedInput(system.pool, signer, amount);
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
}

async function withdraw(system: System, signer: TestSigner, amount: bigint | number): Promise<bigint> {
  const requestId = await system.manager.nextWithdrawalRequestId();
  const input = await encryptedInput(system.pool, signer, amount);
  await (await system.pool.connect(signer).withdraw(input.handles[0], input.inputProof)).wait();
  return requestId;
}

async function decryptPoolBalance(system: System, signer: TestSigner): Promise<bigint> {
  return decrypt64(await system.pool.getAddress(), await system.pool.connect(signer).encryptedBalanceOf(), signer);
}

async function decryptReserved(system: System, signer: TestSigner): Promise<bigint> {
  return decrypt64(
    await system.pool.getAddress(),
    await system.pool.connect(signer).encryptedReservedWithdrawalOf(),
    signer,
  );
}

async function exposeManager(system: System, signer: HardhatEthersSigner) {
  await (await system.manager.connect(signer).exposeAccountingForTest()).wait();
  const managerAddress = await system.manager.getAddress();
  return {
    liability: await decrypt64(managerAddress, await system.manager.lastPrincipalLiability(), signer),
    buffer: await decrypt64(managerAddress, await system.manager.lastBuffer(), signer),
    queued: await decrypt64(managerAddress, await system.manager.lastQueuedWithdrawalTotal(), signer),
  };
}

async function advanceToClose(pool: VeilPoolV2) {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function mineAt(timestamp: number) {
  const latest = await ethers.provider.getBlock("latest");
  if (!latest || timestamp < latest.timestamp) throw new Error("Timestamp must move forward");
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine", []);
}

async function publicCompletionProof(system: System, requestId: bigint) {
  await (await system.manager.exposeWithdrawalRequestForTest(requestId)).wait();
  const result = await fhevm.publicDecrypt([await system.manager.lastWithdrawalCompleted()]);
  return {
    completed: result.clearValues[Object.keys(result.clearValues)[0] as keyof typeof result.clearValues] as boolean,
    proof: result.decryptionProof,
  };
}

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

function deterministicWallets(count: number, startIndex = 100): HDNodeWallet[] {
  return Array.from({ length: count }, (_, index) =>
    HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, `m/44'/60'/0'/0/${startIndex + index}`).connect(ethers.provider),
  );
}

async function assertPrincipalInvariant(system: System, users: TestSigner[]) {
  const accounting = await exposeManager(system, signers.alice);
  let sumActive = 0n;
  let sumReserved = 0n;
  for (const user of users) {
    sumActive += await decryptPoolBalance(system, user);
    sumReserved += await decryptReserved(system, user);
  }
  expect(sumActive + sumReserved).to.equal(accounting.liability);
  expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);
}

async function classifyWithdrawal(system: System, requestId: bigint) {
  const completion = await publicCompletionProof(system, requestId);
  await (await system.manager.classifyWithdrawal(requestId, completion.completed, completion.proof)).wait();
  return completion.completed;
}

async function finalizeWithdrawal(system: System, requestId: bigint) {
  const completion = await publicCompletionProof(system, requestId);
  await (await system.manager.finalizeWithdrawal(requestId, true, completion.proof)).wait();
}

async function settleQueuedWithdrawal(
  system: System,
  requestId: bigint,
  afterStrategyResolution?: () => Promise<void>,
) {
  await (await system.manager.fundWithdrawalLiquidity()).wait();
  const batchId = await system.manager.lastManagerWithdrawalBatchId();
  await advanceBatchAge(system.withdrawals);
  await (await system.withdrawals.dispatchBatch()).wait();
  await proveWithdrawalBatch(system, batchId);
  await (await system.manager.resolveWithdrawalBatch(batchId)).wait();
  if (afterStrategyResolution) await afterStrategyResolution();
  await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
  await finalizeWithdrawal(system, requestId);
}

async function advanceBatchAge(batcher: VeilDepositBatcher | VeilWithdrawalBatcher) {
  const openedAt = Number(await batcher.currentBatchOpenedAt());
  const age = Number(await batcher.minimumBatchAge());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < openedAt + age) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [openedAt + age]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function proveDepositBatch(system: System) {
  const requestId = await system.deposits.unwrapRequestId(1);
  const amount = await system.source.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([amount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await system.deposits.dispatchBatchCallback(1, clearAmount, result.decryptionProof)).wait();
}

async function proveWithdrawalBatch(system: System, batchId = 1n) {
  const requestId = await system.withdrawals.unwrapRequestId(batchId);
  const amount = await system.shares.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([amount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await system.withdrawals.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

describe("VeilPoolV2", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { deployer: accounts[0], alice: accounts[1], bob: accounts[2], outsider: accounts[3] };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  async function freshSystem(drawPeriod = DRAW_PERIOD) {
    const system = await deploySystem(drawPeriod);
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await fundAndApprove(system, signers.outsider);
    return system;
  }

  it("requires one-time manager configuration before custody is available", async function () {
    const source = (await (
      await ethers.getContractFactory("MockUSDCConfidentialWrapper")
    ).deploy(
      (await (await ethers.getContractFactory("MockUSDC")).deploy()).getAddress(),
    )) as MockUSDCConfidentialWrapper;
    const pool = (await (
      await ethers.getContractFactory("VeilPoolV2")
    ).deploy(await source.getAddress(), DRAW_PERIOD)) as VeilPoolV2;
    const poolAddress = await pool.getAddress();
    await expect(pool.connect(signers.alice).configureStrategyManager(ethers.ZeroAddress)).to.be.revertedWith(
      "Not owner",
    );

    const mockFactory = await ethers.getContractFactory("MockVeilStrategyManagerConfig");
    const wrongPool = await mockFactory.deploy(signers.outsider.address, await source.getAddress());
    const wrongAsset = await mockFactory.deploy(poolAddress, signers.outsider.address);
    const valid = await mockFactory.deploy(poolAddress, await source.getAddress());

    await expect(pool.configureStrategyManager(ethers.ZeroAddress)).to.be.revertedWith("Invalid manager");
    await expect(pool.configureStrategyManager(await wrongPool.getAddress())).to.be.revertedWith(
      "Invalid manager pool",
    );
    await expect(pool.configureStrategyManager(await wrongAsset.getAddress())).to.be.revertedWith(
      "Invalid manager asset",
    );
    await expect(pool.connect(signers.outsider).configureStrategyManager(await valid.getAddress())).to.be.revertedWith(
      "Not owner",
    );
    await (await pool.configureStrategyManager(await valid.getAddress())).wait();
    expect(await pool.strategyManagerConfigured()).to.equal(true);
    await expect(pool.configureStrategyManager(await valid.getAddress())).to.be.revertedWith(
      "Manager already configured",
    );
  });

  it("rejects deposits before manager configuration", async function () {
    const asset = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
    const source = (await (
      await ethers.getContractFactory("MockUSDCConfidentialWrapper")
    ).deploy(await asset.getAddress())) as MockUSDCConfidentialWrapper;
    const pool = (await (
      await ethers.getContractFactory("VeilPoolV2")
    ).deploy(await source.getAddress(), DRAW_PERIOD)) as VeilPoolV2;
    await (await asset.mint(signers.alice.address, 10)).wait();
    await (await asset.connect(signers.alice).approve(await source.getAddress(), 10)).wait();
    await (await source.connect(signers.alice).wrap(signers.alice.address, 10)).wait();
    await (await source.connect(signers.alice).setOperator(await pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
    const input = await encryptedInput(pool, signers.alice, 1);
    await expect(pool.connect(signers.alice).deposit(input.handles[0], input.inputProof)).to.be.revertedWith(
      "Manager not configured",
    );
  });

  it("rejects withdrawals before manager configuration before any economic processing", async function () {
    const asset = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
    const source = (await (
      await ethers.getContractFactory("MockUSDCConfidentialWrapper")
    ).deploy(await asset.getAddress())) as MockUSDCConfidentialWrapper;
    const pool = (await (
      await ethers.getContractFactory("VeilPoolV2")
    ).deploy(await source.getAddress(), DRAW_PERIOD)) as VeilPoolV2;
    const input = await encryptedInput(pool, signers.alice, 1);
    await expect(pool.connect(signers.alice).withdraw(input.handles[0], input.inputProof)).to.be.revertedWith(
      "Manager not configured",
    );
  });

  it("rejects a zero draw period", async function () {
    const asset = (await (await ethers.getContractFactory("MockUSDC")).deploy()) as MockUSDC;
    const source = (await (
      await ethers.getContractFactory("MockUSDCConfidentialWrapper")
    ).deploy(await asset.getAddress())) as MockUSDCConfidentialWrapper;
    await expect(
      (await ethers.getContractFactory("VeilPoolV2")).deploy(await source.getAddress(), 0),
    ).to.be.revertedWith("Invalid draw period");
  });

  it("moves deposits directly into manager custody and records the same transfer", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);

    expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);
    expect(
      await decrypt64(
        await system.source.getAddress(),
        await system.source.confidentialBalanceOf(signers.alice.address),
        signers.alice,
      ),
    ).to.equal(9_900n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(100n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
    const aliceBalanceHandle = await system.pool.connect(signers.alice).encryptedBalanceOf();
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, await system.pool.getAddress(), signers.bob),
    ).to.be.rejected;
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, await system.pool.getAddress(), signers.outsider),
    ).to.be.rejected;

    const accounting = await exposeManager(system, signers.alice);
    expect(accounting.liability).to.equal(100n);
    expect(accounting.buffer).to.equal(100n);
    expect(await system.pool.withdrawalRequestAccount(1)).to.equal(ethers.ZeroAddress);
  });

  it("performs instant withdrawals without pool custody or double draw-weight reduction", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    const requestId = await withdraw(system, signers.alice, 10);

    expect(requestId).to.equal(1n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(90n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
    expect(
      await decrypt64(
        await system.source.getAddress(),
        await system.source.confidentialBalanceOf(signers.alice.address),
        signers.alice,
      ),
    ).to.equal(9_910n);
    expect((await exposeManager(system, signers.alice)).liability).to.equal(90n);
    expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);

    await withdraw(system, signers.alice, 1_000);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(90n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
  });

  it("keeps V2 financial events limited to nonfinancial identifiers", async function () {
    const system = await freshSystem();
    const depositInput = await encryptedInput(system.pool, signers.alice, 100);
    const depositReceipt = await (
      await system.pool.connect(signers.alice).deposit(depositInput.handles[0], depositInput.inputProof)
    ).wait();
    const depositEvent = depositReceipt?.logs
      .map((log) => {
        try {
          return system.pool.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "DepositRecorded");
    expect(depositEvent?.args.length).to.equal(1);
    expect(depositEvent?.fragment.inputs.map((input) => input.name)).to.deep.equal(["player"]);

    const withdrawalInput = await encryptedInput(system.pool, signers.alice, 10);
    const withdrawalReceipt = await (
      await system.pool.connect(signers.alice).withdraw(withdrawalInput.handles[0], withdrawalInput.inputProof)
    ).wait();
    const withdrawalEvent = withdrawalReceipt?.logs
      .map((log) => {
        try {
          return system.pool.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "WithdrawalRecorded");
    expect(withdrawalEvent?.args.length).to.equal(2);
    expect(withdrawalEvent?.fragment.inputs.map((input) => input.name)).to.deep.equal(["player", "requestId"]);
  });

  it("reserves queued principal and restores it only through an authenticated cancellation callback", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    await (await system.manager.investExcess()).wait();
    const requestId = await withdraw(system, signers.alice, 50);

    expect(await decryptPoolBalance(system, signers.alice)).to.equal(50n);
    expect(await decryptReserved(system, signers.alice)).to.equal(50n);
    const aliceReservedHandle = await system.pool.connect(signers.alice).encryptedReservedWithdrawalOf();
    expect(await decrypt64(await system.pool.getAddress(), aliceReservedHandle, signers.alice)).to.equal(50n);
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, aliceReservedHandle, await system.pool.getAddress(), signers.bob),
    ).to.be.rejected;
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, aliceReservedHandle, await system.pool.getAddress(), signers.outsider),
    ).to.be.rejected;
    expect((await exposeManager(system, signers.alice)).queued).to.equal(50n);
    expect((await exposeManager(system, signers.alice)).liability).to.equal(100n);

    await expect(system.pool.connect(signers.bob).cancelWithdrawal(requestId)).to.be.revertedWith("Not request owner");
    await (await system.pool.connect(signers.alice).cancelWithdrawal(requestId)).wait();
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(100n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
    expect((await exposeManager(system, signers.alice)).queued).to.equal(0n);
    expect((await exposeManager(system, signers.alice)).liability).to.equal(100n);
    expect(await system.pool.withdrawalRequestCanceled(requestId)).to.equal(true);
    await expect(system.pool.connect(signers.alice).cancelWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestClosed",
    );
  });

  it("preserves closed-round weight across post-close queued withdrawal and cancellation", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await (await system.manager.investExcess()).wait();
    await advanceToClose(system.pool);

    const requestId = await withdraw(system, signers.alice, 50);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    expect(
      await decrypt64(
        await system.pool.getAddress(),
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(1),
        signers.alice,
      ),
    ).to.equal(100n);
    await expect(system.pool.connect(signers.outsider).encryptedSnapshotWeightOf(1)).to.be.revertedWith("Not in round");

    await advanceToClose(system.pool);
    await (await system.pool.connect(signers.alice).cancelWithdrawal(requestId)).wait();
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    expect(
      await decrypt64(
        await system.pool.getAddress(),
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(2),
        signers.alice,
      ),
    ).to.equal(50n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(100n);
  });

  it("keeps the fixed schedule when finalization is delayed", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    const period = Number(await system.pool.drawPeriod());

    await mineAt(firstOpen + period);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    await (await system.pool.connect(signers.outsider).blindDraw(1)).wait();
    const winnerHandle = await system.pool.getEncryptedWinner(1);
    await expect(system.pool.connect(signers.alice).blindDraw(1)).to.be.revertedWith("Round not ready");
    await mineAt(firstOpen + period + 20 * 60);
    const expectedSecondOpen = BigInt(firstOpen + period);
    expect(await system.pool.nextDrawOpensAt()).to.equal(expectedSecondOpen);
    expect(await system.pool.nextDrawClosesAt()).to.equal(expectedSecondOpen + BigInt(period));

    const invalid = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers.outsider.address]);
    const proof = await fhevm.publicDecrypt([winnerHandle]);
    await expect(system.pool.finalizeWinner(1, invalid, proof.decryptionProof)).to.be.reverted;
    expect((await system.pool.getDrawInfo(1)).state).to.equal(2);
    await (await system.pool.finalizeWinner(1, proof.abiEncodedClearValues, proof.decryptionProof)).wait();
    expect((await system.pool.getDrawInfo(1)).state).to.equal(3);
  });

  it("allows overlapping unsettled V2 rounds and finalizes them independently", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    const period = Number(await system.pool.drawPeriod());

    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();
    await (await system.pool.blindDraw(1)).wait();
    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();
    await (await system.pool.blindDraw(2)).wait();

    expect(await system.pool.unsettledRoundCount()).to.equal(2n);
    expect(await system.pool.nextDrawOpensAt()).to.equal(BigInt(firstOpen + 2 * period));
    expect(await system.pool.nextDrawClosesAt()).to.equal(BigInt(firstOpen + 3 * period));

    const roundTwoProof = await fhevm.publicDecrypt([await system.pool.getEncryptedWinner(2)]);
    await (
      await system.pool.finalizeWinner(2, roundTwoProof.abiEncodedClearValues, roundTwoProof.decryptionProof)
    ).wait();
    expect((await system.pool.getDrawInfo(2)).state).to.equal(3);
    expect((await system.pool.getDrawInfo(1)).state).to.equal(2);
    expect(await system.pool.unsettledRoundCount()).to.equal(1n);

    const roundOneProof = await fhevm.publicDecrypt([await system.pool.getEncryptedWinner(1)]);
    await (
      await system.pool.finalizeWinner(1, roundOneProof.abiEncodedClearValues, roundOneProof.decryptionProof)
    ).wait();
    expect((await system.pool.getDrawInfo(1)).state).to.equal(3);
    expect(await system.pool.unsettledRoundCount()).to.equal(0n);
  });

  it("enforces close-time snapshot readiness, outsider advancement, and schedule getters", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);
    const close = Number(await system.pool.nextDrawClosesAt());
    await ethers.provider.send("evm_setNextBlockTimestamp", [close - 1]);
    await expect(system.pool.connect(signers.outsider).snapshotRound()).to.be.revertedWith("Draw still open");

    await ethers.provider.send("evm_setNextBlockTimestamp", [close]);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    const schedule = await system.pool.getDrawSchedule();
    expect(schedule.currentRoundId).to.equal(2n);
    expect(schedule.opensAt).to.equal((await system.pool.firstDrawOpensAt()) + BigInt(DRAW_PERIOD));
    expect(schedule.closesAt - schedule.opensAt).to.equal(BigInt(DRAW_PERIOD));
    expect(schedule.unsettledRounds).to.equal(1n);
    expect(schedule.overdue).to.equal(false);
    await expect(system.pool.connect(signers.outsider).snapshotRound()).to.be.revertedWith("Draw still open");
  });

  it("marks insufficient participation as SKIPPED and zero-weight draws as CANCELLED", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 1);
    await advanceToClose(system.pool);
    await (await system.pool.connect(signers.outsider).cancelInsufficientRound()).wait();
    expect((await system.pool.getDrawInfo(1)).state).to.equal(5);
    expect((await system.pool.getDrawInfo(1)).participantCount).to.equal(1);
    await expect(system.pool.getEncryptedWinner(1)).to.be.revertedWith("Winner unavailable");

    const zeroSystem = await freshSystem();
    await deposit(zeroSystem, signers.alice, 0);
    await deposit(zeroSystem, signers.bob, 0);
    await advanceToClose(zeroSystem.pool);
    await (await zeroSystem.pool.snapshotRound()).wait();
    await (await zeroSystem.pool.blindDraw(1)).wait();
    const winner = await zeroSystem.pool.getEncryptedWinner(1);
    const result = await fhevm.publicDecrypt([winner]);
    await (await zeroSystem.pool.finalizeWinner(1, result.abiEncodedClearValues, result.decryptionProof)).wait();
    expect((await zeroSystem.pool.getDrawInfo(1)).state).to.equal(4);
    expect(await zeroSystem.pool.getEncryptedWinner(1)).to.equal(winner);
  });

  it("uses the skipped round close, not the next round close, for historical participation", async function () {
    const dailyPeriod = 24 * 60 * 60;
    const system = await freshSystem(dailyPeriod);
    await deposit(system, signers.alice, 10);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    await mineAt(firstOpen + 30 * dailyPeriod + 10);
    await withdraw(system, signers.alice, 1);
    expect(await system.pool.stateEpochCount()).to.equal(1n);
    expect(await system.pool.lastSealedRoundId()).to.equal(30n);

    for (let roundId = 1; roundId <= 30; roundId++) {
      await (await system.pool.connect(signers.outsider).cancelInsufficientRound()).wait();
    }
    const skipped = await system.pool.getDrawInfo(30);
    expect(skipped.state).to.equal(5);
    expect(skipped.participantCount).to.equal(1);
  });

  it("enforces the V2 MAX_PLAYERS boundary and preserves slot-reuse snapshots", async function () {
    const system = await freshSystem();
    const wallets = deterministicWallets(33);
    for (const wallet of wallets) {
      await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
      await fundAndApprove(system, wallet, 1n);
    }

    await deposit(system, wallets[0], 1);
    await deposit(system, wallets[1], 1);
    await advanceToClose(system.pool);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    expect(await system.pool.getSnapshotPlayer(1, 0)).to.equal(wallets[0].address);
    expect(await system.pool.getSnapshotPlayer(1, 1)).to.equal(wallets[1].address);

    for (const wallet of wallets.slice(2, 32)) await deposit(system, wallet, 1);
    expect(await system.pool.playerCount()).to.equal(32);
    for (const wallet of wallets.slice(0, 32)) expect(await decryptPoolBalance(system, wallet)).to.equal(1n);

    await expect(deposit(system, wallets[32], 1)).to.be.revertedWith("Draw roster full");

    await (await system.pool.connect(wallets[0]).leaveDrawSeat()).wait();
    expect(await system.pool.playerCount()).to.equal(31);
    await deposit(system, wallets[32], 1);
    expect(await system.pool.playerCount()).to.equal(32);
    expect(await decryptPoolBalance(system, wallets[32])).to.equal(1n);

    expect(await system.pool.getSnapshotPlayer(1, 0)).to.equal(wallets[0].address);
    expect(
      await decrypt64(
        await system.pool.getAddress(),
        await system.pool.connect(wallets[0]).encryptedSnapshotWeightOf(1),
        wallets[0],
      ),
    ).to.equal(1n);
    await expect(system.pool.connect(wallets[32]).encryptedSnapshotWeightOf(1)).to.be.revertedWith("Not in round");
  });

  it("compresses idle closes and preserves first, middle, latest, and current epoch snapshots", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 30);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    const period = Number(await system.pool.drawPeriod());

    await mineAt(firstOpen + period + 10);
    await deposit(system, signers.alice, 5);
    await mineAt(firstOpen + 2 * period + 10);
    await withdraw(system, signers.bob, 10);
    await mineAt(firstOpen + 3 * period + 10);
    await deposit(system, signers.alice, 5);
    expect(await system.pool.stateEpochCount()).to.equal(3n);

    await mineAt(firstOpen + 4 * period + 10);
    for (let roundId = 1; roundId <= 4; roundId++) {
      await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    }

    const poolAddress = await system.pool.getAddress();
    expect(
      await decrypt64(
        poolAddress,
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(1),
        signers.alice,
      ),
    ).to.equal(10n);
    expect(
      await decrypt64(
        poolAddress,
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(2),
        signers.alice,
      ),
    ).to.equal(15n);
    expect(
      await decrypt64(
        poolAddress,
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(3),
        signers.alice,
      ),
    ).to.equal(15n);
    expect(
      await decrypt64(
        poolAddress,
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(4),
        signers.alice,
      ),
    ).to.equal(20n);
    expect(await system.pool.stateEpochCount()).to.equal(3n);
  });

  it("compresses 100 idle V2 closes into one epoch before the first later mutation", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    const period = Number(await system.pool.drawPeriod());

    await mineAt(firstOpen + 100 * period + 10);
    expect(await system.pool.stateEpochCount()).to.equal(0n);
    await deposit(system, signers.alice, 5);
    expect(await system.pool.stateEpochCount()).to.equal(1n);
    expect(await system.pool.lastSealedRoundId()).to.equal(100n);

    for (let roundId = 1; roundId <= 100; roundId++) {
      await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    }
    const poolAddress = await system.pool.getAddress();
    for (const roundId of [1, 50, 100]) {
      expect(
        await decrypt64(
          poolAddress,
          await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(roundId),
          signers.alice,
        ),
      ).to.equal(10n);
      expect(
        await decrypt64(
          poolAddress,
          await system.pool.connect(signers.bob).encryptedSnapshotWeightOf(roundId),
          signers.bob,
        ),
      ).to.equal(20n);
    }

    await mineAt(firstOpen + 101 * period);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    expect(
      await decrypt64(
        poolAddress,
        await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(101),
        signers.alice,
      ),
    ).to.equal(15n);
    expect(await system.pool.stateEpochCount()).to.equal(1n);
  });

  it("settles queued principal through the manager callback without changing active draw weight", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.deposits);
    await (await system.deposits.dispatchBatch()).wait();
    await proveDepositBatch(system);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const requestId = await withdraw(system, signers.alice, 50);
    const completion = await publicCompletionProof(system, requestId);
    expect(completion.completed).to.equal(false);
    await (await system.manager.classifyWithdrawal(requestId, false, completion.proof)).wait();
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    await advanceBatchAge(system.withdrawals);
    await (await system.withdrawals.dispatchBatch()).wait();
    await proveWithdrawalBatch(system);
    await (await system.manager.resolveWithdrawalBatch(1)).wait();

    await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(50n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
    expect((await exposeManager(system, signers.alice)).liability).to.equal(50n);
    expect(
      await decrypt64(
        await system.source.getAddress(),
        await system.source.confidentialBalanceOf(signers.alice.address),
        signers.alice,
      ),
    ).to.equal(9_950n);

    const finalProof = await publicCompletionProof(system, requestId);
    await (await system.manager.connect(signers.outsider).finalizeWithdrawal(requestId, true, finalProof.proof)).wait();
    expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);
  });

  it("maintains multi-user active plus reserved principal equal to manager liability", async function () {
    const system = await freshSystem();
    const users = [signers.alice, signers.bob, signers.outsider];
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 80);
    await deposit(system, signers.outsider, 60);
    await assertPrincipalInvariant(system, users);

    await withdraw(system, signers.alice, 10);
    await assertPrincipalInvariant(system, users);

    await (await system.manager.investExcess()).wait();
    const firstBobRequest = await withdraw(system, signers.bob, 50);
    const firstCarolRequest = await withdraw(system, signers.outsider, 50);
    await assertPrincipalInvariant(system, users);
    expect((await exposeManager(system, signers.alice)).queued).to.equal(100n);

    await (await system.pool.connect(signers.bob).cancelWithdrawal(firstBobRequest)).wait();
    await assertPrincipalInvariant(system, users);

    await advanceBatchAge(system.deposits);
    await (await system.deposits.dispatchBatch()).wait();
    await proveDepositBatch(system);
    await (await system.manager.resolveDepositBatch(1)).wait();
    expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);

    expect(await classifyWithdrawal(system, firstCarolRequest)).to.equal(false);
    await settleQueuedWithdrawal(system, firstCarolRequest, async () => {
      await assertPrincipalInvariant(system, users);
    });
    await assertPrincipalInvariant(system, users);
    expect(await decryptReserved(system, signers.outsider)).to.equal(0n);

    const secondBobRequest = await withdraw(system, signers.bob, 50);
    await assertPrincipalInvariant(system, users);
    expect(await classifyWithdrawal(system, secondBobRequest)).to.equal(false);
    await settleQueuedWithdrawal(system, secondBobRequest);
    await assertPrincipalInvariant(system, users);
    expect(await decryptPoolBalance(system, signers.bob)).to.equal(30n);
  });

  it("authenticates manager callbacks and leaves accounting unchanged on outsider calls", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    await (await system.manager.investExcess()).wait();
    const requestId = await withdraw(system, signers.alice, 50);
    await assertPrincipalInvariant(system, [signers.alice]);
    const unknownRequestId = requestId + 1n;

    await expect(
      system.pool.connect(signers.outsider).onManagerWithdrawalPaid(requestId, ethers.ZeroHash),
    ).to.be.revertedWith("Only manager");
    await expect(
      system.pool.connect(signers.outsider).onManagerWithdrawalPaid(unknownRequestId, ethers.ZeroHash),
    ).to.be.revertedWith("Only manager");
    await expect(
      system.pool.connect(signers.outsider).onManagerWithdrawalCanceled(requestId, ethers.ZeroHash),
    ).to.be.revertedWith("Only manager");
    await expect(
      system.pool.connect(signers.outsider).onManagerWithdrawalCanceled(unknownRequestId, ethers.ZeroHash),
    ).to.be.revertedWith("Only manager");

    await assertPrincipalInvariant(system, [signers.alice]);
    expect((await exposeManager(system, signers.alice)).queued).to.equal(50n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(50n);
    expect(await decryptReserved(system, signers.alice)).to.equal(50n);
  });

  it("keeps payout replay economically zero and prevents canceled-request restoration replay", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 100);
    await (await system.manager.investExcess()).wait();
    const requestId = await withdraw(system, signers.alice, 50);
    await advanceBatchAge(system.deposits);
    await (await system.deposits.dispatchBatch()).wait();
    await proveDepositBatch(system);
    await (await system.manager.resolveDepositBatch(1)).wait();
    await classifyWithdrawal(system, requestId);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    const batchId = await system.manager.lastManagerWithdrawalBatchId();
    await advanceBatchAge(system.withdrawals);
    await (await system.withdrawals.dispatchBatch()).wait();
    await proveWithdrawalBatch(system, batchId);
    await (await system.manager.resolveWithdrawalBatch(batchId)).wait();
    await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();

    const afterPayout = await exposeManager(system, signers.alice);
    expect(afterPayout.liability).to.equal(50n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(50n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);
    await (await system.manager.connect(signers.bob).settleWithdrawal(requestId)).wait();
    const afterReplay = await exposeManager(system, signers.alice);
    expect(afterReplay.liability).to.equal(50n);
    expect(afterReplay.queued).to.equal(0n);
    expect(await decryptReserved(system, signers.alice)).to.equal(0n);

    await finalizeWithdrawal(system, requestId);
    await expect(system.manager.settleWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestClosed",
    );

    const cancelSystem = await freshSystem();
    await deposit(cancelSystem, signers.alice, 100);
    await deposit(cancelSystem, signers.bob, 100);
    await (await cancelSystem.manager.investExcess()).wait();
    const canceledRequest = await withdraw(cancelSystem, signers.alice, 50);
    const unrelatedRequest = await withdraw(cancelSystem, signers.bob, 50);
    await (await cancelSystem.pool.connect(signers.alice).cancelWithdrawal(canceledRequest)).wait();
    expect(await decryptReserved(cancelSystem, signers.bob)).to.equal(50n);
    await expect(
      cancelSystem.pool.connect(signers.alice).cancelWithdrawal(canceledRequest),
    ).to.be.revertedWithCustomError(cancelSystem.manager, "WithdrawalRequestClosed");
    expect(await cancelSystem.pool.withdrawalRequestCanceled(unrelatedRequest)).to.equal(false);
    expect(await decryptReserved(cancelSystem, signers.bob)).to.equal(50n);
  });

  it("covers first, middle, penultimate, latest, and current-unsealed epoch lookups", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    const period = Number(await system.pool.drawPeriod());

    await mineAt(firstOpen + period + 10);
    await deposit(system, signers.alice, 5);
    await mineAt(firstOpen + 2 * period + 10);
    await withdraw(system, signers.bob, 5);
    await mineAt(firstOpen + 3 * period + 10);
    await deposit(system, signers.alice, 7);
    await mineAt(firstOpen + 4 * period + 10);
    await withdraw(system, signers.alice, 2);
    await mineAt(firstOpen + 5 * period + 10);
    await deposit(system, signers.bob, 3);
    expect(await system.pool.stateEpochCount()).to.equal(5n);

    await mineAt(firstOpen + 6 * period);
    for (let roundId = 1; roundId <= 6; roundId++) {
      await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    }

    const expected = new Map<number, [bigint, bigint]>([
      [1, [10n, 20n]],
      [2, [15n, 20n]],
      [3, [15n, 15n]],
      [4, [22n, 15n]],
      [5, [20n, 15n]],
      [6, [20n, 18n]],
    ]);
    const poolAddress = await system.pool.getAddress();
    for (const [roundId, [aliceExpected, bobExpected]] of expected) {
      expect(
        await decrypt64(
          poolAddress,
          await system.pool.connect(signers.alice).encryptedSnapshotWeightOf(roundId),
          signers.alice,
        ),
      ).to.equal(aliceExpected);
      expect(
        await decrypt64(
          poolAddress,
          await system.pool.connect(signers.bob).encryptedSnapshotWeightOf(roundId),
          signers.bob,
        ),
      ).to.equal(bobExpected);
    }
  });

  it("keeps post-close deposits and reused seats out of the closed snapshot", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    await advanceToClose(system.pool);
    await deposit(system, signers.outsider, 50);
    await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
    expect((await system.pool.getDrawInfo(1)).participantCount).to.equal(2);
    expect(await system.pool.getSnapshotPlayer(1, 0)).to.equal(signers.alice.address);
    expect(await system.pool.getSnapshotPlayer(1, 1)).to.equal(signers.bob.address);

    const nextSystem = await freshSystem();
    await deposit(nextSystem, signers.alice, 10);
    await deposit(nextSystem, signers.bob, 20);
    await advanceToClose(nextSystem.pool);
    await (await nextSystem.pool.connect(signers.alice).leaveDrawSeat()).wait();
    await deposit(nextSystem, signers.outsider, 50);
    await (await nextSystem.pool.connect(signers.outsider).snapshotRound()).wait();
    expect(await nextSystem.pool.getSnapshotPlayer(1, 0)).to.equal(signers.alice.address);
    await expect(nextSystem.pool.connect(signers.outsider).encryptedSnapshotWeightOf(1)).to.be.revertedWith(
      "Not in round",
    );
  });

  it("keeps expired draw seats separate from withdrawable encrypted principal", async function () {
    const system = await freshSystem();
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 20);
    await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await (await system.pool.pruneExpiredSeats()).wait();

    expect(await system.pool.playerCount()).to.equal(0);
    expect(await system.pool.joined(signers.alice.address)).to.equal(true);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(10n);
    const requestId = await withdraw(system, signers.alice, 4);
    expect(requestId).to.equal(1n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(6n);
    await (await system.pool.connect(signers.alice).renewDrawSeat()).wait();
    expect(await system.pool.playerCount()).to.equal(1);
  });
});
