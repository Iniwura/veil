import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { VeilShardedDrawHarness, VeilShardedSnapshotHarness } from "../types";

const DRAW_PERIOD = 60;
const SHARD_COUNT = 24;
const BACKLOG_ROUNDS = 16n;
const POSITIVE_WEIGHT = 100n;

type Signers = {
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

type SnapshotLike = VeilShardedSnapshotHarness | VeilShardedDrawHarness;

let signers: Signers;

function backlogSafeEligibility(nextRoundId: bigint, latestClosedRoundId: bigint): bigint {
  const nextRoundBoundary = nextRoundId + 1n;
  const closedRoundBoundary = latestClosedRoundId + 2n;
  return nextRoundBoundary > closedRoundBoundary ? nextRoundBoundary : closedRoundBoundary;
}

async function deploySnapshot() {
  return (await (
    await ethers.getContractFactory("VeilShardedSnapshotHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedSnapshotHarness;
}

async function deployDraw() {
  return (await (
    await ethers.getContractFactory("VeilShardedDrawHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedDrawHarness;
}

async function advanceToRoundClose(contract: SnapshotLike, roundId: bigint) {
  const firstOpen = await contract.firstDrawOpensAt();
  await time.increaseTo(firstOpen + roundId * BigInt(DRAW_PERIOD));
}

async function processSnapshot(contract: SnapshotLike, roundId: bigint, finalize = true) {
  await (await contract.beginSnapshot(roundId)).wait();
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    if ((await contract.getSnapshotShard(roundId, shard)).processed) continue;
    await (await contract.snapshotShard(roundId, shard)).wait();
  }
  if (finalize) await (await contract.finalizeSnapshot(roundId)).wait();
}

async function decryptSnapshotWeight(
  contract: SnapshotLike,
  signer: HardhatEthersSigner,
  roundId: bigint,
): Promise<bigint> {
  const handle = await contract.connect(signer).encryptedSnapshotWeightOf(roundId);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await contract.getAddress(), signer);
}

async function acquireBackloggedSeats(contract: SnapshotLike): Promise<void> {
  await advanceToRoundClose(contract, BACKLOG_ROUNDS);
  await (await contract.acquire(signers.alice.address)).wait();
  await (await contract.acquire(signers.bob.address)).wait();
  await (await contract.setWeight(signers.alice.address, POSITIVE_WEIGHT)).wait();
  await (await contract.setWeight(signers.bob.address, POSITIVE_WEIGHT)).wait();
}

describe("V4 maturity boundary with a settlement backlog", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = { alice: accounts[1], bob: accounts[2] };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("uses the backlog-safe fresh-seat boundary for normal, one-round, and deep backlogs", async function () {
    const normal = await deploySnapshot();
    // Seating before the first close has no wall-clock backlog.
    await (await normal.acquire(signers.alice.address)).wait();
    expect(await normal.shardLastSealedRoundId(0)).to.equal(0n);
    expect(await normal.seatEligibleFromRoundId(signers.alice.address)).to.equal(2n);
    expect(await normal.seatEligibleFromRoundId(signers.alice.address)).to.equal(
      backlogSafeEligibility(await normal.nextRoundId(), 0n),
    );

    const oneRoundBacklog = await deploySnapshot();
    await advanceToRoundClose(oneRoundBacklog, 1n);
    await (await oneRoundBacklog.acquire(signers.alice.address)).wait();
    expect(await oneRoundBacklog.shardLastSealedRoundId(0)).to.equal(1n);
    expect(await oneRoundBacklog.seatEligibleFromRoundId(signers.alice.address)).to.equal(3n);
    expect(backlogSafeEligibility(await oneRoundBacklog.nextRoundId(), 1n)).to.equal(3n);
    expect(await oneRoundBacklog.seatEligibleFromRoundId(signers.alice.address)).to.equal(
      backlogSafeEligibility(await oneRoundBacklog.nextRoundId(), 1n),
    );

    const deepBacklog = await deploySnapshot();
    await acquireBackloggedSeats(deepBacklog);
    expect(await deepBacklog.nextRoundId()).to.equal(1n);
    expect(await deepBacklog.shardLastSealedRoundId(0)).to.equal(BACKLOG_ROUNDS);
    expect(await deepBacklog.shardLastSealedRoundId(1)).to.equal(BACKLOG_ROUNDS);

    const currentEligibility = await deepBacklog.seatEligibleFromRoundId(signers.alice.address);
    const expectedEligibility = backlogSafeEligibility(await deepBacklog.nextRoundId(), BACKLOG_ROUNDS);
    expect(expectedEligibility).to.equal(18n);
    expect(currentEligibility).to.equal(expectedEligibility);

    const caughtUp = await deploySnapshot();
    await advanceToRoundClose(caughtUp, BACKLOG_ROUNDS);
    await (await caughtUp.setNextRoundId(17)).wait();
    await (await caughtUp.acquire(signers.alice.address)).wait();
    expect(await caughtUp.seatEligibleFromRoundId(signers.alice.address)).to.equal(
      backlogSafeEligibility(17n, BACKLOG_ROUNDS),
    );
  });

  it("keeps round 17 immature after a deep backlog, then records positive weight in round 18", async function () {
    const snapshot = await deploySnapshot();
    await acquireBackloggedSeats(snapshot);

    expect(await snapshot.seatEligibleFromRoundId(signers.alice.address)).to.equal(18n);
    expect(await snapshot.seatEligibleFromRoundId(signers.bob.address)).to.equal(18n);

    // The acquisition sealed empty historical state through round 16.
    await processSnapshot(snapshot, 16n, false);
    const round16 = await snapshot.getShardedSnapshotRound(16);
    expect(round16.processedShardCount).to.equal(SHARD_COUNT);
    expect(round16.participantCount).to.equal(0n);
    expect((await snapshot.getSnapshotShard(16, 0)).participantCount).to.equal(0);

    await advanceToRoundClose(snapshot, 17n);
    await processSnapshot(snapshot, 17n, false);
    const round17 = await snapshot.getShardedSnapshotRound(17);
    expect(round17.participantCount).to.equal(0n);

    await advanceToRoundClose(snapshot, 18n);
    await processSnapshot(snapshot, 18n);
    const round18 = await snapshot.getShardedSnapshotRound(18);
    expect(round18.participantCount).to.equal(2n);
    expect(await decryptSnapshotWeight(snapshot, signers.alice, 18n)).to.equal(POSITIVE_WEIGHT);
    expect(await decryptSnapshotWeight(snapshot, signers.bob, 18n)).to.equal(POSITIVE_WEIGHT);
  });

  it("does not create a zero-total mature draw during the backlog gap", async function () {
    const draw = await deployDraw();
    await acquireBackloggedSeats(draw);
    await advanceToRoundClose(draw, 17n);
    await processSnapshot(draw, 17n, false);

    expect(await draw.seatEligibleFromRoundId(signers.alice.address)).to.equal(18n);
    expect((await draw.getShardedSnapshotRound(17n)).participantCount).to.equal(0n);
  });
});
