import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { VeilShardedDrawHarness } from "../types";

const DRAW_PERIOD = 60 * 60;
const SHARD_COUNT = 24;

type Signers = {
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  dave: HardhatEthersSigner;
};

let signers: Signers;

async function deployDraw() {
  return (await (
    await ethers.getContractFactory("VeilShardedDrawHarness")
  ).deploy(DRAW_PERIOD)) as VeilShardedDrawHarness;
}

async function advanceToRoundClose(draw: VeilShardedDrawHarness, roundId: bigint) {
  const firstOpen = await draw.firstDrawOpensAt();
  const closesAt = firstOpen + roundId * BigInt(DRAW_PERIOD);
  await time.increaseTo(closesAt + 1n);
}

async function snapshotRoundTwo(draw: VeilShardedDrawHarness) {
  await advanceToRoundClose(draw, 1n);
  await (await draw.setNextRoundId(2)).wait();

  // Seal the first close inside each occupied shard without changing its weight.
  for (const signer of Object.values(signers)) {
    await (await draw.setWeight(signer.address, 100)).wait();
  }

  await advanceToRoundClose(draw, 2n);
  await (await draw.beginSnapshot(2)).wait();
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    await (await draw.snapshotShard(2, shard)).wait();
  }
  await (await draw.finalizeSnapshot(2)).wait();
}

async function decryptPrizeShard(draw: VeilShardedDrawHarness, roundId: bigint, prizeIndex: number) {
  const handle = await draw.getEncryptedPrizeShard(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([handle]);
  const key = Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues;
  return { shard: Number(proof.clearValues[key]), proof: proof.decryptionProof };
}

async function decryptPrizeMember(draw: VeilShardedDrawHarness, roundId: bigint, prizeIndex: number) {
  const handle = await draw.getEncryptedPrizeMember(roundId, prizeIndex);
  const proof = await fhevm.publicDecrypt([handle]);
  const key = Object.keys(proof.clearValues)[0] as keyof typeof proof.clearValues;
  return { winner: String(proof.clearValues[key]), proof: proof.decryptionProof };
}

async function runPrize(draw: VeilShardedDrawHarness, roundId: bigint, prizeIndex: number) {
  await (await draw.drawPrizeShard(roundId, prizeIndex)).wait();
  const shardResult = await decryptPrizeShard(draw, roundId, prizeIndex);
  await (await draw.finalizePrizeShard(roundId, prizeIndex, shardResult.shard, shardResult.proof)).wait();

  await (await draw.drawPrizeMember(roundId, prizeIndex)).wait();
  const memberResult = await decryptPrizeMember(draw, roundId, prizeIndex);
  const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [memberResult.winner]);
  await (await draw.finalizePrizeMember(roundId, prizeIndex, encodedWinner, memberResult.proof)).wait();

  return { shard: shardResult.shard, winner: memberResult.winner };
}

describe("VeilShardedDraw", function () {
  before(async function () {
    const accounts = await ethers.getSigners();
    signers = {
      alice: accounts[1],
      bob: accounts[2],
      carol: accounts[3],
      dave: accounts[4],
    };
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("selects a weighted shard first and then a member only inside that shard", async function () {
    const draw = await deployDraw();
    for (const signer of Object.values(signers)) {
      await (await draw.acquire(signer.address)).wait();
      await (await draw.setWeight(signer.address, 100)).wait();
    }
    await snapshotRoundTwo(draw);

    await (await draw.drawPrizeShard(2, 0)).wait();
    await expect(draw.drawPrizeShard(2, 0)).to.be.revertedWith("Prize shard already drawn");

    const shardResult = await decryptPrizeShard(draw, 2n, 0);
    expect(shardResult.shard).to.be.lessThan(SHARD_COUNT);
    await (await draw.finalizePrizeShard(2, 0, shardResult.shard, shardResult.proof)).wait();
    await expect(draw.finalizePrizeShard(2, 0, shardResult.shard, shardResult.proof)).to.be.revertedWith(
      "Prize shard already finalized",
    );

    await (await draw.drawPrizeMember(2, 0)).wait();
    await expect(draw.drawPrizeMember(2, 0)).to.be.revertedWith("Prize member already drawn");

    const memberResult = await decryptPrizeMember(draw, 2n, 0);
    const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [memberResult.winner]);
    await (await draw.finalizePrizeMember(2, 0, encodedWinner, memberResult.proof)).wait();

    expect(memberResult.winner).to.not.equal(ethers.ZeroAddress);
    expect(await draw.seatShard(memberResult.winner)).to.equal(shardResult.shard);

    const status = await draw.getShardedPrizeStatus(2, 0);
    expect(status.shardDrawn).to.equal(true);
    expect(status.shardFinalized).to.equal(true);
    expect(status.winnerDrawn).to.equal(true);
    expect(status.winnerFinalized).to.equal(true);
    expect(status.winner).to.equal(memberResult.winner);
  });

  it("runs all three prize slots independently without requiring distinct winners", async function () {
    const draw = await deployDraw();
    for (const signer of Object.values(signers)) {
      await (await draw.acquire(signer.address)).wait();
      await (await draw.setWeight(signer.address, 100)).wait();
    }
    await snapshotRoundTwo(draw);

    const eligible = new Set(Object.values(signers).map((signer) => signer.address.toLowerCase()));
    const winners: string[] = [];

    for (let prizeIndex = 0; prizeIndex < 3; prizeIndex++) {
      const result = await runPrize(draw, 2n, prizeIndex);
      expect(result.shard).to.be.lessThan(SHARD_COUNT);
      expect(eligible.has(result.winner.toLowerCase())).to.equal(true);
      expect(await draw.seatShard(result.winner)).to.equal(result.shard);
      winners.push(result.winner);
    }

    expect(winners).to.have.length(3);
  });
});
