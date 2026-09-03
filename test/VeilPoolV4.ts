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
  seatKeeper: VeilPoolV4Helper;
  snapshotBatcher: VeilSnapshotBatcher;
  drawBatcher: VeilDrawBatcher;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV2TestHarness;
};

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DRAW_PERIOD = 60 * 60;
const BATCH_AGE = 60 * 60;
const SHARD_COUNT = 24;

let signers: Signers;

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
    await ethers.getContractFactory("VeilPoolV4")
  ).deploy(await source.getAddress(), drawPeriod)) as VeilPoolV4;
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

async function fundAndApprove(system: System, signer: HardhatEthersSigner, amount = 10_000n) {
  await (await system.asset.mint(signer.address, amount)).wait();
  await (await system.asset.connect(signer).approve(await system.source.getAddress(), amount)).wait();
  await (await system.source.connect(signer).wrap(signer.address, amount)).wait();
  await (await system.source.connect(signer).setOperator(await system.pool.getAddress(), MAX_OPERATOR_UNTIL)).wait();
}

async function finalizeSeatAttestation(system: System, signer: HardhatEthersSigner) {
  const requestId = await system.seatKeeper.pendingSeatAttestationRequestId(signer.address);
  if (requestId === 0n) return;
  const handle = await system.seatKeeper.encryptedSeatAttestationOf(signer.address);
  const proof = await fhevm.publicDecrypt([handle]);
  const key = Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues;
  const balancePositive = Boolean(proof.clearValues[key]);
  await (
    await system.seatKeeper
      .connect(signers.outsider)
      .finalizeSeatAttestation(signer.address, requestId, balancePositive, proof.decryptionProof)
  ).wait();
}

async function deposit(system: System, signer: HardhatEthersSigner, amount: bigint | number, finalize = true) {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
  if (finalize) await finalizeSeatAttestation(system, signer);
}

