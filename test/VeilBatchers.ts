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
  VeilDepositBatcher,
  VeilDepositBatcher__factory,
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

type System = {
  asset: MockUSDC;
  vault: MockYieldVault4626;
  fromWrapper: Wrapper;
  shareWrapper: Wrapper;
  depositBatcher: VeilDepositBatcher;
  withdrawalBatcher: VeilWithdrawalBatcher;
};

const MINIMUM_BATCH_AGE = 60 * 60;
const UNIT = 1_000_000n;

async function deploySystem(options: { lowSource?: boolean; lowShare?: boolean } = {}): Promise<System> {
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

  return { asset, vault, fromWrapper, shareWrapper, depositBatcher, withdrawalBatcher };
}

async function mintAsset(system: System, signer: HardhatEthersSigner, amount: bigint) {
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
  const wrapperAddress = await wrapper.getAddress();
  const batcherAddress = await batcher.getAddress();
  const encrypted = await fhevm.createEncryptedInput(wrapperAddress, signer.address).add64(amount).encrypt();
  const transferAndCall = wrapper
    .connect(signer)
    .getFunction("confidentialTransferAndCall(address,bytes32,bytes,bytes)");
  await (await transferAndCall(batcherAddress, encrypted.handles[0], encrypted.inputProof, "0x")).wait();
}

async function decryptBalance(wrapper: Wrapper, signer: HardhatEthersSigner) {
  const encryptedBalance = await wrapper.confidentialBalanceOf(signer.address);
  return fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, await wrapper.getAddress(), signer);
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
  batcher: VeilDepositBatcher | VeilWithdrawalBatcher,
  fromWrapper: Wrapper,
  relayer: HardhatEthersSigner,
  batchId = 1n,
) {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await fromWrapper.unwrapAmount(requestId);
  const publicResult = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = publicResult.clearValues[encryptedAmount as `0x${string}`] as bigint;

  await (
    await batcher.connect(relayer).dispatchBatchCallback(batchId, clearAmount, publicResult.decryptionProof)
  ).wait();

  return { encryptedAmount, publicResult, clearAmount };
}

async function completeDeposit(
  system: System,
  signer: HardhatEthersSigner,
  relayer: HardhatEthersSigner,
  amount: bigint,
) {
  await join(system.fromWrapper, system.depositBatcher, signer, amount);
  await advanceBatchAge(system.depositBatcher);
  await (await system.depositBatcher.connect(relayer).dispatchBatch()).wait();
  await dispatchAndProve(system.depositBatcher, system.fromWrapper, relayer);
  await (await system.depositBatcher.connect(relayer).claim(1, signer.address)).wait();
}

