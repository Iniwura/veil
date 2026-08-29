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
  manager: VeilStrategyManagerV2TestHarness;
};

let signers: Signers;

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

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

  // V3 preserves the two-argument manager ABI, but manager processing now only funds the round.
  // Each prize slot is delivered permissionlessly in its own HCU-bounded transaction.
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

async function advanceToClose(pool: VeilPoolV3): Promise<void> {
  const closesAt = Number(await pool.nextDrawClosesAt());
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable");
  if (latest.timestamp < closesAt) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
    await ethers.provider.send("evm_mine", []);
  }
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

async function exposeSafeSurplus(system: System): Promise<bigint> {
  await (await system.manager.connect(signers.keeper).exposeAccountingForTest()).wait();
  return decrypt64(
    await system.manager.getAddress(),
    await system.manager.lastSafeSurplusShares(),
    signers.keeper,
  );
}

async function drawAndFinalizeAllPrizes(system: System, roundId: bigint): Promise<void> {
  for (let prizeIndex = 0; prizeIndex < 3; prizeIndex += 1) {
    await (await system.pool.connect(signers.keeper).blindDrawPrize(roundId, prizeIndex)).wait();
    const winnerHandle = await system.pool.getEncryptedPrizeWinner(roundId, prizeIndex);
    const result = await fhevm.publicDecrypt([winnerHandle]);
    const clearWinner = result.clearValues[
      Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
    ] as string;
    const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [clearWinner]);
    await (
      await system.pool
        .connect(signers.keeper)
        .finalizePrizeWinner(roundId, prizeIndex, encodedWinner, result.decryptionProof)
    ).wait();
  }
}

function signerForWinner(winner: string): HardhatEthersSigner {
  if (winner.toLowerCase() === signers.alice.address.toLowerCase()) return signers.alice;
  if (winner.toLowerCase() === signers.bob.address.toLowerCase()) return signers.bob;
  throw new Error(`Unexpected prize winner ${winner}`);
}

describe("UNVEIL V3 prize integration", function () {
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

  it("funds only safe surplus and delivers 50/30/remainder across bounded prize transactions", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await (await system.manager.connect(signers.keeper).investExcess()).wait();
    await advanceBatchAge(system.deposits);
    await (await system.deposits.connect(signers.keeper).dispatchBatch()).wait();
    await proveDepositBatch(system);
    await (await system.manager.connect(signers.keeper).resolveDepositBatch(1)).wait();

    // TEST/DEMO ONLY: simulate ERC-4626 yield by donating underlying assets to the mock vault.
    await (await system.asset.mint(signers.deployer.address, 40)).wait();
    await (await system.asset.approve(await system.vault.getAddress(), 40)).wait();
    await (await system.vault.donate(40)).wait();

    // Round 1 is intentionally immature. Round 2 is the first eligible draw.
    await advanceToClose(system.pool);
    await (await system.pool.connect(signers.keeper).cancelInsufficientRound()).wait();
    expect(await system.pool.getDrawState(1)).to.equal(5n);

    await advanceToClose(system.pool);
    await (await system.pool.connect(signers.keeper).snapshotRound()).wait();
    await drawAndFinalizeAllPrizes(system, 2n);
    expect(await system.pool.getDrawState(2)).to.equal(3n);

    const safeSurplusBefore = await exposeSafeSurplus(system);
    expect(safeSurplusBefore).to.be.greaterThan(0n);

    // The manager advances over skipped Round 1, then funds finalized Round 2 without doing
    // prize division/transfers in the same FHE depth chain.
    await (await system.manager.connect(signers.keeper).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(2n);
    await (await system.manager.connect(signers.keeper).processNextPrizeRound()).wait();
    expect(await system.manager.nextPrizeRoundId()).to.equal(3n);

    const fundedStatus = await system.prizeVault.roundStatus(2);
    expect(fundedStatus[0]).to.equal(true);
    expect(fundedStatus[1]).to.equal(0n);
    expect(fundedStatus[2]).to.equal(false);

    await expect(system.prizeVault.connect(signers.keeper).deliverPrize(2, 2)).to.be.revertedWithCustomError(
      system.prizeVault,
      "PriorPrizesPending",
    );

    // One slot per transaction keeps the FHE operation chain below the HCU depth limit.
    await (await system.prizeVault.connect(signers.keeper).deliverPrize(2, 0)).wait();
    await (await system.prizeVault.connect(signers.keeper).deliverPrize(2, 1)).wait();
    await (await system.prizeVault.connect(signers.keeper).deliverPrize(2, 2)).wait();

    const deliveredStatus = await system.prizeVault.roundStatus(2);
    expect(deliveredStatus[0]).to.equal(true);
    expect(deliveredStatus[1]).to.equal(3n);
    expect(deliveredStatus[2]).to.equal(true);

    const expected = [
      (safeSurplusBefore * 50n) / 100n,
      (safeSurplusBefore * 30n) / 100n,
      safeSurplusBefore - (safeSurplusBefore * 50n) / 100n - (safeSurplusBefore * 30n) / 100n,
    ];

    let deliveredTotal = 0n;
    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex += 1) {
      const [, winner] = await system.prizeVault.prizeStatus(2, prizeIndex);
      const winnerSigner = signerForWinner(winner);
      const prizeHandle = await system.prizeVault.connect(winnerSigner).encryptedPrizeOf(2, prizeIndex);
      const delivered = await decrypt64(await system.prizeVault.getAddress(), prizeHandle, winnerSigner);
      expect(delivered).to.equal(expected[prizeIndex]);
      deliveredTotal += delivered;
    }
    expect(deliveredTotal).to.equal(safeSurplusBefore);

    // Funding/delivery never changes protected principal liability and consumes only safe surplus.
    await (await system.manager.connect(signers.keeper).exposeAccountingForTest()).wait();
    expect(
      await decrypt64(
        await system.manager.getAddress(),
        await system.manager.lastPrincipalLiability(),
        signers.keeper,
      ),
    ).to.equal(200n);
    expect(
      await decrypt64(
        await system.manager.getAddress(),
        await system.manager.lastSafeSurplusShares(),
        signers.keeper,
      ),
    ).to.equal(0n);
  });
});
