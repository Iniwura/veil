import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";

import {
  MockLowPrecisionConfidentialWrapper,
  MockLowPrecisionConfidentialWrapper__factory,
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockUSDCConfidentialWrapper__factory,
  MockUSDC__factory,
  MockYieldVault4626,
  MockYieldVault4626__factory,
  MockYieldVaultShareConfidentialWrapper,
  MockYieldVaultShareConfidentialWrapper__factory,
  MockZeroRateConfidentialWrapper__factory,
  VeilDepositBatcher,
  VeilDepositBatcher__factory,
  VeilStrategyManagerV2,
  VeilStrategyManagerV2__factory,
  VeilStrategyManagerV2TestHarness,
  VeilStrategyManagerV2TestHarness__factory,
  VeilStrategyPoolHarness,
  VeilStrategyPoolHarness__factory,
  VeilWithdrawalBatcher,
  VeilWithdrawalBatcher__factory,
} from "../types";

type Wrapper =
  | MockUSDCConfidentialWrapper
  | MockYieldVaultShareConfidentialWrapper
  | MockLowPrecisionConfidentialWrapper;

type Signers = {
  deployer: HardhatEthersSigner;
  manager: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  thirdParty: HardhatEthersSigner;
};

type ManagerSystem = {
  asset: MockUSDC;
  vault: MockYieldVault4626;
  fromWrapper: Wrapper;
  shareWrapper: Wrapper;
  depositBatcher: VeilDepositBatcher;
  withdrawalBatcher: VeilWithdrawalBatcher;
  pool: VeilStrategyPoolHarness;
  manager: VeilStrategyManagerV2TestHarness;
};

const MINIMUM_BATCH_AGE = 60 * 60;
const BPS = 10_000n;
const STANDARD_RESERVE_BPS = 2_000;
const MAX_UINT48 = 2n ** 48n - 1n;
const MAX_UINT64 = 2n ** 64n - 1n;

async function deployManagerSystem(
  options: {
    lowSource?: boolean;
    lowShare?: boolean;
    bufferReserveBps?: number;
    valuationHaircutBps?: number;
  } = {},
): Promise<ManagerSystem> {
  const assetFactory = (await ethers.getContractFactory("MockUSDC")) as MockUSDC__factory;
  const asset = await assetFactory.deploy();
  const vaultFactory = (await ethers.getContractFactory("MockYieldVault4626")) as MockYieldVault4626__factory;
  const vault = await vaultFactory.deploy(await asset.getAddress());

  const standardSourceFactory = (await ethers.getContractFactory(
    "MockUSDCConfidentialWrapper",
  )) as MockUSDCConfidentialWrapper__factory;
  const lowPrecisionFactory = (await ethers.getContractFactory(
    "MockLowPrecisionConfidentialWrapper",
  )) as MockLowPrecisionConfidentialWrapper__factory;
  const fromWrapper = (
    options.lowSource
      ? await lowPrecisionFactory.deploy(await asset.getAddress())
      : await standardSourceFactory.deploy(await asset.getAddress())
  ) as Wrapper;

  const standardShareFactory = (await ethers.getContractFactory(
    "MockYieldVaultShareConfidentialWrapper",
  )) as MockYieldVaultShareConfidentialWrapper__factory;
  const shareWrapper = (
    options.lowShare
      ? await lowPrecisionFactory.deploy(await vault.getAddress())
      : await standardShareFactory.deploy(await vault.getAddress())
  ) as Wrapper;

  const depositFactory = (await ethers.getContractFactory("VeilDepositBatcher")) as VeilDepositBatcher__factory;
  const depositBatcher = await depositFactory.deploy(
    await fromWrapper.getAddress(),
    await shareWrapper.getAddress(),
    await vault.getAddress(),
    MINIMUM_BATCH_AGE,
  );
  const withdrawalFactory = (await ethers.getContractFactory(
    "VeilWithdrawalBatcher",
  )) as VeilWithdrawalBatcher__factory;
  const withdrawalBatcher = await withdrawalFactory.deploy(
    await shareWrapper.getAddress(),
    await fromWrapper.getAddress(),
    await vault.getAddress(),
    MINIMUM_BATCH_AGE,
  );

  const poolFactory = (await ethers.getContractFactory("VeilStrategyPoolHarness")) as VeilStrategyPoolHarness__factory;
  const pool = await poolFactory.deploy(await fromWrapper.getAddress());
  const managerFactory = (await ethers.getContractFactory(
    "VeilStrategyManagerV2TestHarness",
  )) as VeilStrategyManagerV2TestHarness__factory;
  const manager = await managerFactory.deploy(
    await pool.getAddress(),
    await fromWrapper.getAddress(),
    await shareWrapper.getAddress(),
    await depositBatcher.getAddress(),
    await withdrawalBatcher.getAddress(),
    await vault.getAddress(),
    options.bufferReserveBps ?? STANDARD_RESERVE_BPS,
    options.valuationHaircutBps ?? 0,
  );
  await (await pool.configureManager(await manager.getAddress())).wait();

  return { asset, vault, fromWrapper, shareWrapper, depositBatcher, withdrawalBatcher, pool, manager };
}

async function mintAsset(system: ManagerSystem, signer: HardhatEthersSigner, amount: bigint) {
  await (await system.asset.mint(signer.address, amount)).wait();
}

async function wrap(
  underlying: MockUSDC | MockYieldVault4626,
  wrapper: Wrapper,
  signer: HardhatEthersSigner,
  amount: bigint,
) {
  await (await underlying.connect(signer).approve(await wrapper.getAddress(), amount)).wait();
  await (await wrapper.connect(signer).wrap(signer.address, amount)).wait();
}

