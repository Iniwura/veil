import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV2,
  VeilPrizeVaultV2,
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
  pool: VeilPoolV2;
  manager: VeilStrategyManagerV2TestHarness;
  prizeVault: VeilPrizeVaultV2;
};

const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;

let signers: Signers;

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

async function encryptedInput(pool: VeilPoolV2, signer: HardhatEthersSigner, amount: bigint | number) {
  return fhevm
    .createEncryptedInput(await pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
}

async function deploySystem(drawPeriod = DRAW_PERIOD, valuationHaircutBps = 0): Promise<System> {
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
  const prizeVault = (await (
    await ethers.getContractFactory("VeilPrizeVaultV2")
  ).deploy(await pool.getAddress(), await shares.getAddress())) as VeilPrizeVaultV2;
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
    valuationHaircutBps,
  )) as VeilStrategyManagerV2TestHarness;

  await (await pool.configureStrategyManager(await manager.getAddress())).wait();
  return { asset, source, vault, shares, deposits, withdrawals, pool, manager, prizeVault };
}

async function fundAndApprove(system: System, signer: HardhatEthersSigner, amount: bigint | number = 10_000n) {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.source.getAddress(), amount)).wait();
  await (await system.source.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.source.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number) {
  const input = await encryptedInput(system.pool, signer, amount);
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
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

async function advanceBatchAge(batcher: VeilDepositBatcher | VeilWithdrawalBatcher) {
  const openedAt = Number(await batcher.currentBatchOpenedAt());
  const minimumAge = Number(await batcher.minimumBatchAge());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  const delta = openedAt + minimumAge - latest.timestamp;
  if (delta > 0) await ethers.provider.send("evm_increaseTime", [delta]);
  await ethers.provider.send("evm_mine", []);
}

async function resolveDepositBatch(system: System, batchId = 1n) {
  await advanceBatchAge(system.deposits);
  await (await system.deposits.dispatchBatch()).wait();
  const unwrapRequestId = await system.deposits.unwrapRequestId(batchId);
  const encryptedAmount = await system.source.unwrapAmount(unwrapRequestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await system.deposits.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
  await (await system.manager.resolveDepositBatch(batchId)).wait();
}

async function investAndResolve(system: System) {
  await (await system.manager.investExcess()).wait();
  await resolveDepositBatch(system);
}

async function classifyWithdrawal(system: System, requestId: bigint) {
  await (await system.manager.exposeWithdrawalRequestForTest(requestId)).wait();
  const result = await fhevm.publicDecrypt([await system.manager.lastWithdrawalCompleted()]);
  const completed = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as boolean;
  await (await system.manager.classifyWithdrawal(requestId, completed, result.decryptionProof)).wait();
  return completed;
}

async function proveWithdrawalBatch(system: System, batchId: bigint) {
  const requestId = await system.withdrawals.unwrapRequestId(batchId);
  const encryptedAmount = await system.shares.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await system.withdrawals.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function settleQueuedWithdrawal(system: System, requestId: bigint) {
  await (await system.manager.fundWithdrawalLiquidity()).wait();
  const batchId = await system.manager.lastManagerWithdrawalBatchId();
  await advanceBatchAge(system.withdrawals);
  await (await system.withdrawals.dispatchBatch()).wait();
  await proveWithdrawalBatch(system, batchId);
  await (await system.manager.resolveWithdrawalBatch(batchId)).wait();
  await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
  await (await system.manager.exposeWithdrawalRequestForTest(requestId)).wait();
  const result = await fhevm.publicDecrypt([await system.manager.lastWithdrawalCompleted()]);
  const completed = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as boolean;
  await (await system.manager.finalizeWithdrawal(requestId, completed, result.decryptionProof)).wait();
}

async function finalizeDraw(system: System, roundId: bigint | number): Promise<HardhatEthersSigner> {
  const id = BigInt(roundId);
  const encryptedWinner = await system.pool.getEncryptedWinner(id);
  const result = await fhevm.publicDecrypt([encryptedWinner]);
  await (await system.pool.finalizeWinner(id, result.abiEncodedClearValues, result.decryptionProof)).wait();
  const winner = await system.pool.getWinner(id);
  const winnerSigner = [signers.alice, signers.bob].find(
    (candidate) => candidate.address.toLowerCase() === winner.toLowerCase(),
  );
  if (!winnerSigner) throw new Error("Winner is not a test signer");
  return winnerSigner;
}

async function createDraw(system: System, roundId: bigint | number) {
  const id = BigInt(roundId);
  await advanceToClose(system.pool);
  await (await system.pool.connect(signers.outsider).snapshotRound()).wait();
  await (await system.pool.connect(signers.outsider).blindDraw(id)).wait();
}

async function exposeManager(system: System, signer: HardhatEthersSigner) {
  await (await system.manager.connect(signer).exposeAccountingForTest()).wait();
  const managerAddress = await system.manager.getAddress();
  return {
    liability: await decrypt64(managerAddress, await system.manager.lastPrincipalLiability(), signer),
    queued: await decrypt64(managerAddress, await system.manager.lastQueuedWithdrawalTotal(), signer),
    buffer: await decrypt64(managerAddress, await system.manager.lastBuffer(), signer),
    shareBalance: await decrypt64(managerAddress, await system.manager.lastShareBalance(), signer),
    safeSurplus: await decrypt64(managerAddress, await system.manager.lastSafeSurplusShares(), signer),
  };
}

async function decryptPoolBalance(system: System, signer: HardhatEthersSigner) {
  return decrypt64(await system.pool.getAddress(), await system.pool.connect(signer).encryptedBalanceOf(), signer);
}

async function decryptPoolReserved(system: System, signer: HardhatEthersSigner) {
  return decrypt64(
    await system.pool.getAddress(),
    await system.pool.connect(signer).encryptedReservedWithdrawalOf(),
    signer,
  );
}

async function decryptShareBalance(system: System, account: HardhatEthersSigner) {
  const handle = await system.shares.confidentialBalanceOf(account.address);
  if (handle === ethers.ZeroHash) return 0n;
  return decrypt64(await system.shares.getAddress(), handle, account);
}

async function assertPrincipalInvariant(system: System, users: HardhatEthersSigner[]) {
  const accounting = await exposeManager(system, signers.alice);
  let sum = 0n;
  for (const user of users) sum += (await decryptPoolBalance(system, user)) + (await decryptPoolReserved(system, user));
  expect(sum).to.equal(accounting.liability);
  expect(await system.source.confidentialBalanceOf(await system.pool.getAddress())).to.equal(ethers.ZeroHash);
}

describe("VeilPrizeVaultV2", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { deployer: accounts[0], alice: accounts[1], bob: accounts[2], outsider: accounts[3] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This prize suite requires the local FHEVM mock");
      this.skip();
    }
  });

  it("validates nonzero pool and prize asset constructor wiring", async function () {
    const system = await deploySystem();
    const factory = await ethers.getContractFactory("VeilPrizeVaultV2");
    await expect(factory.deploy(ethers.ZeroAddress, await system.shares.getAddress())).to.be.revertedWithCustomError(
      system.prizeVault,
      "InvalidAddress",
    );
    await expect(factory.deploy(await system.pool.getAddress(), ethers.ZeroAddress)).to.be.revertedWithCustomError(
      system.prizeVault,
      "InvalidAddress",
    );
    expect(await system.prizeVault.pool()).to.equal(await system.pool.getAddress());
    expect(await system.prizeVault.asset()).to.equal(await system.shares.getAddress());
  });

  it("rejects outsider funding and has no manager authority before pool configuration", async function () {
    const system = await deploySystem();
    const input = await fhevm
      .createEncryptedInput(await system.prizeVault.getAddress(), signers.outsider.address)
      .add64(1)
      .encrypt();
    await expect(
      system.prizeVault.connect(signers.outsider).recordAndDeliverPrize(1, input.handles[0]),
    ).to.be.revertedWithCustomError(system.prizeVault, "OnlyStrategyManager");

    const unconfiguredPool = (await (
      await ethers.getContractFactory("VeilPoolV2")
    ).deploy(await system.source.getAddress(), DRAW_PERIOD)) as VeilPoolV2;
    const unconfiguredVault = (await (
      await ethers.getContractFactory("VeilPrizeVaultV2")
    ).deploy(await unconfiguredPool.getAddress(), await system.shares.getAddress())) as VeilPrizeVaultV2;
    await expect(
      unconfiguredVault.connect(signers.outsider).recordAndDeliverPrize(1, input.handles[0]),
    ).to.be.revertedWithCustomError(unconfiguredVault, "OnlyStrategyManager");
  });

  it("rejects NONE, SNAPSHOTTED, and DRAWN rounds until a winner is finalized", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 10);
    await fundAndApprove(system, signers.bob, 10);
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);

    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "PrizeRoundNotReady",
    );
    await advanceToClose(system.pool);
    await (await system.pool.snapshotRound()).wait();
    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "PrizeRoundNotReady",
    );
    await (await system.pool.blindDraw(1)).wait();
    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "PrizeRoundNotReady",
    );
  });

  it("processes only the earliest finalized round and blocks behind a later finalized round", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 10);
    await fundAndApprove(system, signers.bob, 10);
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);
    await createDraw(system, 1);
    await createDraw(system, 2);
    await finalizeDraw(system, 2);

    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "PrizeRoundNotReady",
    );
    await finalizeDraw(system, 1);
    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(3n);
  });

  it("advances SKIPPED rounds without moving strategy shares", async function () {
    const system = await deploySystem();
    await advanceToClose(system.pool);
    await (await system.pool.cancelInsufficientRound()).wait();
    expect((await system.pool.getDrawInfo(1)).state).to.equal(5);
    const before = await exposeManager(system, signers.alice);
    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
    const after = await exposeManager(system, signers.alice);
    expect(after.shareBalance).to.equal(before.shareBalance);
    expect(after.liability).to.equal(before.liability);
  });

  it("advances KMS-proven zero-weight CANCELLED rounds without moving strategy shares", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 0);
    await fundAndApprove(system, signers.bob, 0);
    await deposit(system, signers.alice, 0);
    await deposit(system, signers.bob, 0);
    await createDraw(system, 1);
    const encryptedWinner = await system.pool.getEncryptedWinner(1);
    const result = await fhevm.publicDecrypt([encryptedWinner]);
    await (await system.pool.finalizeWinner(1, result.abiEncodedClearValues, result.decryptionProof)).wait();
    expect((await system.pool.getDrawInfo(1)).state).to.equal(4);
    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
    await expect(system.prizeVault.encryptedPrizeOf(1)).to.be.revertedWithCustomError(
      system.prizeVault,
      "PrizeNotProcessed",
    );
  });

  it("processes a finalized zero-surplus round and stores a winner-readable zero prize", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 10);
    await fundAndApprove(system, signers.bob, 10);
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    const loser = winner.address === signers.alice.address ? signers.bob : signers.alice;

    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
    const prize = await system.prizeVault.connect(winner).encryptedPrizeOf(1);
    expect(await decrypt64(await system.prizeVault.getAddress(), prize, winner)).to.equal(0n);
    await expect(system.prizeVault.connect(loser).encryptedPrizeOf(1)).to.be.revertedWithCustomError(
      system.prizeVault,
      "NotWinner",
    );
    await expect(system.prizeVault.connect(signers.outsider).encryptedPrizeOf(1)).to.be.revertedWithCustomError(
      system.prizeVault,
      "NotWinner",
    );
  });

  it("delivers only the live safe surplus as confidential strategy shares without a winner claim", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);

    await (await system.asset.mint(signers.deployer.address, 50n)).wait();
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 50n)).wait();
    await (await system.vault.connect(signers.deployer).donate(50n)).wait();

    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    const loser = winner.address === signers.alice.address ? signers.bob : signers.alice;
    const before = await exposeManager(system, signers.alice);
    const winnerBefore = await decryptShareBalance(system, winner);
    const loserBefore = await decryptShareBalance(system, loser);

    await (await system.manager.connect(signers.outsider).processNextPrizeRound()).wait();

    const after = await exposeManager(system, signers.alice);
    const delivered = await decrypt64(
      await system.prizeVault.getAddress(),
      await system.prizeVault.connect(winner).encryptedPrizeOf(1),
      winner,
    );
    expect(delivered).to.equal(before.safeSurplus);
    expect(after.shareBalance).to.equal(before.shareBalance - delivered);
    expect(after.liability).to.equal(before.liability);
    expect(await decryptShareBalance(system, winner)).to.equal(winnerBefore + delivered);
    expect(await decryptShareBalance(system, loser)).to.equal(loserBefore);
    expect(await system.prizeVault.prizeStatus(1)).to.deep.equal([true, winner.address]);
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
  });

  it("binds the delivered prize to the finalized pool winner and exposes no amount publicly", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    await (await system.asset.mint(signers.deployer.address, 20n)).wait();
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 20n)).wait();
    await (await system.vault.connect(signers.deployer).donate(20n)).wait();
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);

    expect(system.manager.interface.getFunction("processNextPrizeRound")?.inputs.length).to.equal(0);
    expect(
      system.prizeVault.interface.getFunction("recordAndDeliverPrize")?.inputs.map((input) => input.name),
    ).to.deep.equal(["roundId", "amount"]);
    await (await system.manager.processNextPrizeRound()).wait();
    expect((await system.prizeVault.prizeStatus(1)).winner).to.equal(winner.address);
  });

  it("keeps principal, active positions, reserved positions, and pool custody unchanged after prize processing", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 80);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 80);
    await investAndResolve(system);
    const input = await encryptedInput(system.pool, signers.alice, 50);
    await (await system.pool.connect(signers.alice).withdraw(input.handles[0], input.inputProof)).wait();
    const before = await exposeManager(system, signers.alice);
    const aliceBefore = [
      await decryptPoolBalance(system, signers.alice),
      await decryptPoolReserved(system, signers.alice),
    ];
    const bobBefore = [await decryptPoolBalance(system, signers.bob), await decryptPoolReserved(system, signers.bob)];
    await createDraw(system, 1);
    await finalizeDraw(system, 1);
    await (await system.manager.processNextPrizeRound()).wait();
    const after = await exposeManager(system, signers.alice);
    expect(after.liability).to.equal(before.liability);
    expect(after.queued).to.equal(before.queued);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(aliceBefore[0]);
    expect(await decryptPoolReserved(system, signers.alice)).to.equal(aliceBefore[1]);
    expect(await decryptPoolBalance(system, signers.bob)).to.equal(bobBefore[0]);
    expect(await decryptPoolReserved(system, signers.bob)).to.equal(bobBefore[1]);
    await assertPrincipalInvariant(system, [signers.alice, signers.bob]);
  });

  it("preserves queued-withdrawal solvency after extracting only safe surplus", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    await (await system.asset.mint(signers.deployer.address, 50n)).wait();
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 50n)).wait();
    await (await system.vault.connect(signers.deployer).donate(50n)).wait();
    const requestId = await system.manager.nextWithdrawalRequestId();
    const input = await encryptedInput(system.pool, signers.alice, 50);
    await (await system.pool.connect(signers.alice).withdraw(input.handles[0], input.inputProof)).wait();
    const before = await exposeManager(system, signers.alice);
    await createDraw(system, 1);
    await finalizeDraw(system, 1);
    await (await system.manager.processNextPrizeRound()).wait();
    const afterPrize = await exposeManager(system, signers.alice);
    expect(afterPrize.liability).to.equal(before.liability);
    expect(afterPrize.queued).to.equal(before.queued);
    await assertPrincipalInvariant(system, [signers.alice, signers.bob]);
    expect(await classifyWithdrawal(system, requestId)).to.equal(false);
    await settleQueuedWithdrawal(system, requestId);
    expect(await decryptPoolReserved(system, signers.alice)).to.equal(0n);
    expect(await decryptPoolBalance(system, signers.alice)).to.equal(50n);
  });

  it("turns strategy loss into a valid zero prize without spending principal", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    const before = await exposeManager(system, signers.alice);
    await (await system.vault.connect(signers.deployer).simulateLoss(20n)).wait();
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    await (await system.manager.processNextPrizeRound()).wait();
    const after = await exposeManager(system, signers.alice);
    expect(after.liability).to.equal(before.liability);
    expect(after.shareBalance).to.equal(before.shareBalance);
    expect(
      await decrypt64(
        await system.prizeVault.getAddress(),
        await system.prizeVault.connect(winner).encryptedPrizeOf(1),
        winner,
      ),
    ).to.equal(0n);
  });

  it("reverts invalid valuation without advancing the prize pointer or moving shares", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    await createDraw(system, 1);
    await finalizeDraw(system, 1);
    const before = await exposeManager(system, signers.alice);
    await (await system.vault.setPreviewRedeemFailure(true)).wait();
    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "InvalidValuation",
    );
    expect(await system.manager.nextPrizeRoundId()).to.equal(1n);
    const after = await exposeManager(system, signers.alice);
    expect(after.shareBalance).to.equal(before.shareBalance);
  });

  it("does not prize strategy shares while a deposit batch is finalized but unclaimed", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.deposits);
    await (await system.deposits.dispatchBatch()).wait();
    const requestId = await system.deposits.unwrapRequestId(1);
    const encryptedAmount = await system.source.unwrapAmount(requestId);
    const result = await fhevm.publicDecrypt([encryptedAmount]);
    const clearAmount = result.clearValues[
      Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
    ] as bigint;
    await (await system.deposits.dispatchBatchCallback(1, clearAmount, result.decryptionProof)).wait();
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    await (await system.manager.processNextPrizeRound()).wait();
    expect(
      await decrypt64(
        await system.prizeVault.getAddress(),
        await system.prizeVault.connect(winner).encryptedPrizeOf(1),
        winner,
      ),
    ).to.equal(0n);
  });

  it("prevents duplicate processing and direct prize-vault delivery", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 10);
    await fundAndApprove(system, signers.bob, 10);
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    await (await system.manager.processNextPrizeRound()).wait();
    await expect(system.manager.processNextPrizeRound()).to.be.revertedWithCustomError(
      system.manager,
      "PrizeRoundNotReady",
    );
    const input = await fhevm
      .createEncryptedInput(await system.prizeVault.getAddress(), signers.outsider.address)
      .add64(0)
      .encrypt();
    await expect(
      system.prizeVault.connect(signers.outsider).recordAndDeliverPrize(1, input.handles[0]),
    ).to.be.revertedWithCustomError(system.prizeVault, "OnlyStrategyManager");
    expect((await system.prizeVault.prizeStatus(1)).winner).to.equal(winner.address);
  });

  it("emits prize lifecycle identifiers without encrypted amount fields", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 10);
    await fundAndApprove(system, signers.bob, 10);
    await deposit(system, signers.alice, 10);
    await deposit(system, signers.bob, 10);
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    const receipt = await (await system.manager.processNextPrizeRound()).wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return system.prizeVault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "PrizeDelivered");
    expect(event?.args.length).to.equal(2);
    expect(event?.fragment.inputs.map((input) => input.name)).to.deep.equal(["roundId", "winner"]);
    expect(event?.args.winner).to.equal(winner.address);
  });

  it("uses the configured valuation haircut conservatively for a positive prize", async function () {
    const system = await deploySystem(DRAW_PERIOD, 5_000);
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    await (await system.asset.mint(signers.deployer.address, 200n)).wait();
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 200n)).wait();
    await (await system.vault.connect(signers.deployer).donate(200n)).wait();
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    const before = await exposeManager(system, signers.alice);
    await (await system.manager.processNextPrizeRound()).wait();
    const prize = await decrypt64(
      await system.prizeVault.getAddress(),
      await system.prizeVault.connect(winner).encryptedPrizeOf(1),
      winner,
    );
    expect(prize).to.equal(before.safeSurplus);
    expect(prize).to.be.greaterThan(0n);
  });

  it("keeps confidential strategy-share balances winner-only while token ACL remains normal", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice, 100);
    await fundAndApprove(system, signers.bob, 100);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await investAndResolve(system);
    await (await system.asset.mint(signers.deployer.address, 50n)).wait();
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 50n)).wait();
    await (await system.vault.connect(signers.deployer).donate(50n)).wait();
    await createDraw(system, 1);
    const winner = await finalizeDraw(system, 1);
    const loser = winner.address === signers.alice.address ? signers.bob : signers.alice;
    await (await system.manager.processNextPrizeRound()).wait();
    const handle = await system.prizeVault.connect(winner).encryptedPrizeOf(1);
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.prizeVault.getAddress(), loser)).to.be
      .rejected;
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.prizeVault.getAddress(), signers.outsider),
    ).to.be.rejected;
    await expect(
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        await system.shares.confidentialBalanceOf(winner.address),
        await system.shares.getAddress(),
        loser,
      ),
    ).to.be.rejected;
  });
});
