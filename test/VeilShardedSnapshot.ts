import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { VeilShardedSnapshotHarness } from "../types";

const DRAW_PERIOD = 60 * 60;
const SHARD_COUNT = 24;

type Signers = {
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  late: HardhatEthersSigner;
};

let signers: Signers;

async function deploySnapshot() {
  return (await (
    await ethers.getContractFactory("VeilShardedSnapshotHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedSnapshotHarness;
}

async function advanceToRoundClose(snapshot: VeilShardedSnapshotHarness, roundId: bigint) {
  const firstOpen = await snapshot.firstDrawOpensAt();
  const closesAt = firstOpen + roundId * BigInt(DRAW_PERIOD);
  await time.increaseTo(closesAt + 1n);
  return closesAt;
}

async function processAllShards(snapshot: VeilShardedSnapshotHarness, roundId: bigint, startShard = 0) {
  for (let shard = startShard; shard < SHARD_COUNT; shard++) {
    await (await snapshot.snapshotShard(roundId, shard)).wait();
  }
}

async function decryptSnapshotWeight(
  snapshot: VeilShardedSnapshotHarness,
  signer: HardhatEthersSigner,
  roundId: bigint,
) {
  const handle = await snapshot.connect(signer).encryptedSnapshotWeightOf(roundId);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await snapshot.getAddress(), signer);
}

describe("VeilShardedSnapshot", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { alice: accounts[1], bob: accounts[2], late: accounts[3] };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("snapshots 24 shards in bounded steps while preserving full-round maturity", async function () {
    const snapshot = await deploySnapshot();

    await (await snapshot.acquire(signers.alice.address)).wait();
    await (await snapshot.acquire(signers.bob.address)).wait();
    await (await snapshot.setWeight(signers.alice.address, 100)).wait();
    await (await snapshot.setWeight(signers.bob.address, 100)).wait();

    expect(await snapshot.seatShard(signers.alice.address)).to.equal(0);
    expect(await snapshot.seatShard(signers.bob.address)).to.equal(1);
    expect(await snapshot.seatEligibleFromRoundId(signers.alice.address)).to.equal(2);
    expect(await snapshot.seatEligibleFromRoundId(signers.bob.address)).to.equal(2);

    await advanceToRoundClose(snapshot, 1n);
    await (await snapshot.setNextRoundId(2)).wait();

    // Top-up after round 1 closes. Shard-local sealing must preserve Alice's round-1 weight at 100.
    await (await snapshot.setWeight(signers.alice.address, 900)).wait();

    await advanceToRoundClose(snapshot, 2n);
    await (await snapshot.beginSnapshot(2)).wait();
    await (await snapshot.snapshotShard(2, 0)).wait();

    await expect(snapshot.finalizeSnapshot(2)).to.be.revertedWith("Shards pending");
    await expect(snapshot.snapshotShard(2, 0)).to.be.revertedWith("Shard already snapshotted");

    await processAllShards(snapshot, 2n, 1);
    await (await snapshot.finalizeSnapshot(2)).wait();

    const round = await snapshot.getShardedSnapshotRound(2);
    expect(round.participantCount).to.equal(2);
    expect(round.processedShardCount).to.equal(SHARD_COUNT);
    expect(round.begun).to.equal(true);
    expect(round.finalized).to.equal(true);

    expect((await snapshot.getSnapshotShard(2, 0)).participantCount).to.equal(1);
    expect((await snapshot.getSnapshotShard(2, 1)).participantCount).to.equal(1);
    expect(await decryptSnapshotWeight(snapshot, signers.alice, 2n)).to.equal(100n);
    expect(await decryptSnapshotWeight(snapshot, signers.bob, 2n)).to.equal(100n);
  });

  it("does not let a saver joining after the close backfill the closed round", async function () {
    const snapshot = await deploySnapshot();

    await (await snapshot.acquire(signers.alice.address)).wait();
    await (await snapshot.acquire(signers.bob.address)).wait();
    await (await snapshot.setWeight(signers.alice.address, 100)).wait();
    await (await snapshot.setWeight(signers.bob.address, 100)).wait();

    await advanceToRoundClose(snapshot, 1n);
    await (await snapshot.setNextRoundId(2)).wait();
    await advanceToRoundClose(snapshot, 2n);

    // The acquire call seals shard 2 before adding the late saver.
    await (await snapshot.acquire(signers.late.address)).wait();
    await (await snapshot.setWeight(signers.late.address, 1_000)).wait();
    expect(await snapshot.seatShard(signers.late.address)).to.equal(2);
    expect(await snapshot.seatEligibleFromRoundId(signers.late.address)).to.equal(3);

    await (await snapshot.beginSnapshot(2)).wait();
    await processAllShards(snapshot, 2n);
    await (await snapshot.finalizeSnapshot(2)).wait();

    const round = await snapshot.getShardedSnapshotRound(2);
    expect(round.participantCount).to.equal(2);
    expect((await snapshot.getSnapshotShard(2, 2)).participantCount).to.equal(0);
    await expect(snapshot.connect(signers.late).encryptedSnapshotWeightOf(2)).to.be.revertedWith("Not in round");
  });
});