async function join(
  wrapper: Wrapper,
  batcher: VeilDepositBatcher | VeilWithdrawalBatcher,
  signer: HardhatEthersSigner,
  amount: bigint,
) {
  const encrypted = await fhevm
    .createEncryptedInput(await wrapper.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  const transferAndCall = wrapper
    .connect(signer)
    .getFunction("confidentialTransferAndCall(address,bytes32,bytes,bytes)");
  await (await transferAndCall(await batcher.getAddress(), encrypted.handles[0], encrypted.inputProof, "0x")).wait();
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

async function dispatchAndProve(
  batcher: VeilDepositBatcher,
  fromWrapper: Wrapper,
  relayer: HardhatEthersSigner,
  batchId = 1n,
) {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await fromWrapper.unwrapAmount(requestId);
  const publicResult = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = publicResult.clearValues[
    Object.keys(publicResult.clearValues)[0] as keyof typeof publicResult.clearValues
  ] as bigint;
  await (
    await batcher.connect(relayer).dispatchBatchCallback(batchId, clearAmount, publicResult.decryptionProof)
  ).wait();
}

async function dispatchAndProveWithdrawal(
  batcher: VeilWithdrawalBatcher,
  shareWrapper: Wrapper,
  relayer: HardhatEthersSigner,
  batchId = 1n,
) {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await shareWrapper.unwrapAmount(requestId);
  const publicResult = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = publicResult.clearValues[
    Object.keys(publicResult.clearValues)[0] as keyof typeof publicResult.clearValues
  ] as bigint;
  await (
    await batcher.connect(relayer).dispatchBatchCallback(batchId, clearAmount, publicResult.decryptionProof)
  ).wait();
}

async function depositThroughPool(system: ManagerSystem, signer: HardhatEthersSigner, amount: bigint) {
  await (await system.fromWrapper.connect(signer).setOperator(await system.pool.getAddress(), MAX_UINT48)).wait();
  const encrypted = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (
    await system.pool.connect(signer).depositFor(signer.address, encrypted.handles[0], encrypted.inputProof)
  ).wait();
}

async function requestWithdrawalThroughPool(
  system: ManagerSystem,
  signer: HardhatEthersSigner,
  amount: bigint,
): Promise<bigint> {
  await (await system.fromWrapper.connect(signer).setOperator(await system.pool.getAddress(), MAX_UINT48)).wait();
  const encrypted = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  const nextId = await system.manager.nextWithdrawalRequestId();
  await (await system.pool.connect(signer).requestWithdrawal(encrypted.handles[0], encrypted.inputProof)).wait();
  return nextId;
}

async function requestWithdrawalBypassThroughPool(
  system: ManagerSystem,
  account: string,
  amount: bigint,
): Promise<{ requestId: bigint; accepted: bigint }> {
  const encrypted = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signers.deployer.address)
    .add64(amount)
    .encrypt();
  const nextId = await system.manager.nextWithdrawalRequestId();
  await (
    await system.pool
      .connect(signers.deployer)
      .requestWithdrawalBypassForTest(account, encrypted.handles[0], encrypted.inputProof)
  ).wait();
  return {
    requestId: nextId,
    accepted: await decrypt64(await system.pool.getAddress(), await system.pool.lastBypassAccepted(), signers.deployer),
  };
}

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

let signers: Signers;

async function expose(system: ManagerSystem, signer: HardhatEthersSigner = signers.manager) {
  await (await system.manager.connect(signer).exposeAccountingForTest()).wait();
  const managerAddress = await system.manager.getAddress();
  return {
    principalLiability: await decrypt64(managerAddress, await system.manager.lastPrincipalLiability(), signer),
    buffer: await decrypt64(managerAddress, await system.manager.lastBuffer(), signer),
    targetBuffer: await decrypt64(managerAddress, await system.manager.lastTargetBuffer(), signer),
    investable: await decrypt64(managerAddress, await system.manager.lastInvestable(), signer),
    uncoveredPrincipal: await decrypt64(managerAddress, await system.manager.lastUncoveredPrincipal(), signer),
    requiredShares: await fhevm.userDecryptEuint(
      FhevmType.euint128,
      await system.manager.lastRequiredShares(),
      managerAddress,
      signer,
    ),
    shareBalance: await decrypt64(managerAddress, await system.manager.lastShareBalance(), signer),
    safeSurplusShares: await decrypt64(managerAddress, await system.manager.lastSafeSurplusShares(), signer),
    queuedWithdrawalTotal: await decrypt64(managerAddress, await system.manager.lastQueuedWithdrawalTotal(), signer),
    conservativeValue: await system.manager.lastConservativeValue(),
    shareScale: await system.manager.lastShareScale(),
  };
}

async function exposePositions(system: ManagerSystem, account: HardhatEthersSigner) {
  await (await system.pool.connect(account).exposePositionsForTest(account.address)).wait();
  const poolAddress = await system.pool.getAddress();
  return {
    active: await decrypt64(poolAddress, await system.pool.activePosition(account.address), account),
    reserved: await decrypt64(poolAddress, await system.pool.reservedWithdrawal(account.address), account),
  };
}

async function assertPrincipalAccounting(system: ManagerSystem, accounts: HardhatEthersSigner[]) {
  const accounting = await expose(system);
  expect(accounting.queuedWithdrawalTotal).to.be.lessThanOrEqual(accounting.principalLiability);
  let positionTotal = 0n;
  for (const account of accounts) {
    const position = await exposePositions(system, account);
    positionTotal += position.active + position.reserved;
  }
  expect(positionTotal).to.equal(accounting.principalLiability);
}

async function exposeWithdrawalRequest(
  system: ManagerSystem,
  requestId: bigint,
  signer: HardhatEthersSigner = signers.manager,
) {
  await (await system.manager.connect(signer).exposeWithdrawalRequestForTest(requestId)).wait();
  const managerAddress = await system.manager.getAddress();
  const completion = await fhevm.publicDecrypt([await system.manager.lastWithdrawalCompleted()]);
  const clearCompleted = completion.clearValues[
    Object.keys(completion.clearValues)[0] as keyof typeof completion.clearValues
  ] as boolean;
  return {
    remaining: await decrypt64(managerAddress, await system.manager.lastWithdrawalRemaining(), signer),
    paid: await decrypt64(managerAddress, await system.manager.lastWithdrawalPaid(), signer),
    completed: clearCompleted,
  };
}

async function finalizeWithdrawalRequest(
  system: ManagerSystem,
  requestId: bigint,
  signer: HardhatEthersSigner = signers.outsider,
) {
  await (await system.manager.connect(signers.manager).exposeWithdrawalRequestForTest(requestId)).wait();
  const completion = await fhevm.publicDecrypt([await system.manager.lastWithdrawalCompleted()]);
  const clearCompleted = completion.clearValues[
    Object.keys(completion.clearValues)[0] as keyof typeof completion.clearValues
  ] as boolean;
  await (
    await system.manager.connect(signer).finalizeWithdrawal(requestId, clearCompleted, completion.decryptionProof)
  ).wait();
}

async function decryptManagerBatchDeposit(
  system: ManagerSystem,
  batchId: bigint,
  signer: HardhatEthersSigner = signers.manager,
) {
  await (await system.manager.connect(signer).exposeManagerBatchDepositForTest(batchId)).wait();
  return decrypt64(await system.manager.getAddress(), await system.manager.lastManagerBatchDeposit(), signer);
}

async function decryptManagerWithdrawalBatchDeposit(
  system: ManagerSystem,
  batchId: bigint,
  signer: HardhatEthersSigner = signers.manager,
) {
  await (await system.manager.connect(signer).exposeManagerWithdrawalBatchDepositForTest(batchId)).wait();
  return decrypt64(await system.manager.getAddress(), await system.manager.lastManagerBatchDeposit(), signer);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

describe("UNVEIL Slice 2A confidential strategy manager", function () {
  before(async function () {
    const [deployer, manager, outsider, thirdParty] = await ethers.getSigners();
    signers = { deployer, manager, outsider, thirdParty };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This strategy manager suite requires the local FHEVM mock");
      this.skip();
    }
  });

  it("validates the immutable route graph and rejects unsafe configuration", async function () {
    const system = await deployManagerSystem();
    expect(await system.manager.pool()).to.equal(await system.pool.getAddress());
    expect(await system.manager.principalAsset()).to.equal(await system.fromWrapper.getAddress());
    expect(await system.manager.strategyShareAsset()).to.equal(await system.shareWrapper.getAddress());
    expect(await system.manager.depositBatcher()).to.equal(await system.depositBatcher.getAddress());
    expect(await system.manager.withdrawalBatcher()).to.equal(await system.withdrawalBatcher.getAddress());
    expect(await system.manager.vault()).to.equal(await system.vault.getAddress());
    expect(await system.manager.bufferReserveBps()).to.equal(STANDARD_RESERVE_BPS);
    expect(await system.manager.valuationHaircutBps()).to.equal(0);

    const managerFactory = (await ethers.getContractFactory(
      "VeilStrategyManagerV2TestHarness",
    )) as VeilStrategyManagerV2TestHarness__factory;
    await expect(
      managerFactory.deploy(
        ethers.ZeroAddress,
        await system.fromWrapper.getAddress(),
        await system.shareWrapper.getAddress(),
        await system.depositBatcher.getAddress(),
        await system.withdrawalBatcher.getAddress(),
        await system.vault.getAddress(),
        STANDARD_RESERVE_BPS,
        0,
      ),
    ).to.be.revertedWithCustomError(system.manager, "InvalidAddress");
    await expect(
      managerFactory.deploy(
        await system.pool.getAddress(),
        await system.fromWrapper.getAddress(),
        await system.shareWrapper.getAddress(),
        await system.depositBatcher.getAddress(),
        await system.withdrawalBatcher.getAddress(),
        await system.vault.getAddress(),
        10_001,
        0,
      ),
    ).to.be.revertedWithCustomError(system.manager, "InvalidBps");
    await expect(
      managerFactory.deploy(
        await system.pool.getAddress(),
        await system.fromWrapper.getAddress(),
        await system.shareWrapper.getAddress(),
        await system.depositBatcher.getAddress(),
        await system.withdrawalBatcher.getAddress(),
        await system.vault.getAddress(),
        STANDARD_RESERVE_BPS,
        10_000,
      ),
    ).to.be.revertedWithCustomError(system.manager, "InvalidHaircut");
    expect(
      system.manager.interface.fragments.some(
        (fragment) => fragment.type === "function" && "name" in fragment && fragment.name === "increasePrincipal",
      ),
    ).to.equal(false);

    const productionFactory = (await ethers.getContractFactory(
      "VeilStrategyManagerV2",
    )) as VeilStrategyManagerV2__factory;
    const productionManager = (await productionFactory.deploy(
      await system.pool.getAddress(),
      await system.fromWrapper.getAddress(),
      await system.shareWrapper.getAddress(),
      await system.depositBatcher.getAddress(),
      await system.withdrawalBatcher.getAddress(),
      await system.vault.getAddress(),
      STANDARD_RESERVE_BPS,
      0,
    )) as VeilStrategyManagerV2;
    expect(await productionManager.pool()).to.equal(await system.pool.getAddress());
    expect(
      productionManager.interface.fragments.some(
        (fragment) => fragment.type === "function" && "name" in fragment && fragment.name === "exposeAccountingForTest",
      ),
    ).to.equal(false);
  });

  it("records only the actual confidential pool transfer and keeps liability private", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.buffer).to.equal(100n);

    await expect(
      system.manager
        .connect(signers.outsider)
        .recordPrincipalDeposit(signers.outsider.address, await system.manager.principalLiability()),
    ).to.be.revertedWithCustomError(system.manager, "OnlyPool");
    await expect(
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        await system.manager.lastPrincipalLiability(),
        await system.manager.getAddress(),
        signers.outsider,
      ),
    ).to.be.rejected;

    const emptySystem = await deployManagerSystem();
    await mintAsset(emptySystem, signers.manager, 1n);
    await wrap(emptySystem.asset, emptySystem.fromWrapper, signers.manager, 1n);
    await depositThroughPool(emptySystem, signers.manager, 2n);
    expect((await expose(emptySystem)).principalLiability).to.equal(0n);
  });

  it("does not treat direct third-party batch participation as principal accounting", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.outsider, 50n);
    await wrap(system.asset, system.fromWrapper, signers.outsider, 50n);
    await join(system.fromWrapper, system.depositBatcher, signers.outsider, 50n);
    expect((await expose(system)).principalLiability).to.equal(0n);
    expect(await system.manager.managerDepositBatch(1)).to.equal(false);
  });

  it("computes the encrypted reserve target and invests caller-independent excess", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    let accounting = await expose(system);
    expect(accounting.targetBuffer).to.equal(20n);
    expect(accounting.investable).to.equal(80n);
    expect(accounting.uncoveredPrincipal).to.equal(0n);

    await (await system.manager.connect(signers.outsider).investExcess()).wait();
    accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.buffer).to.equal(20n);
    expect(accounting.investable).to.equal(0n);
    expect(await system.manager.managerDepositBatch(1)).to.equal(true);
    expect(await system.depositBatcher.currentBatchId()).to.equal(1);
    expect(await decryptManagerBatchDeposit(system, 1n)).to.equal(80n);
    await (await system.manager.connect(signers.manager).investExcess()).wait();
    expect(await decryptManagerBatchDeposit(system, 1n)).to.equal(80n);
    expect((await expose(system)).buffer).to.equal(20n);
  });

  it("handles zero and full-reserve BPS policies without moving principal unexpectedly", async function () {
    const zeroReserve = await deployManagerSystem({ bufferReserveBps: 0 });
    await mintAsset(zeroReserve, signers.manager, 100n);
    await wrap(zeroReserve.asset, zeroReserve.fromWrapper, signers.manager, 100n);
    await depositThroughPool(zeroReserve, signers.manager, 100n);
    expect((await expose(zeroReserve)).targetBuffer).to.equal(0n);
    await (await zeroReserve.manager.investExcess()).wait();
    expect((await expose(zeroReserve)).buffer).to.equal(0n);

    const fullReserve = await deployManagerSystem({ bufferReserveBps: 10_000 });
    await mintAsset(fullReserve, signers.manager, 100n);
    await wrap(fullReserve.asset, fullReserve.fromWrapper, signers.manager, 100n);
    await depositThroughPool(fullReserve, signers.manager, 100n);
    let accounting = await expose(fullReserve);
    expect(accounting.targetBuffer).to.equal(100n);
    expect(accounting.investable).to.equal(0n);
    await (await fullReserve.manager.investExcess()).wait();
    accounting = await expose(fullReserve);
    expect(accounting.buffer).to.equal(100n);
    expect(await fullReserve.manager.managerDepositBatch(1)).to.equal(true);
    await advanceBatchAge(fullReserve.depositBatcher);
    await (await fullReserve.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(fullReserve.depositBatcher, fullReserve.fromWrapper, signers.outsider);
    await (await fullReserve.manager.resolveDepositBatch(1)).wait();
    expect(await fullReserve.manager.managerDepositBatchResolved(1)).to.equal(true);
    expect((await expose(fullReserve)).buffer).to.equal(100n);
  });

  it("resolves a real finalized manager batch permissionlessly and never changes liability", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await expect(system.manager.resolveDepositBatch(1)).to.be.revertedWithCustomError(
      system.manager,
      "BatchNotResolvable",
    );
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await expect(system.manager.resolveDepositBatch(1)).to.be.revertedWithCustomError(
      system.manager,
      "BatchNotResolvable",
    );
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(2);
    await (await system.manager.connect(signers.thirdParty).resolveDepositBatch(1)).wait();

    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.buffer).to.equal(20n);
    expect(accounting.shareBalance).to.equal(80n);
    expect(await system.manager.managerDepositBatchResolved(1)).to.equal(true);
    await expect(system.manager.resolveDepositBatch(1)).to.be.revertedWithCustomError(
      system.manager,
      "ManagerBatchAlreadyResolved",
    );
  });

  it("resolves a canceled manager batch by manager quit and restores liquid custody", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await (await system.vault.setDepositFailure(true)).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(3);
    await (await system.manager.connect(signers.outsider).resolveDepositBatch(1)).wait();
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.buffer).to.equal(100n);
    expect(accounting.shareBalance).to.equal(0n);
  });

  it("excludes all pending, dispatched, and finalized-unclaimed assets from surplus", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    expect((await expose(system)).safeSurplusShares).to.equal(0n);
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    expect((await expose(system)).safeSurplusShares).to.equal(0n);
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(2);
    expect((await expose(system)).safeSurplusShares).to.equal(0n);
    await (await system.manager.resolveDepositBatch(1)).wait();
    expect((await expose(system)).safeSurplusShares).to.equal(0n);
  });

  it("matches the conservative reference model across appreciation, loss, and haircut", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const shareScale = 1_000_000n;
    const liability = 100n;
    const buffer = 20n;
    const shareBalance = 80n;
    let accounting = await expose(system);
    expect(accounting.conservativeValue).to.equal(1_000_000n);
    expect(accounting.requiredShares).to.equal(
      ceilDiv((liability - buffer) * shareScale, accounting.conservativeValue),
    );
    expect(accounting.safeSurplusShares).to.equal(shareBalance - accounting.requiredShares);

    await mintAsset(system, signers.deployer, 40n);
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 40n)).wait();
    await (await system.vault.connect(signers.deployer).donate(40n)).wait();
    accounting = await expose(system);
    const appreciatedValue = await system.vault.previewRedeem(1_000_000n);
    expect(accounting.conservativeValue).to.equal(appreciatedValue);
    const appreciatedRequired = ceilDiv((liability - buffer) * shareScale, appreciatedValue);
    expect(accounting.requiredShares).to.equal(appreciatedRequired);
    expect(accounting.safeSurplusShares).to.equal(shareBalance - appreciatedRequired);
    const positiveSurplus = accounting.safeSurplusShares;

    await (await system.vault.connect(signers.deployer).simulateLoss(60n)).wait();
    accounting = await expose(system);
    expect(accounting.safeSurplusShares).to.equal(0n);

    const haircutSystem = await deployManagerSystem({ valuationHaircutBps: 2_000 });
    await mintAsset(haircutSystem, signers.manager, 100n);
    await wrap(haircutSystem.asset, haircutSystem.fromWrapper, signers.manager, 100n);
    await depositThroughPool(haircutSystem, signers.manager, 100n);
    await (await haircutSystem.manager.investExcess()).wait();
    await advanceBatchAge(haircutSystem.depositBatcher);
    await (await haircutSystem.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(haircutSystem.depositBatcher, haircutSystem.fromWrapper, signers.outsider);
    await (await haircutSystem.manager.resolveDepositBatch(1)).wait();
    const haircutAccounting = await expose(haircutSystem);
    expect(haircutAccounting.safeSurplusShares).to.be.lessThanOrEqual(positiveSurplus);
  });

  it("uses the one-whole-share public probe and wrapper rate conversion", async function () {
    const system = await deployManagerSystem({ lowSource: true, lowShare: true });
    const principalRate = await system.fromWrapper.rate();
    const shareRate = await system.shareWrapper.rate();
    const shareScale = 10n ** BigInt(await system.shareWrapper.decimals());
    expect(principalRate).to.equal(1_000);
    expect(shareRate).to.equal(1_000);
    expect(shareScale).to.equal(1_000n);

    await mintAsset(system, signers.manager, 1_000_000n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 1_000_000n);
    await depositThroughPool(system, signers.manager, 1_000n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const accounting = await expose(system);
    const rawProbe = shareScale * shareRate;
    const rawAssets = await system.vault.previewRedeem(rawProbe);
    const expectedValue = ((rawAssets / principalRate) * 10_000n) / BPS;
    expect(accounting.shareScale).to.equal(shareScale);
    expect(accounting.conservativeValue).to.equal(expectedValue);
    expect(accounting.safeSurplusShares).to.equal(800n - ceilDiv(800n * shareScale, expectedValue));
  });

  it("keeps every manager-held share surplus when the liquid buffer covers all liability", async function () {
    const system = await deployManagerSystem({ bufferReserveBps: 10_000 });
    await mintAsset(system, signers.deployer, 100n);
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 100n)).wait();
    await (await system.vault.connect(signers.deployer).deposit(100n, signers.deployer.address)).wait();
    await (await system.vault.connect(signers.deployer).approve(await system.shareWrapper.getAddress(), 100n)).wait();
    await (await system.shareWrapper.connect(signers.deployer).wrap(await system.manager.getAddress(), 100n)).wait();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    const accounting = await expose(system);
    expect(accounting.uncoveredPrincipal).to.equal(0n);
    expect(accounting.requiredShares).to.equal(0n);
    expect(accounting.shareBalance).to.equal(100n);
    expect(accounting.safeSurplusShares).to.equal(100n);
  });

  it("rounds required shares up at the one-unit boundary", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    await mintAsset(system, signers.deployer, 1n);
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), 1n)).wait();
    await (await system.vault.connect(signers.deployer).donate(1n)).wait();
    const accounting = await expose(system);
    const expected = ceilDiv(80n * 1_000_000n, await system.vault.previewRedeem(1_000_000n));
    expect(accounting.requiredShares).to.equal(expected);
    expect(accounting.safeSurplusShares).to.equal(80n - expected);
  });

  it("fails closed for preview failure, zero rate, and excessive public valuation", async function () {
    const previewFailure = await deployManagerSystem();
    await mintAsset(previewFailure, signers.manager, 100n);
    await wrap(previewFailure.asset, previewFailure.fromWrapper, signers.manager, 100n);
    await depositThroughPool(previewFailure, signers.manager, 100n);
    await (await previewFailure.manager.investExcess()).wait();
    await advanceBatchAge(previewFailure.depositBatcher);
    await (await previewFailure.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(previewFailure.depositBatcher, previewFailure.fromWrapper, signers.outsider);
    await (await previewFailure.manager.resolveDepositBatch(1)).wait();
    await (await previewFailure.vault.setPreviewRedeemFailure(true)).wait();
    let accounting = await expose(previewFailure);
    expect(accounting.conservativeValue).to.equal(0n);
    expect(accounting.safeSurplusShares).to.equal(0n);

    const zeroRateSystem = await deployManagerSystem();
    const zeroFactory = (await ethers.getContractFactory(
      "MockZeroRateConfidentialWrapper",
    )) as MockZeroRateConfidentialWrapper__factory;
    const zeroWrapper = await zeroFactory.deploy(await zeroRateSystem.vault.getAddress());
    const depositFactory = (await ethers.getContractFactory("VeilDepositBatcher")) as VeilDepositBatcher__factory;
    const zeroDeposit = await depositFactory.deploy(
      await zeroRateSystem.fromWrapper.getAddress(),
      await zeroWrapper.getAddress(),
      await zeroRateSystem.vault.getAddress(),
      MINIMUM_BATCH_AGE,
    );
    const withdrawalFactory = (await ethers.getContractFactory(
      "VeilWithdrawalBatcher",
    )) as VeilWithdrawalBatcher__factory;
    const zeroWithdrawal = await withdrawalFactory.deploy(
      await zeroWrapper.getAddress(),
      await zeroRateSystem.fromWrapper.getAddress(),
      await zeroRateSystem.vault.getAddress(),
      MINIMUM_BATCH_AGE,
    );
    const zeroPoolFactory = (await ethers.getContractFactory(
      "VeilStrategyPoolHarness",
    )) as VeilStrategyPoolHarness__factory;
    const zeroPool = await zeroPoolFactory.deploy(await zeroRateSystem.fromWrapper.getAddress());
    const zeroManager = await (
      (await ethers.getContractFactory("VeilStrategyManagerV2TestHarness")) as VeilStrategyManagerV2TestHarness__factory
    ).deploy(
      await zeroPool.getAddress(),
      await zeroRateSystem.fromWrapper.getAddress(),
      await zeroWrapper.getAddress(),
      await zeroDeposit.getAddress(),
      await zeroWithdrawal.getAddress(),
      await zeroRateSystem.vault.getAddress(),
      STANDARD_RESERVE_BPS,
      0,
    );
    await (await zeroPool.configureManager(await zeroManager.getAddress())).wait();
    await (await zeroManager.exposeAccountingForTest()).wait();
    expect(await zeroManager.lastConservativeValue()).to.equal(0);
    expect(
      await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await zeroManager.lastSafeSurplusShares(),
        await zeroManager.getAddress(),
        signers.manager,
      ),
    ).to.equal(0n);

    const highValue = await deployManagerSystem();
    await mintAsset(highValue, signers.manager, 100n);
    await wrap(highValue.asset, highValue.fromWrapper, signers.manager, 100n);
    await depositThroughPool(highValue, signers.manager, 100n);
    await (await highValue.manager.investExcess()).wait();
    await advanceBatchAge(highValue.depositBatcher);
    await (await highValue.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(highValue.depositBatcher, highValue.fromWrapper, signers.outsider);
    await (await highValue.manager.resolveDepositBatch(1)).wait();
    const huge = 2n ** 200n;
    await mintAsset(highValue, signers.deployer, huge);
    await (await highValue.asset.connect(signers.deployer).approve(await highValue.vault.getAddress(), huge)).wait();
    await (await highValue.vault.connect(signers.deployer).donate(huge)).wait();
    accounting = await expose(highValue);
    expect(accounting.conservativeValue).to.equal(0n);
    expect(accounting.safeSurplusShares).to.equal(0n);
  });

  it("supports near-uint64 liability values without understating the reserve", async function () {
    const system = await deployManagerSystem({ bufferReserveBps: 5_000 });
    await mintAsset(system, signers.manager, MAX_UINT64);
    await wrap(system.asset, system.fromWrapper, signers.manager, MAX_UINT64);
    await depositThroughPool(system, signers.manager, MAX_UINT64);
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(MAX_UINT64);
    expect(accounting.targetBuffer).to.equal(ceilDiv(MAX_UINT64 * 5_000n, BPS));
    expect(accounting.investable).to.equal(MAX_UINT64 - accounting.targetBuffer);
  });

  it("caps a pool-forwarded withdrawal at unreserved liability", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();

    const queuedId = await requestWithdrawalThroughPool(system, signers.manager, 80n);
    expect((await exposeWithdrawalRequest(system, queuedId)).remaining).to.equal(80n);
    expect((await expose(system)).queuedWithdrawalTotal).to.equal(80n);

    const bypass = await requestWithdrawalBypassThroughPool(system, signers.outsider.address, 100n);
    expect(bypass.accepted).to.equal(20n);
    expect((await exposeWithdrawalRequest(system, bypass.requestId)).paid).to.equal(20n);

    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(80n);
    expect(accounting.queuedWithdrawalTotal).to.equal(80n);
    expect(accounting.queuedWithdrawalTotal).to.be.lessThanOrEqual(accounting.principalLiability);
  });

  it("uses queued claims as the liquid floor when they exceed the normal reserve", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await mintAsset(system, signers.outsider, 50n);
    await wrap(system.asset, system.fromWrapper, signers.outsider, 50n);
    await depositThroughPool(system, signers.outsider, 50n);

    let accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(150n);
    expect(accounting.buffer).to.equal(70n);
    expect(accounting.targetBuffer).to.equal(30n);
    expect(accounting.queuedWithdrawalTotal).to.equal(50n);
    expect(accounting.investable).to.equal(20n);
    await (await system.manager.connect(signers.outsider).investExcess()).wait();
    accounting = await expose(system);
    expect(accounting.buffer).to.equal(50n);
    expect(accounting.investable).to.equal(0n);
    expect(await decryptManagerBatchDeposit(system, 1n)).to.equal(100n);
    await assertPrincipalAccounting(system, [signers.manager, signers.outsider]);
  });

  it("uses the normal reserve when it is higher than queued claims and never invests below liability", async function () {
    const belowTarget = await deployManagerSystem({ bufferReserveBps: 5_000 });
    await mintAsset(belowTarget, signers.manager, 100n);
    await wrap(belowTarget.asset, belowTarget.fromWrapper, signers.manager, 100n);
    await depositThroughPool(belowTarget, signers.manager, 100n);
    await (await belowTarget.manager.investExcess()).wait();
    await requestWithdrawalThroughPool(belowTarget, signers.manager, 60n);
    await mintAsset(belowTarget, signers.outsider, 100n);
    await wrap(belowTarget.asset, belowTarget.fromWrapper, signers.outsider, 100n);
    await depositThroughPool(belowTarget, signers.outsider, 100n);

    let accounting = await expose(belowTarget);
    expect(accounting.principalLiability).to.equal(200n);
    expect(accounting.buffer).to.equal(150n);
    expect(accounting.targetBuffer).to.equal(100n);
    expect(accounting.queuedWithdrawalTotal).to.equal(60n);
    expect(accounting.investable).to.equal(50n);
    await (await belowTarget.manager.investExcess()).wait();
    accounting = await expose(belowTarget);
    expect(accounting.buffer).to.equal(100n);
    expect(accounting.investable).to.equal(0n);
    await assertPrincipalAccounting(belowTarget, [signers.manager, signers.outsider]);

    const allQueued = await deployManagerSystem();
    await mintAsset(allQueued, signers.manager, 100n);
    await wrap(allQueued.asset, allQueued.fromWrapper, signers.manager, 100n);
    await depositThroughPool(allQueued, signers.manager, 100n);
    await (await allQueued.manager.investExcess()).wait();
    await requestWithdrawalThroughPool(allQueued, signers.manager, 100n);
    accounting = await expose(allQueued);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.buffer).to.equal(20n);
    expect(accounting.targetBuffer).to.equal(20n);
    expect(accounting.queuedWithdrawalTotal).to.equal(100n);
    expect(accounting.investable).to.equal(0n);
    await (await allQueued.manager.investExcess()).wait();
    expect((await expose(allQueued)).buffer).to.equal(20n);
    await assertPrincipalAccounting(allQueued, [signers.manager]);
  });

  it("funds only the current withdrawal-batch shortfall and tops up only new queue demand", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const firstRequest = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.connect(signers.outsider).fundWithdrawalLiquidity()).wait();
    expect(await decryptManagerWithdrawalBatchDeposit(system, 1n)).to.equal(30n);
    expect(await system.manager.withdrawalBatchFundingNonce(1)).to.equal(1n);

    await (await system.manager.connect(signers.thirdParty).fundWithdrawalLiquidity()).wait();
    expect(await decryptManagerWithdrawalBatchDeposit(system, 1n)).to.equal(30n);
    expect(await system.manager.withdrawalBatchFundingNonce(1)).to.equal(2n);

    const secondRequest = await requestWithdrawalThroughPool(system, signers.manager, 30n);
    const secondRequestMetadata = await system.manager.withdrawalRequest(secondRequest);
    expect(secondRequestMetadata[5]).to.equal(1n);
    expect(secondRequestMetadata[6]).to.equal(2n);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    expect(await decryptManagerWithdrawalBatchDeposit(system, 1n)).to.equal(60n);
    expect(await system.manager.withdrawalBatchFundingNonce(1)).to.equal(3n);

    await (await system.manager.fundWithdrawalLiquidity()).wait();
    expect(await decryptManagerWithdrawalBatchDeposit(system, 1n)).to.equal(60n);
    expect(await system.manager.withdrawalBatchFundingNonce(1)).to.equal(4n);

    expect(await system.manager.withdrawalRequestCommitted(firstRequest)).to.equal(false);
    expect(await system.manager.withdrawalRequestCommitted(secondRequest)).to.equal(false);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    expect(await system.manager.withdrawalRequestCommitted(firstRequest)).to.equal(true);
    expect(await system.manager.withdrawalRequestCommitted(secondRequest)).to.equal(true);
    await assertPrincipalAccounting(system, [signers.manager]);
  });

  it("keeps post-funding Pending requests cancelable until a later funding attempt", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const committedRequest = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    const laterRequest = await requestWithdrawalThroughPool(system, signers.manager, 30n);
    expect(await system.manager.withdrawalRequestCommitted(laterRequest)).to.equal(false);

    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    expect(await system.manager.withdrawalRequestCommitted(committedRequest)).to.equal(true);
    expect(await system.manager.withdrawalRequestCommitted(laterRequest)).to.equal(false);
    await (await system.pool.connect(signers.manager).cancelWithdrawal(laterRequest)).wait();
    expect((await expose(system)).queuedWithdrawalTotal).to.equal(50n);
    await assertPrincipalAccounting(system, [signers.manager]);
  });

  it("does not associate a request with a previous batch after the batch rolls over", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const firstRequest = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await (await system.vault.setRedeemFailure(true)).wait();
    await dispatchAndProveWithdrawal(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    await (await system.manager.resolveWithdrawalBatch(1)).wait();

    const nextBatchRequest = await requestWithdrawalThroughPool(system, signers.manager, 40n);
    expect(await system.manager.withdrawalRequestCommitted(firstRequest)).to.equal(true);
    expect(await system.manager.withdrawalRequestCommitted(nextBatchRequest)).to.equal(false);
    await (await system.pool.connect(signers.manager).cancelWithdrawal(nextBatchRequest)).wait();
    await assertPrincipalAccounting(system, [signers.manager]);
  });

  it("pays instant withdrawals all-or-zero and keeps oversized requests silent-zero", async function () {
    const system = await deployManagerSystem({ bufferReserveBps: 10_000 });
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);

    const instantId = await requestWithdrawalThroughPool(system, signers.manager, 10n);
    let accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(90n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 90n, reserved: 0n });
    expect((await exposeWithdrawalRequest(system, instantId)).remaining).to.equal(0n);
    await finalizeWithdrawalRequest(system, instantId);
    expect(await system.manager.nextWithdrawalRequestIdToSettle()).to.equal(2);

    const oversizedId = await requestWithdrawalThroughPool(system, signers.manager, 1_000n);
    accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(90n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 90n, reserved: 0n });
    expect((await exposeWithdrawalRequest(system, oversizedId)).remaining).to.equal(0n);
    await finalizeWithdrawalRequest(system, oversizedId);
  });

  it("moves a valid insufficient request into reserved encrypted queue liability", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();

    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.queuedWithdrawalTotal).to.equal(50n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 50n, reserved: 50n });
    expect((await exposeWithdrawalRequest(system, requestId)).remaining).to.equal(50n);
    expect(await system.manager.managerWithdrawalBatch(1)).to.equal(false);

    const duplicateAttempt = await requestWithdrawalThroughPool(system, signers.manager, 60n);
    expect((await exposeWithdrawalRequest(system, duplicateAttempt)).remaining).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 50n, reserved: 50n });
  });

  it("allows only the request owner to cancel before strategy commitment", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);

    await expect(system.pool.connect(signers.outsider).cancelWithdrawal(requestId)).to.be.revertedWith(
      "Not request owner",
    );
    await (await system.pool.connect(signers.manager).cancelWithdrawal(requestId)).wait();
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 100n, reserved: 0n });
    await expect(system.pool.connect(signers.manager).cancelWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestClosed",
    );
    await expect(system.manager.settleWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestClosed",
    );
  });

  it("reclaims a Pending manager deposit batch before using strategy liquidity", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);

    await (await system.manager.connect(signers.outsider).reclaimPendingDepositBatch(1)).wait();
    expect(await system.manager.managerDepositBatchResolved(1)).to.equal(true);
    let accounting = await expose(system);
    expect(accounting.buffer).to.equal(100n);
    expect(accounting.shareBalance).to.equal(0n);
    expect(accounting.principalLiability).to.equal(100n);
    await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
    accounting = await expose(system);
    expect(accounting.buffer).to.equal(50n);
    expect(accounting.principalLiability).to.equal(50n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 50n, reserved: 0n });
    await finalizeWithdrawalRequest(system, requestId);
  });

  it("derives withdrawal shares, keeps in-flight output out of buffer, and settles permissionlessly", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();

    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.connect(signers.outsider).fundWithdrawalLiquidity()).wait();
    expect(await system.manager.managerWithdrawalBatch(1)).to.equal(true);
    let accounting = await expose(system);
    expect(accounting.buffer).to.equal(20n);
    expect(accounting.shareBalance).to.equal(50n);
    expect(accounting.queuedWithdrawalTotal).to.equal(50n);
    expect((await exposeWithdrawalRequest(system, requestId)).remaining).to.equal(50n);

    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.thirdParty).dispatchBatch()).wait();
    expect(await system.manager.withdrawalRequestCommitted(requestId)).to.equal(true);
    await dispatchAndProveWithdrawal(system.withdrawalBatcher, system.shareWrapper, signers.thirdParty);
    await (await system.manager.connect(signers.thirdParty).resolveWithdrawalBatch(1)).wait();
    accounting = await expose(system);
    expect(accounting.buffer).to.equal(50n);
    expect(accounting.shareBalance).to.equal(50n);
    expect(accounting.principalLiability).to.equal(100n);
    await expect(system.manager.resolveWithdrawalBatch(1)).to.be.revertedWithCustomError(
      system.manager,
      "ManagerWithdrawalBatchAlreadyResolved",
    );

    await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
    accounting = await expose(system);
    expect(accounting.buffer).to.equal(0n);
    expect(accounting.principalLiability).to.equal(50n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 50n, reserved: 0n });
    await finalizeWithdrawalRequest(system, requestId);
  });

  it("does not allow cancellation after a withdrawal batch is dispatched", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await expect(system.pool.connect(signers.manager).cancelWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestCommitted",
    );
  });

  it("cancels a failed withdrawal batch by returning original strategy shares", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await (await system.vault.setRedeemFailure(true)).wait();
    await dispatchAndProveWithdrawal(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    expect(await system.withdrawalBatcher.batchState(1)).to.equal(3);
    await (await system.manager.connect(signers.thirdParty).resolveWithdrawalBatch(1)).wait();
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.queuedWithdrawalTotal).to.equal(50n);
    expect(accounting.buffer).to.equal(20n);
    expect(accounting.shareBalance).to.equal(80n);
    expect((await exposeWithdrawalRequest(system, requestId)).remaining).to.equal(50n);
  });

  it("caps redemption at actual shares and preserves the queue after strategy loss", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    await (await system.vault.simulateLoss(60n)).wait();

    await (await system.manager.fundWithdrawalLiquidity()).wait();
    const accounting = await expose(system);
    expect(accounting.shareBalance).to.equal(0n);
    expect(accounting.principalLiability).to.equal(100n);
    expect(accounting.queuedWithdrawalTotal).to.equal(50n);
    expect((await exposeWithdrawalRequest(system, requestId)).remaining).to.equal(50n);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProveWithdrawal(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    expect(await system.withdrawalBatcher.batchState(1)).to.equal(2);
    await (await system.manager.resolveWithdrawalBatch(1)).wait();
    const accountingAfterLoss = await expose(system);
    expect(accountingAfterLoss.buffer).to.equal(40n);
    expect(accountingAfterLoss.shareBalance).to.equal(0n);
    expect(accountingAfterLoss.principalLiability).to.equal(100n);
    expect(accountingAfterLoss.queuedWithdrawalTotal).to.equal(50n);
  });

  it("enforces FIFO settlement and uses an encrypted completion proof", async function () {
    const system = await deployManagerSystem({ bufferReserveBps: 0 });
    for (const [signer, amount] of [
      [signers.manager, 50n],
      [signers.outsider, 50n],
      [signers.thirdParty, 50n],
    ] as const) {
      await mintAsset(system, signer, amount);
      await wrap(system.asset, system.fromWrapper, signer, amount);
      await depositThroughPool(system, signer, amount);
    }
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    const aliceRequest = await requestWithdrawalThroughPool(system, signers.manager, 40n);
    const bobRequest = await requestWithdrawalThroughPool(system, signers.outsider, 40n);
    const carolRequest = await requestWithdrawalThroughPool(system, signers.thirdParty, 40n);
    await expect(system.manager.settleWithdrawal(bobRequest)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestNotHead",
    );

    await (await system.manager.fundWithdrawalLiquidity()).wait();
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.thirdParty).dispatchBatch()).wait();
    await dispatchAndProveWithdrawal(system.withdrawalBatcher, system.shareWrapper, signers.thirdParty);
    await (await system.manager.resolveWithdrawalBatch(1)).wait();

    for (const requestId of [aliceRequest, bobRequest, carolRequest]) {
      await (await system.manager.connect(signers.outsider).settleWithdrawal(requestId)).wait();
      await finalizeWithdrawalRequest(system, requestId);
    }
    const accounting = await expose(system);
    expect(accounting.principalLiability).to.equal(30n);
    expect(accounting.queuedWithdrawalTotal).to.equal(0n);
    expect(await exposePositions(system, signers.manager)).to.deep.equal({ active: 10n, reserved: 0n });
    expect(await exposePositions(system, signers.outsider)).to.deep.equal({ active: 10n, reserved: 0n });
    expect(await exposePositions(system, signers.thirdParty)).to.deep.equal({ active: 10n, reserved: 0n });
  });

  it("keeps queued obligations inside safe-surplus liability accounting", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    await (await system.manager.resolveDepositBatch(1)).wait();
    const before = (await expose(system)).safeSurplusShares;
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 50n);
    const afterQueue = await expose(system);
    expect(afterQueue.principalLiability).to.equal(100n);
    expect(afterQueue.queuedWithdrawalTotal).to.equal(50n);
    expect(afterQueue.safeSurplusShares).to.equal(before);
    await (await system.manager.fundWithdrawalLiquidity()).wait();
    expect((await expose(system)).safeSurplusShares).to.equal(0n);
    await expect(system.manager.settleWithdrawal(requestId)).to.not.be.reverted;
  });

  it("rejects invalid valuation for strategy redemption without treating it as zero backing", async function () {
    const system = await deployManagerSystem();
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    await (await system.manager.investExcess()).wait();
    await (await system.vault.setPreviewRedeemFailure(true)).wait();
    await expect(system.manager.fundWithdrawalLiquidity()).to.be.revertedWithCustomError(
      system.manager,
      "InvalidValuation",
    );
  });

  it("makes repeated settlement and batch resolution economically idempotent", async function () {
    const system = await deployManagerSystem({ bufferReserveBps: 10_000 });
    await mintAsset(system, signers.manager, 100n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 100n);
    await depositThroughPool(system, signers.manager, 100n);
    const requestId = await requestWithdrawalThroughPool(system, signers.manager, 10n);
    await (await system.manager.settleWithdrawal(requestId)).wait();
    const afterFirst = await expose(system);
    await (await system.manager.settleWithdrawal(requestId)).wait();
    const afterSecond = await expose(system);
    expect(afterSecond.principalLiability).to.equal(afterFirst.principalLiability);
    expect(afterSecond.queuedWithdrawalTotal).to.equal(afterFirst.queuedWithdrawalTotal);
    await finalizeWithdrawalRequest(system, requestId);
    await expect(system.manager.settleWithdrawal(requestId)).to.be.revertedWithCustomError(
      system.manager,
      "WithdrawalRequestClosed",
    );
  });
});