describe("UNVEIL Slice 1 confidential batch routes", function () {
  let signers: Signers;
  let system: System;

  before(async function () {
    const [deployer, manager, outsider, thirdParty] = await ethers.getSigners();
    signers = { deployer, manager, outsider, thirdParty };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This route test suite requires the local FHEVM mock");
      this.skip();
    }
    system = await deploySystem();
  });

  it("pins the route, validates inverse assets, and exposes the timing policy", async function () {
    expect(await system.depositBatcher.fromToken()).to.equal(await system.fromWrapper.getAddress());
    expect(await system.depositBatcher.toToken()).to.equal(await system.shareWrapper.getAddress());
    expect(await system.depositBatcher.vault()).to.equal(await system.vault.getAddress());
    expect(await system.withdrawalBatcher.fromToken()).to.equal(await system.shareWrapper.getAddress());
    expect(await system.withdrawalBatcher.toToken()).to.equal(await system.fromWrapper.getAddress());
    expect(await system.withdrawalBatcher.vault()).to.equal(await system.vault.getAddress());
    expect(await system.depositBatcher.minimumBatchAge()).to.equal(MINIMUM_BATCH_AGE);
    expect(await system.depositBatcher.currentBatchOpenedAt()).to.be.greaterThan(0);
    expect(await system.depositBatcher.routeDescription()).to.equal("UNVEIL confidential underlying to ERC4626 shares");
    expect(await system.withdrawalBatcher.routeDescription()).to.equal(
      "UNVEIL confidential ERC4626 shares to underlying",
    );
    expect(await system.fromWrapper.name()).to.equal("TEST MockUSDC Confidential");
    expect(await system.fromWrapper.symbol()).to.equal("t-cUSDC");
    expect(await system.fromWrapper.contractURI()).to.equal("test-only://mock-usdc");
    expect(await system.fromWrapper.decimals()).to.equal(6);

    const assetFactory = (await ethers.getContractFactory("MockUSDC")) as MockUSDC__factory;
    const wrongAsset = await assetFactory.deploy();
    const wrapperFactory = (await ethers.getContractFactory(
      "MockUSDCConfidentialWrapper",
    )) as MockUSDCConfidentialWrapper__factory;
    const wrongWrapper = await wrapperFactory.deploy(await wrongAsset.getAddress());
    const depositFactory = (await ethers.getContractFactory("VeilDepositBatcher")) as VeilDepositBatcher__factory;

    await expect(
      depositFactory.deploy(
        await wrongWrapper.getAddress(),
        await system.shareWrapper.getAddress(),
        await system.vault.getAddress(),
        MINIMUM_BATCH_AGE,
      ),
    ).to.be.revertedWith("Invalid from asset");

    await expect(
      depositFactory.deploy(
        await system.fromWrapper.getAddress(),
        await wrongWrapper.getAddress(),
        await system.vault.getAddress(),
        MINIMUM_BATCH_AGE,
      ),
    ).to.be.revertedWith("Invalid to asset");

    const withdrawalFactory = (await ethers.getContractFactory(
      "VeilWithdrawalBatcher",
    )) as VeilWithdrawalBatcher__factory;
    await expect(
      withdrawalFactory.deploy(
        await wrongWrapper.getAddress(),
        await system.fromWrapper.getAddress(),
        await system.vault.getAddress(),
        MINIMUM_BATCH_AGE,
      ),
    ).to.be.revertedWith("Invalid from asset");

    await expect(
      withdrawalFactory.deploy(
        await system.shareWrapper.getAddress(),
        await wrongWrapper.getAddress(),
        await system.vault.getAddress(),
        MINIMUM_BATCH_AGE,
      ),
    ).to.be.revertedWith("Invalid to asset");
  });

  it("keeps a manager batch pending, then permits an outsider to dispatch and claim", async function () {
    await mintAsset(system, signers.manager, 2n * UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, 2n * UNIT);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, 2n * UNIT);

    expect(await system.depositBatcher.batchState(1)).to.equal(0);
    await expect(system.depositBatcher.connect(signers.outsider).dispatchBatch()).to.be.revertedWith(
      "Batch not mature",
    );

    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();

    expect(await system.depositBatcher.currentBatchId()).to.equal(2);
    expect(await system.depositBatcher.batchState(1)).to.equal(1);
    const callbackResult = await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(2);

    await (await system.depositBatcher.connect(signers.outsider).claim(1, signers.manager.address)).wait();
    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(2n * UNIT);
    await expect(
      system.depositBatcher
        .connect(signers.outsider)
        .dispatchBatchCallback(1, callbackResult.clearAmount, callbackResult.publicResult.decryptionProof)
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;
    await (await system.depositBatcher.connect(signers.outsider).claim(1, signers.manager.address)).wait();
    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(2n * UNIT);
    await expect(
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        await system.shareWrapper.confidentialBalanceOf(signers.manager.address),
        await system.shareWrapper.getAddress(),
        signers.outsider,
      ),
    ).to.be.rejected;
  });

  it("allows direct third-party participation without breaking manager pro-rata claims", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await mintAsset(system, signers.outsider, 3n * UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.outsider, 3n * UNIT);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, UNIT);
    await join(system.fromWrapper, system.depositBatcher, signers.outsider, 3n * UNIT);

    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.thirdParty).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.thirdParty);

    await (await system.depositBatcher.connect(signers.thirdParty).claim(1, signers.manager.address)).wait();
    await (await system.depositBatcher.connect(signers.manager).claim(1, signers.outsider.address)).wait();

    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(UNIT);
    expect(await decryptBalance(system.shareWrapper, signers.outsider)).to.equal(3n * UNIT);
  });

  it("routes confidential shares back to confidential underlying through ERC4626 redeem", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await completeDeposit(system, signers.manager, signers.outsider, UNIT);

    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(UNIT);
    await join(system.shareWrapper, system.withdrawalBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    await (await system.withdrawalBatcher.connect(signers.thirdParty).claim(1, signers.manager.address)).wait();

    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(UNIT);
    expect(await system.vault.totalAssets()).to.equal(0);
  });

  it("uses wrapper rates for both deposit and withdrawal raw-unit conversion", async function () {
    system = await deploySystem({ lowSource: true, lowShare: true });
    expect(await system.fromWrapper.rate()).to.equal(1_000);
    expect(await system.shareWrapper.rate()).to.equal(1_000);

    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(1_000);

    await completeDeposit(system, signers.manager, signers.outsider, 1_000n);
    expect(await system.vault.totalAssets()).to.equal(UNIT);
    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(1_000);

    await join(system.shareWrapper, system.withdrawalBatcher, signers.manager, 1_000n);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    await (await system.withdrawalBatcher.connect(signers.outsider).claim(1, signers.manager.address)).wait();

    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(1_000);
    expect(await system.vault.totalAssets()).to.equal(0);
  });

  it("cancels a deposit whose nonzero preview is below one share-wrapper unit before vault movement", async function () {
    system = await deploySystem({ lowShare: true });
    await mintAsset(system, signers.manager, 1n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 1n);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, 1n);

    expect(await system.vault.previewDeposit(1n)).to.equal(1n);
    expect(await system.shareWrapper.rate()).to.equal(1_000);

    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);

    expect(await system.depositBatcher.batchState(1)).to.equal(3);
    expect(await system.vault.totalAssets()).to.equal(0);
    await (await system.depositBatcher.connect(signers.manager).quit(1)).wait();
    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(1n);
  });

  it("cancels a withdrawal whose nonzero preview is below one underlying-wrapper unit before vault movement", async function () {
    system = await deploySystem({ lowSource: true });
    await mintAsset(system, signers.manager, 2_000n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 2_000n);
    await completeDeposit(system, signers.manager, signers.outsider, 2n);

    expect(await system.vault.totalAssets()).to.equal(2_000n);
    expect(await system.vault.previewRedeem(1n)).to.equal(1n);
    expect(await system.fromWrapper.rate()).to.equal(1_000);

    await join(system.shareWrapper, system.withdrawalBatcher, signers.manager, 1n);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.withdrawalBatcher, system.shareWrapper, signers.outsider);

    expect(await system.withdrawalBatcher.batchState(1)).to.equal(3);
    expect(await system.vault.totalAssets()).to.equal(2_000n);
    await (await system.withdrawalBatcher.connect(signers.manager).quit(1)).wait();
    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(2_000n);
  });

  it("reflects simulated vault performance in later share redemption without exposing share balances", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await completeDeposit(system, signers.manager, signers.outsider, UNIT);

    expect(await system.vault.totalAssets()).to.equal(UNIT);
    expect(await system.vault.convertToAssets(UNIT)).to.equal(UNIT);

    await mintAsset(system, signers.deployer, UNIT / 2n);
    await (await system.asset.connect(signers.deployer).approve(await system.vault.getAddress(), UNIT / 2n)).wait();
    await (await system.vault.connect(signers.deployer).donate(UNIT / 2n)).wait();

    expect(await system.vault.totalAssets()).to.equal(UNIT + UNIT / 2n);
    const expectedRedeemAssets = await system.vault.previewRedeem(UNIT);
    expect(expectedRedeemAssets).to.be.greaterThan(UNIT);
    expect(await system.vault.convertToAssets(UNIT)).to.equal(expectedRedeemAssets);

    await join(system.shareWrapper, system.withdrawalBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    await (await system.withdrawalBatcher.connect(signers.thirdParty).claim(1, signers.manager.address)).wait();

    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(expectedRedeemAssets);
  });

  it("cancels a failed deposit route and lets the participant quit for the original wrapper amount", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await (await system.vault.setDepositFailure(true)).wait();

    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(3);
    await (await system.depositBatcher.connect(signers.manager).quit(1)).wait();

    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(UNIT);
  });

  it("cancels a failed redemption route and lets the participant quit for the original share amount", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await completeDeposit(system, signers.manager, signers.outsider, UNIT);

    await join(system.shareWrapper, system.withdrawalBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.withdrawalBatcher);
    await (await system.withdrawalBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await (await system.vault.setRedeemFailure(true)).wait();

    await dispatchAndProve(system.withdrawalBatcher, system.shareWrapper, signers.outsider);
    expect(await system.withdrawalBatcher.batchState(1)).to.equal(3);
    await (await system.withdrawalBatcher.connect(signers.manager).quit(1)).wait();

    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(UNIT);
  });

  it("supports pending quit, rejects dispatched quit, and rejects invalid callback proofs", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, UNIT);
    await (await system.depositBatcher.connect(signers.manager).quit(1)).wait();
    expect(await system.depositBatcher.batchState(1)).to.equal(0);
    expect(await decryptBalance(system.fromWrapper, signers.manager)).to.equal(UNIT);
    await expect(
      system.depositBatcher
        .connect(signers.manager)
        .claim(1, signers.manager.address)
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;

    await join(system.fromWrapper, system.depositBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await expect(
      system.depositBatcher
        .connect(signers.manager)
        .quit(1)
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;

    const requestId = await system.depositBatcher.unwrapRequestId(1);
    const encryptedAmount = await system.fromWrapper.unwrapAmount(requestId);
    const publicResult = await fhevm.publicDecrypt([encryptedAmount]);
    const clearAmount = publicResult.clearValues[encryptedAmount as `0x${string}`] as bigint;
    await expect(
      system.depositBatcher
        .connect(signers.outsider)
        .dispatchBatchCallback(1, clearAmount, `${publicResult.decryptionProof}dead`)
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;
    expect(await system.depositBatcher.batchState(1)).to.equal(1);

    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(2);
  });

  it("resets the batch age after each permissionless dispatch", async function () {
    await mintAsset(system, signers.manager, 2n);
    await wrap(system.asset, system.fromWrapper, signers.manager, 2n);
    await join(system.fromWrapper, system.depositBatcher, signers.manager, 1n);

    await expect(
      system.depositBatcher
        .connect(signers.outsider)
        .dispatchBatch()
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;

    const firstOpenedAt = await system.depositBatcher.currentBatchOpenedAt();
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();

    const secondOpenedAt = await system.depositBatcher.currentBatchOpenedAt();
    expect(await system.depositBatcher.currentBatchId()).to.equal(2);
    expect(secondOpenedAt).to.be.greaterThanOrEqual(firstOpenedAt + BigInt(MINIMUM_BATCH_AGE));

    await join(system.fromWrapper, system.depositBatcher, signers.manager, 1n);
    await expect(
      system.depositBatcher
        .connect(signers.outsider)
        .dispatchBatch()
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;

    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    expect(await system.depositBatcher.currentBatchId()).to.equal(3);
  });

  it("cancels a zero aggregate safely and prevents duplicate callbacks or claims", async function () {
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.outsider);
    expect(await system.depositBatcher.batchState(1)).to.equal(3);

    await expect(
      system.depositBatcher
        .connect(signers.outsider)
        .dispatchBatchCallback(1, 0, "0x")
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;
    await expect(
      system.depositBatcher
        .connect(signers.manager)
        .claim(1, signers.manager.address)
        .then((transaction) => transaction.wait()),
    ).to.be.rejected;

    const zeroJoinSystem = await deploySystem();
    await join(zeroJoinSystem.fromWrapper, zeroJoinSystem.depositBatcher, signers.manager, 0n);
    await advanceBatchAge(zeroJoinSystem.depositBatcher);
    await (await zeroJoinSystem.depositBatcher.connect(signers.outsider).dispatchBatch()).wait();
    await dispatchAndProve(zeroJoinSystem.depositBatcher, zeroJoinSystem.fromWrapper, signers.outsider);
    expect(await zeroJoinSystem.depositBatcher.batchState(1)).to.equal(3);
  });

  it("settles overlapping dispatched batches independently and out of order", async function () {
    await mintAsset(system, signers.manager, UNIT);
    await mintAsset(system, signers.outsider, 2n * UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.outsider, 2n * UNIT);

    await join(system.fromWrapper, system.depositBatcher, signers.manager, UNIT);
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.thirdParty).dispatchBatch()).wait();

    await join(system.fromWrapper, system.depositBatcher, signers.outsider, 2n * UNIT);
    await advanceBatchAge(system.depositBatcher);
    await (await system.depositBatcher.connect(signers.thirdParty).dispatchBatch()).wait();
    expect(await system.depositBatcher.currentBatchId()).to.equal(3);

    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.thirdParty, 2n);
    await dispatchAndProve(system.depositBatcher, system.fromWrapper, signers.thirdParty, 1n);
    expect(await system.depositBatcher.batchState(1)).to.equal(2);
    expect(await system.depositBatcher.batchState(2)).to.equal(2);
    expect(await system.depositBatcher.exchangeRate(1)).to.equal(1_000_000);
    expect(await system.depositBatcher.exchangeRate(2)).to.equal(1_000_000);

    await (await system.depositBatcher.connect(signers.thirdParty).claim(2, signers.outsider.address)).wait();
    await (await system.depositBatcher.connect(signers.thirdParty).claim(1, signers.manager.address)).wait();
    expect(await decryptBalance(system.shareWrapper, signers.outsider)).to.equal(2n * UNIT);
    expect(await decryptBalance(system.shareWrapper, signers.manager)).to.equal(UNIT);
  });

  it("exposes wrapper capacity observations for the known bricking risk", async function () {
    expect(await system.fromWrapper.maxTotalSupply()).to.equal(2n ** 64n - 1n);
    expect(await system.fromWrapper.inferredTotalSupply()).to.equal(0);

    await mintAsset(system, signers.manager, UNIT);
    await wrap(system.asset, system.fromWrapper, signers.manager, UNIT);
    expect(await system.fromWrapper.inferredTotalSupply()).to.equal(UNIT);
    expect(await system.fromWrapper.inferredTotalSupply()).to.be.lessThanOrEqual(
      await system.fromWrapper.maxTotalSupply(),
    );
    expect(await system.shareWrapper.inferredTotalSupply()).to.equal(0);
  });
});