async function withdraw(system: System, signer: HardhatEthersSigner, amount: bigint | number) {
  const input = await fhevm
    .createEncryptedInput(await system.pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await (await system.pool.connect(signer).withdraw(input.handles[0], input.inputProof)).wait();
  await finalizeSeatAttestation(system, signer);
}

async function decryptBalance(system: System, signer: HardhatEthersSigner) {
  const handle = await system.pool.connect(signer).encryptedBalanceOf();
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await system.pool.getAddress(), signer);
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

async function snapshotCurrentRound(system: System) {
  const roundId = await system.pool.nextRoundId();
  await (await system.pool.beginSnapshotRound()).wait();
  const unprocessedShards: number[] = [];
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    if (!(await system.pool.getSnapshotShard(roundId, shard)).processed) unprocessedShards.push(shard);
  }
  if (unprocessedShards.length > 0) {
    await (await system.snapshotBatcher.snapshotShardsAndComplete(roundId, unprocessedShards)).wait();
    return roundId;
  }
  await (await system.pool.completeSnapshotRound(roundId)).wait();
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
    await system.drawBatcher.finalizePrizeShardAndDrawMember(roundId, prizeIndex, shard, shardProof.decryptionProof)
  ).wait();
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

  it("requires a permissionless KMS attestation before activating a seat and never renews from a deposit alone", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);

    await deposit(system, signers.alice, 0);
    expect(await system.pool.joined(signers.alice.address)).to.equal(true);
    expect(await system.pool.seated(signers.alice.address)).to.equal(false);
    expect(await system.pool.playerCount()).to.equal(0);

    await deposit(system, signers.alice, 100, false);
    expect(await system.pool.seated(signers.alice.address)).to.equal(false);
    expect(await system.pool.playerCount()).to.equal(0);
    expect(await system.seatKeeper.pendingSeatAttestationRequestId(signers.alice.address)).to.equal(2n);

    await finalizeSeatAttestation(system, signers.alice);
    expect(await system.pool.seated(signers.alice.address)).to.equal(true);
    expect(await system.pool.playerCount()).to.equal(1);

    const expiresAt = await system.pool.seatExpiresAt(signers.alice.address);
    await deposit(system, signers.alice, 0);
    expect(await system.pool.seatExpiresAt(signers.alice.address)).to.equal(expiresAt);

    await (await system.seatKeeper.connect(signers.outsider).refreshSeatAttestation(signers.alice.address)).wait();
    await finalizeSeatAttestation(system, signers.alice);
    expect(await system.pool.seated(signers.alice.address)).to.equal(true);
    expect(await system.pool.seatExpiresAt(signers.alice.address)).to.be.gte(expiresAt);

    // An explicit release cancels any in-flight proof so an old positive attestation cannot
    // silently reactivate a seat the saver chose to relinquish.
    await (await system.pool.connect(signers.alice).renewDrawSeat()).wait();
    expect(await system.seatKeeper.pendingSeatAttestationRequestId(signers.alice.address)).to.not.equal(0n);
    await (await system.pool.connect(signers.alice).leaveDrawSeat()).wait();
    expect(await system.seatKeeper.pendingSeatAttestationRequestId(signers.alice.address)).to.equal(0n);
    expect(await system.pool.seated(signers.alice.address)).to.equal(false);
  });

  it("releases a seat after a KMS-proven zero balance following withdrawal", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await deposit(system, signers.alice, 100);
    expect(await system.pool.seated(signers.alice.address)).to.equal(true);

    await withdraw(system, signers.alice, 100);
    expect(await decryptBalance(system, signers.alice)).to.equal(0n);
    expect(await system.pool.seated(signers.alice.address)).to.equal(false);
    expect(await system.pool.playerCount()).to.equal(0);
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
    expect(await snapshotCurrentRound(system)).to.equal(1);
    expect(await system.pool.getDrawState(1)).to.equal(5);

    await advanceToClose(system.pool);
    expect(await snapshotCurrentRound(system)).to.equal(2);
    expect(await system.pool.getDrawState(2)).to.equal(1);

    const info = await system.pool.getDrawInfo(2);
    expect(info.participantCount).to.equal(2);
    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.bob, 2n)).to.equal(100n);
  });

  it("preserves a mature seat boundary across a positive partial withdrawal while keeping closed history immutable", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    // Round 1 is intentionally skipped because the seats mature from round 2. Round 2 then
    // records the mature positive balances in an immutable encrypted snapshot.
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);

    const priorEligibility = await system.pool.seatEligibleFromRoundId(signers.alice.address);
    const priorShard = await system.pool.seatShard(signers.alice.address);
    expect(priorEligibility).to.equal(2n);
    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);

    await withdraw(system, signers.alice, 40);
    expect(await decryptBalance(system, signers.alice)).to.equal(60n);
    expect(await system.pool.seated(signers.alice.address)).to.equal(true);
    expect(await system.pool.playerCount()).to.equal(2);
    expect(await system.pool.seatEligibleFromRoundId(signers.alice.address)).to.equal(priorEligibility);
    expect(await system.pool.seatShard(signers.alice.address)).to.equal(priorShard);

    // Re-acquisition returns to the original shard and does not reset the maturity boundary.

    // The already-closed round remains at its original weight after withdrawal and re-attestation.
    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(100n);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 3n)).to.equal(60n);
    expect((await system.pool.getDrawInfo(3)).participantCount).to.equal(2);
  });

  it("seals the post-close seated top-up maturity boundary on the real pool", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 6);
    await deposit(system, signers.bob, 6);

    // Both seats are mature by the close of round 2.
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 2n)).to.equal(6n);

    // Round 3 has closed, but its snapshot has not started yet. The top-up is
    // after the round-3 boundary and must not become round-3 close weight.
    await advanceToClose(system.pool);
    await deposit(system, signers.alice, 94);
    expect(await decryptBalance(system, signers.alice)).to.equal(100n);
    expect(await system.pool.shardLastSealedRoundId(await system.pool.seatShard(signers.alice.address))).to.equal(3n);

    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 3n)).to.equal(6n);

    // The post-close top-up needs a complete close-to-close boundary before it
    // can increase the mature encrypted weight. The historical round remains immutable.
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 4n)).to.equal(6n);
    expect(await decryptSnapshotWeight(system, signers.alice, 3n)).to.equal(6n);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 5n)).to.equal(100n);
  });

  it("applies an open-round seated top-up only after the next close boundary", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 6);
    await deposit(system, signers.bob, 6);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);

    // The top-up is made while round 3 is open, so it is present at that
    // scheduled close but must still be clamped by round 2's close weight.
    await deposit(system, signers.alice, 94);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 3n)).to.equal(6n);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 4n)).to.equal(100n);
  });

  it("seals a seated top-up across a deep real-pool keeper backlog", async function () {
    const backlogPeriod = 60;
    const system = await deploySystem(backlogPeriod);
    await fundAndApprove(system, signers.alice);
    await deposit(system, signers.alice, 6);

    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    await ethers.provider.send("evm_setNextBlockTimestamp", [firstOpen + 16 * backlogPeriod]);
    await ethers.provider.send("evm_mine", []);

    // Round 16 has closed while the keeper is still pointed at round 1. The
    // top-up must seal the old six-unit close weight through round 16.
    await deposit(system, signers.alice, 94);
    const shard = await system.pool.seatShard(signers.alice.address);
    expect(await system.pool.shardLastSealedRoundId(shard)).to.equal(16n);

    for (let round = 1; round <= 17; round++) {
      await advanceToClose(system.pool);
      expect(await snapshotCurrentRound(system)).to.equal(BigInt(round));
      if (round >= 2) expect(await decryptSnapshotWeight(system, signers.alice, BigInt(round))).to.equal(6n);
    }

    // One additional complete close-to-close boundary is required before the
    // post-close top-up can increase mature weight.
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    expect(await decryptSnapshotWeight(system, signers.alice, 18n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.alice, 16n)).to.equal(6n);
  });

  it("delays fresh-seat maturity beyond a deep settlement backlog", async function () {
    const backlogPeriod = 60;
    const system = await deploySystem(backlogPeriod);
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);

    const firstOpen = Number(await system.pool.firstDrawOpensAt());
    await ethers.provider.send("evm_setNextBlockTimestamp", [firstOpen + 16 * backlogPeriod]);
    await ethers.provider.send("evm_mine", []);

    // Both seats are acquired after round 16 has closed while the scheduled pointer is still 1.
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);
    expect(await system.pool.nextRoundId()).to.equal(1n);
    expect(await system.pool.shardLastSealedRoundId(0)).to.equal(16n);
    expect(await system.pool.shardLastSealedRoundId(1)).to.equal(16n);
    expect(await system.pool.seatEligibleFromRoundId(signers.alice.address)).to.equal(18n);
    expect(await system.pool.seatEligibleFromRoundId(signers.bob.address)).to.equal(18n);

    // Rounds 1-17 use the sealed empty epoch and therefore skip.
    for (let round = 1; round <= 17; round++) {
      await advanceToClose(system.pool);
      expect(await snapshotCurrentRound(system)).to.equal(BigInt(round));
      expect(await system.pool.getDrawState(round)).to.equal(5n);
    }

    // Round 18 is the first round with a positive previous-close term.
    await advanceToClose(system.pool);
    expect(await system.seatKeeper.getDrawAvailability()).to.equal(1);
    expect((await system.seatKeeper.getDrawSchedule()).insufficientParticipants).to.equal(false);
    expect(await snapshotCurrentRound(system)).to.equal(18n);
    expect((await system.pool.getDrawInfo(18)).participantCount).to.equal(2n);
    expect(await decryptSnapshotWeight(system, signers.alice, 18n)).to.equal(100n);
    expect(await decryptSnapshotWeight(system, signers.bob, 18n)).to.equal(100n);

    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex++) {
      const result = await runPrize(system, 18n, prizeIndex);
      expect([signers.alice.address, signers.bob.address]).to.include(result.winner);
    }
    expect(await system.pool.getDrawState(18)).to.equal(3n);
  });

  it("reports open, insufficient, and snapshot-required availability without claiming positive weight", async function () {
    const empty = await deploySystem();
    expect(await empty.seatKeeper.getDrawAvailability()).to.equal(0);
    await advanceToClose(empty.pool);
    expect(await empty.seatKeeper.getDrawAvailability()).to.equal(2);
    expect((await empty.seatKeeper.getDrawSchedule()).insufficientParticipants).to.equal(true);

    const funded = await deploySystem();
    await fundAndApprove(funded, signers.alice);
    await fundAndApprove(funded, signers.bob);
    await deposit(funded, signers.alice, 100);
    await deposit(funded, signers.bob, 100);

    await advanceToClose(funded.pool);
    expect(await funded.seatKeeper.getDrawAvailability()).to.equal(2);
    await (await funded.pool.beginSnapshotRound()).wait();
    expect(await funded.seatKeeper.getDrawAvailability()).to.equal(0);

    await advanceToClose(funded.pool);
    expect(await funded.seatKeeper.getDrawAvailability()).to.equal(1);
    expect((await funded.seatKeeper.getDrawSchedule()).insufficientParticipants).to.equal(false);
  });

  it("finalizes three sharded prizes and remains compatible with V3 prize funding", async function () {
    const system = await deploySystem();
    await fundAndApprove(system, signers.alice);
    await fundAndApprove(system, signers.bob);
    await deposit(system, signers.alice, 100);
    await deposit(system, signers.bob, 100);

    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);
    await advanceToClose(system.pool);
    await snapshotCurrentRound(system);

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
