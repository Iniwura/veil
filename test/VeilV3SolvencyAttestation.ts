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
  VeilStrategyManagerV3,
  VeilWithdrawalBatcher,
} from "../types";

const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  keeper: HardhatEthersSigner;
};

type System = {
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV3;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV3;
};

let signers: Signers;

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
    await ethers.getContractFactory("VeilStrategyManagerV3")
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
  )) as VeilStrategyManagerV3;

  await (await pool.configureStrategyManager(await manager.getAddress())).wait();
  return { asset, principal, vault, shares, deposits, withdrawals, pool, prizeVault, manager };
}

async function fundAndApprove(system: System, signer: HardhatEthersSigner, amount = 10_000n): Promise<void> {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.principal.getAddress(), amount)).wait();
  await (await system.principal.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.principal.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number): Promise<void> {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
}

async function advanceBatchAge(batcher: VeilDepositBatcher): Promise<void> {
  const openedAt = Number(await batcher.currentBatchOpenedAt());
  const age = Number(await batcher.minimumBatchAge());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < openedAt + age) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [openedAt + age]);
    await ethers.provider.send("evm_mine", []);
  }
}

async function proveDepositBatch(system: System, batchId = 1n): Promise<void> {
  const requestId = await system.deposits.unwrapRequestId(batchId);
  const amount = await system.principal.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([amount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await system.deposits.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function settleInvestment(system: System): Promise<void> {
  await (await system.manager.connect(signers.keeper).investExcess()).wait();
  await advanceBatchAge(system.deposits);
  await (await system.deposits.connect(signers.keeper).dispatchBatch()).wait();
  await proveDepositBatch(system);
  await (await system.manager.connect(signers.keeper).resolveDepositBatch(1)).wait();
}

async function decryptPendingCoverage(system: System): Promise<{ covered: boolean; proof: string }> {
  const handle = await system.manager.encryptedPendingPrincipalCoverage();
  const result = await fhevm.publicDecrypt([handle]);
  const covered = result.clearValues[Object.keys(result.clearValues)[0] as keyof typeof result.clearValues] as boolean;
  return { covered, proof: result.decryptionProof };
}

describe("UNVEIL V3 principal coverage attestation", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = {
      deployer: accounts[0],
      alice: accounts[1],
      bob: accounts[2],
      keeper: accounts[3],
    };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("reveals only a KMS-proven coverage boolean and rejects replay", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    await settleInvestment(system);

    await (await system.manager.connect(signers.keeper).requestPrincipalCoverageAttestation()).wait();
    expect(await system.manager.coverageAttestationPending()).to.equal(true);
    expect(await system.manager.pendingCoverageAttestationRequestId()).to.equal(1n);

    const first = await decryptPendingCoverage(system);
    expect(first.covered).to.equal(true);

    await expect(system.manager.connect(signers.keeper).finalizePrincipalCoverageAttestation(1, false, first.proof)).to
      .be.reverted;

    await (
      await system.manager.connect(signers.keeper).finalizePrincipalCoverageAttestation(1, true, first.proof)
    ).wait();

    expect(await system.manager.coverageAttestationPending()).to.equal(false);
    expect(await system.manager.principalCoverageVerified()).to.equal(true);
    expect(await system.manager.principalCoverage()).to.equal(true);
    expect(await system.manager.latestCoverageAttestationRequestId()).to.equal(1n);
    expect(await system.manager.principalCoverageVerifiedAt()).to.be.greaterThan(0n);

    await expect(
      system.manager.connect(signers.keeper).finalizePrincipalCoverageAttestation(1, true, first.proof),
    ).to.be.revertedWithCustomError(system.manager, "CoverageAttestationNotPending");

    // TEST/DEMO ONLY: reduce ERC-4626 backing enough that settled strategy shares no longer
    // conservatively cover the encrypted principal liability.
    await (await system.vault.connect(signers.deployer).simulateLoss(120)).wait();

    await (await system.manager.connect(signers.keeper).requestPrincipalCoverageAttestation()).wait();
    expect(await system.manager.pendingCoverageAttestationRequestId()).to.equal(2n);

    const second = await decryptPendingCoverage(system);
    expect(second.covered).to.equal(false);

    await (
      await system.manager.connect(signers.keeper).finalizePrincipalCoverageAttestation(2, false, second.proof)
    ).wait();

    expect(await system.manager.principalCoverageVerified()).to.equal(true);
    expect(await system.manager.principalCoverage()).to.equal(false);
    expect(await system.manager.latestCoverageAttestationRequestId()).to.equal(2n);
  });
});
