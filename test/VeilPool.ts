import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractTransactionResponse, HDNodeWallet, Wallet } from "ethers";
import { ethers, fhevm } from "hardhat";

import { MockConfidentialToken, MockConfidentialToken__factory, VeilPool, VeilPool__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const TEST_DRAW_PERIOD = 60 * 60;

async function deployFixture() {
  const tokenFactory = (await ethers.getContractFactory("MockConfidentialToken")) as MockConfidentialToken__factory;
  const token = (await tokenFactory.deploy()) as MockConfidentialToken;
  const tokenAddress = await token.getAddress();

  const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
  const veilPoolContract = (await poolFactory.deploy(tokenAddress, TEST_DRAW_PERIOD)) as VeilPool;
  const veilPoolContractAddress = await veilPoolContract.getAddress();

  return { token, tokenAddress, veilPoolContract, veilPoolContractAddress };
}

describe("VeilPool", function () {
  let signers: Signers;
  let token: MockConfidentialToken;
  let veilPoolContract: VeilPool;
  let veilPoolContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      outsider: ethSigners[3],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This hardhat test suite cannot run on Sepolia Testnet");
      this.skip();
    }

    ({ token, veilPoolContract, veilPoolContractAddress } = await deployFixture());

    for (const signer of [signers.alice, signers.bob, signers.outsider]) {
      await (await token.mint(signer.address, 1_000)).wait();
      await (await token.connect(signer).setOperator(veilPoolContractAddress, MAX_OPERATOR_UNTIL)).wait();
    }
  });

  async function deposit(signer: HardhatEthersSigner | HDNodeWallet, amount: bigint | number) {
    const encryptedAmount = await fhevm
      .createEncryptedInput(veilPoolContractAddress, signer.address)
      .add64(amount)
      .encrypt();

    const tx: ContractTransactionResponse = await veilPoolContract
      .connect(signer)
      .deposit(encryptedAmount.handles[0], encryptedAmount.inputProof);
    await tx.wait();
  }

  async function withdraw(signer: HardhatEthersSigner, amount: bigint | number) {
    const encryptedAmount = await fhevm
      .createEncryptedInput(veilPoolContractAddress, signer.address)
      .add64(amount)
      .encrypt();

    await (
      await veilPoolContract.connect(signer).withdraw(encryptedAmount.handles[0], encryptedAmount.inputProof)
    ).wait();
  }

  async function decryptOwnBalance(signer: HardhatEthersSigner) {
    const encryptedBalance = await veilPoolContract.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, veilPoolContractAddress, signer);
  }

  async function decryptTokenBalance(signer: HardhatEthersSigner) {
    const encryptedBalance = await token.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, await token.getAddress(), signer);
  }

  async function decryptSnapshotWeight(signer: HardhatEthersSigner, roundId: bigint | number) {
    const encryptedWeight = await veilPoolContract.connect(signer).encryptedSnapshotWeightOf(roundId);
    return fhevm.userDecryptEuint(FhevmType.euint64, encryptedWeight, veilPoolContractAddress, signer);
  }

  async function advanceToDrawClose() {
    const closesAt = Number(await veilPoolContract.nextDrawClosesAt());
    const latest = await ethers.provider.getBlock("latest");
    if (!latest) throw new Error("Latest block unavailable");
    const delta = closesAt - latest.timestamp;
    if (delta > 0) await ethers.provider.send("evm_increaseTime", [delta]);
    await ethers.provider.send("evm_mine", []);
  }

  async function mineAt(timestamp: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await ethers.provider.send("evm_mine", []);
  }

  it("starts with zero players, the configured asset, and an open scheduled round", async function () {
    expect(await veilPoolContract.playerCount()).to.equal(0);
    expect(await veilPoolContract.nextRoundId()).to.equal(1);
    expect(await veilPoolContract.unsettledRoundCount()).to.equal(0);
    expect(await veilPoolContract.owner()).to.equal(signers.deployer.address);
    expect(await veilPoolContract.asset()).to.equal(await token.getAddress());
    expect(await veilPoolContract.drawPeriod()).to.equal(TEST_DRAW_PERIOD);
    expect(await veilPoolContract.firstDrawOpensAt()).to.equal(await veilPoolContract.nextDrawOpensAt());
    const schedule = await veilPoolContract.getDrawSchedule();
    expect(schedule.currentRoundId).to.equal(1);
    expect(schedule.unsettledRounds).to.equal(0);
    expect(schedule.opensAt).to.be.greaterThan(0);
    expect(schedule.closesAt - schedule.opensAt).to.equal(BigInt(TEST_DRAW_PERIOD));
    expect(schedule.timeReady).to.equal(false);
    expect(schedule.ready).to.equal(false);
    expect(schedule.canAdvance).to.equal(false);
    expect(schedule.insufficientParticipants).to.equal(false);
    expect(schedule.overdue).to.equal(false);
    expect(await veilPoolContract.isDrawReady()).to.equal(false);
  });

  it("rejects a zero draw period", async function () {
    const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
    await expect(poolFactory.deploy(await token.getAddress(), 0)).to.be.revertedWith("Invalid draw period");
  });

  it("separates timer readiness from insufficient close-time participation", async function () {
    await deposit(signers.alice, 10);
    await advanceToDrawClose();

    expect(await veilPoolContract.isDrawTimeReady()).to.equal(true);
    expect(await veilPoolContract.isDrawReady()).to.equal(false);
    expect(await veilPoolContract.canAdvanceDraw()).to.equal(true);
    expect(await veilPoolContract.getDrawAvailability()).to.equal(2);
    const schedule = await veilPoolContract.getDrawSchedule();
    expect(schedule.canAdvance).to.equal(true);
    expect(schedule.insufficientParticipants).to.equal(true);
    await expect(veilPoolContract.snapshotRound()).to.be.revertedWith("Need 2 players");
    await (await veilPoolContract.connect(signers.outsider).cancelInsufficientRound()).wait();
    expect((await veilPoolContract.getDrawInfo(1)).state).to.equal(4);
    expect(await veilPoolContract.nextRoundId()).to.equal(2);
  });

  it("requires the pool to be an authorized confidential-token operator", async function () {
    const fresh = await deployFixture();
    await (await fresh.token.mint(signers.alice.address, 100)).wait();

    const encryptedAmount = await fhevm
      .createEncryptedInput(fresh.veilPoolContractAddress, signers.alice.address)
      .add64(10)
      .encrypt();

    await expect(
      fresh.veilPoolContract.connect(signers.alice).deposit(encryptedAmount.handles[0], encryptedAmount.inputProof),
    ).to.be.revertedWith("Pool not operator");
  });

  it("uses ERC-7984 silent-zero semantics when a deposit exceeds the confidential token balance", async function () {
    await deposit(signers.alice, 250);

    expect(await decryptOwnBalance(signers.alice)).to.equal(250);
    expect(await decryptTokenBalance(signers.alice)).to.equal(750);

    await deposit(signers.alice, 2_000);

    expect(await decryptOwnBalance(signers.alice)).to.equal(250);
    expect(await decryptTokenBalance(signers.alice)).to.equal(750);
    expect(await veilPoolContract.playerCount()).to.equal(1);
  });

  it("keeps different Alice and Bob positions separate and confidential", async function () {
    await deposit(signers.alice, 17);
    await deposit(signers.bob, 29);

    expect(await decryptOwnBalance(signers.alice)).to.equal(17);
    expect(await decryptOwnBalance(signers.bob)).to.equal(29);

    const bobEncryptedBalance = await veilPoolContract.connect(signers.bob).encryptedBalanceOf();
    const aliceEncryptedBalance = await veilPoolContract.connect(signers.alice).encryptedBalanceOf();

    await expect(fhevm.userDecryptEuint(FhevmType.euint64, bobEncryptedBalance, veilPoolContractAddress, signers.alice))
      .to.be.rejected;
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, aliceEncryptedBalance, veilPoolContractAddress, signers.bob))
      .to.be.rejected;
  });

  it("withdraws principal confidentially without changing old snapshots", async function () {
    await deposit(signers.alice, 100);
    await deposit(signers.bob, 100);
    await advanceToDrawClose();
    await (await veilPoolContract.snapshotRound()).wait();

    await withdraw(signers.alice, 40);

    expect(await decryptOwnBalance(signers.alice)).to.equal(60);
    expect(await decryptTokenBalance(signers.alice)).to.equal(940);
    expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(100);
  });

  it("silently transfers zero when a withdrawal request exceeds the confidential live principal", async function () {
    await deposit(signers.alice, 75);
    await withdraw(signers.alice, 500);

    expect(await decryptOwnBalance(signers.alice)).to.equal(75);
    expect(await decryptTokenBalance(signers.alice)).to.equal(925);
  });

  it("keeps a zero position at zero when a positive withdrawal is requested", async function () {
    await deposit(signers.alice, 1);
    await withdraw(signers.alice, 1);
    expect(await decryptOwnBalance(signers.alice)).to.equal(0);

    await withdraw(signers.alice, 1);
    expect(await decryptOwnBalance(signers.alice)).to.equal(0);
    expect(await decryptTokenBalance(signers.alice)).to.equal(1_000);
  });

  it("preserves ACLs across deposit, withdraw, deposit, and reveal cycles", async function () {
    await deposit(signers.alice, 20);
    await withdraw(signers.alice, 5);
    await deposit(signers.alice, 7);
    await withdraw(signers.alice, 3);

    expect(await decryptOwnBalance(signers.alice)).to.equal(19);
    expect(await decryptTokenBalance(signers.alice)).to.equal(981);
  });

  it("rejects withdrawals from non-participants", async function () {
    const encryptedAmount = await fhevm
      .createEncryptedInput(veilPoolContractAddress, signers.outsider.address)
      .add64(10)
      .encrypt();

    await expect(
      veilPoolContract.connect(signers.outsider).withdraw(encryptedAmount.handles[0], encryptedAmount.inputProof),
    ).to.be.revertedWith("Not joined");
  });

  it("accumulates repeated deposits without increasing playerCount", async function () {
    await deposit(signers.alice, 5);
    await deposit(signers.alice, 8);
    await deposit(signers.alice, 13);

    expect(await decryptOwnBalance(signers.alice)).to.equal(26);
    expect(await veilPoolContract.playerCount()).to.equal(1);
  });

  it("enforces the maximum of 32 active draw seats", async function () {
    const wallets = Array.from({ length: 33 }, () => Wallet.createRandom().connect(ethers.provider));

    for (const wallet of wallets) {
      await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
      await (await token.mint(wallet.address, 1)).wait();
      await (await token.connect(wallet).setOperator(veilPoolContractAddress, MAX_OPERATOR_UNTIL)).wait();
    }

    for (const wallet of wallets.slice(0, 32)) {
      await deposit(wallet, 1);
    }

    expect(await veilPoolContract.playerCount()).to.equal(32);
    await expect(deposit(wallets[32], 1)).to.be.rejectedWith("Draw roster full");
  });

  describe("encrypted snapshots and BlindDraw", function () {
    beforeEach(async function () {
      await deposit(signers.alice, 10);
      await deposit(signers.bob, 30);
    });

    it("creates immutable encrypted snapshot weights while live balances keep moving", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.snapshotRound()).wait();

      await deposit(signers.alice, 15);
      await withdraw(signers.bob, 10);

      expect(await decryptOwnBalance(signers.alice)).to.equal(25);
      expect(await decryptOwnBalance(signers.bob)).to.equal(20);
      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
    });

    it("does not let a post-close deposit increase the closed draw", async function () {
      await advanceToDrawClose();
      await deposit(signers.alice, 15);

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
    });

    it("does not let a post-close withdrawal decrease the closed draw", async function () {
      await advanceToDrawClose();
      await withdraw(signers.alice, 7);

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
      expect(await decryptOwnBalance(signers.alice)).to.equal(3);
    });

    it("does not add a user who joins after close to that closed draw", async function () {
      await advanceToDrawClose();
      await deposit(signers.outsider, 50);

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      const draw = await veilPoolContract.getDrawInfo(1);
      expect(draw.participantCount).to.equal(2);
      await expect(veilPoolContract.connect(signers.outsider).encryptedSnapshotWeightOf(1)).to.be.revertedWith(
        "Not in round",
      );
    });

    it("keeps a user who leaves after close eligible in the closed draw", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.alice).leaveDrawSeat()).wait();

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
    });

    it("preserves close-time weights when the permissionless snapshot is late", async function () {
      const closesAt = Number(await veilPoolContract.nextDrawClosesAt());
      await mineAt(closesAt + 20 * 60);
      await deposit(signers.alice, 15);
      await withdraw(signers.bob, 10);

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
      expect(await decryptOwnBalance(signers.alice)).to.equal(25);
      expect(await decryptOwnBalance(signers.bob)).to.equal(20);
    });

    it("applies post-close activity to the next eligible scheduled round", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      await deposit(signers.outsider, 50);

      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      const draw = await veilPoolContract.getDrawInfo(2);
      expect(draw.participantCount).to.equal(3);
      expect(await decryptSnapshotWeight(signers.outsider, 2)).to.equal(50);
    });

    it("lets each participant decrypt only their own historical weight", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);

      const bobWeight = await veilPoolContract.connect(signers.bob).encryptedSnapshotWeightOf(1);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, bobWeight, veilPoolContractAddress, signers.alice)).to.be
        .rejected;
    });

    it("runs BlindDraw once against the frozen asset-backed snapshot", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      await withdraw(signers.alice, 10);

      await (await veilPoolContract.connect(signers.alice).blindDraw(1)).wait();

      const draw = await veilPoolContract.getDrawInfo(1);
      expect(draw.participantCount).to.equal(2);
      expect(draw.state).to.equal(2);
      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);

      const encryptedWinner = await veilPoolContract.getEncryptedWinner(1);
      expect(encryptedWinner).to.not.equal(ethers.ZeroHash);
      await expect(veilPoolContract.blindDraw(1)).to.be.revertedWith("Round not ready");
    });

    it("permissionlessly finalizes only the KMS-proven public winner", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      await (await veilPoolContract.connect(signers.alice).blindDraw(1)).wait();

      const encryptedWinner = await veilPoolContract.getEncryptedWinner(1);
      const publicDecryptResults = await fhevm.publicDecrypt([encryptedWinner]);

      await (
        await veilPoolContract
          .connect(signers.outsider)
          .finalizeWinner(1, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof)
      ).wait();

      const winner = await veilPoolContract.getWinner(1);
      expect([signers.alice.address, signers.bob.address]).to.include(winner);

      const draw = await veilPoolContract.getDrawInfo(1);
      expect(draw.state).to.equal(3);
      expect(await veilPoolContract.unsettledRoundCount()).to.equal(0);
      expect(await veilPoolContract.nextRoundId()).to.equal(2);
      await expect(veilPoolContract.snapshotRound()).to.be.revertedWith("Draw still open");
      await expect(
        veilPoolContract
          .connect(signers.alice)
          .finalizeWinner(1, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof),
      ).to.be.revertedWith("Round not awaiting finalization");
    });

    it("rejects an invalid winner decryption proof", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.snapshotRound()).wait();
      await (await veilPoolContract.blindDraw(1)).wait();

      const encryptedWinner = await veilPoolContract.getEncryptedWinner(1);
      const publicDecryptResults = await fhevm.publicDecrypt([encryptedWinner]);

      await expect(
        veilPoolContract
          .connect(signers.outsider)
          .finalizeWinner(1, publicDecryptResults.abiEncodedClearValues, `${publicDecryptResults.decryptionProof}dead`),
      ).to.be.reverted;

      expect((await veilPoolContract.getDrawInfo(1)).state).to.equal(2);
      expect(await veilPoolContract.unsettledRoundCount()).to.equal(1);
    });

    it("enforces the timer, per-round state, and permissionless callers", async function () {
      await expect(veilPoolContract.connect(signers.alice).snapshotRound()).to.be.revertedWith("Draw still open");
      await expect(veilPoolContract.blindDraw(99)).to.be.revertedWith("Round not ready");

      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      expect(await veilPoolContract.unsettledRoundCount()).to.equal(1);
      await expect(veilPoolContract.snapshotRound()).to.be.revertedWith("Draw still open");
      expect(await veilPoolContract.getSnapshotPlayer(1, 0)).to.equal(signers.alice.address);
      expect(await veilPoolContract.getSnapshotPlayer(1, 1)).to.equal(signers.bob.address);
      await expect(veilPoolContract.getSnapshotPlayer(1, 2)).to.be.revertedWith("Invalid index");
      await expect(veilPoolContract.getWinner(1)).to.be.revertedWith("Winner not finalized");

      await (await veilPoolContract.connect(signers.alice).blindDraw(1)).wait();
      expect((await veilPoolContract.getDrawInfo(1)).state).to.equal(2);
    });

    it("rejects one second before the deadline and snapshots exactly at the deadline", async function () {
      const closesAt = Number(await veilPoolContract.nextDrawClosesAt());
      await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt - 1]);

      expect(await veilPoolContract.isDrawReady()).to.equal(false);
      await expect(veilPoolContract.connect(signers.outsider).snapshotRound()).to.be.revertedWith("Draw still open");

      await ethers.provider.send("evm_setNextBlockTimestamp", [closesAt]);
      const snapshotReceipt = await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      if (!snapshotReceipt) throw new Error("Snapshot receipt unavailable");
      const snapshotBlock = await ethers.provider.getBlock(snapshotReceipt.blockNumber);
      if (!snapshotBlock) throw new Error("Snapshot block unavailable");
      expect(snapshotBlock.timestamp).to.equal(closesAt);
      expect(await veilPoolContract.unsettledRoundCount()).to.equal(1);
    });

    it("does not allow a duplicate snapshot or BlindDraw", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();

      await expect(veilPoolContract.connect(signers.alice).snapshotRound()).to.be.revertedWith("Draw still open");

      await (await veilPoolContract.connect(signers.outsider).blindDraw(1)).wait();
      await expect(veilPoolContract.connect(signers.bob).blindDraw(1)).to.be.revertedWith("Round not ready");
    });

    it("keeps the next scheduled window fixed when finalization is delayed", async function () {
      await advanceToDrawClose();
      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      await (await veilPoolContract.connect(signers.alice).blindDraw(1)).wait();

      const firstDrawSchedule = await veilPoolContract.getDrawSchedule();
      expect(firstDrawSchedule.currentRoundId).to.equal(2);
      expect(firstDrawSchedule.unsettledRounds).to.equal(1);
      expect(firstDrawSchedule.overdue).to.equal(false);

      const firstDrawOpensAt = await veilPoolContract.firstDrawOpensAt();
      const expectedRoundTwoOpensAt = firstDrawOpensAt + BigInt(TEST_DRAW_PERIOD);
      const expectedRoundTwoClosesAt = expectedRoundTwoOpensAt + BigInt(TEST_DRAW_PERIOD);
      expect(firstDrawSchedule.opensAt).to.equal(expectedRoundTwoOpensAt);
      expect(firstDrawSchedule.closesAt).to.equal(expectedRoundTwoClosesAt);

      await mineAt(Number(expectedRoundTwoClosesAt) + 20 * 60);
      expect(await veilPoolContract.isDrawTimeReady()).to.equal(true);
      expect(await veilPoolContract.isDrawReady()).to.equal(true);
      expect(await veilPoolContract.isDrawOverdue()).to.equal(true);
      expect((await veilPoolContract.getDrawSchedule()).overdue).to.equal(true);

      await (await veilPoolContract.connect(signers.outsider).snapshotRound()).wait();
      expect(await veilPoolContract.unsettledRoundCount()).to.equal(2);
      expect((await veilPoolContract.getDrawInfo(2)).state).to.equal(1);
      await (await veilPoolContract.connect(signers.alice).blindDraw(2)).wait();

      const roundOneWinner = await veilPoolContract.getEncryptedWinner(1);
      const roundOneProof = await fhevm.publicDecrypt([roundOneWinner]);
      await expect(
        veilPoolContract
          .connect(signers.outsider)
          .finalizeWinner(1, roundOneProof.abiEncodedClearValues, `${roundOneProof.decryptionProof}dead`),
      ).to.be.reverted;
      expect((await veilPoolContract.getDrawInfo(1)).state).to.equal(2);
      expect((await veilPoolContract.getDrawInfo(2)).state).to.equal(2);

      const schedule = await veilPoolContract.getDrawSchedule();
      expect(schedule.currentRoundId).to.equal(3);
      const expectedRoundThreeOpensAt = firstDrawOpensAt + 2n * BigInt(TEST_DRAW_PERIOD);
      const expectedRoundThreeClosesAt = expectedRoundThreeOpensAt + BigInt(TEST_DRAW_PERIOD);
      expect(schedule.opensAt).to.equal(expectedRoundThreeOpensAt);
      expect(schedule.closesAt).to.equal(expectedRoundThreeClosesAt);
      expect(schedule.unsettledRounds).to.equal(2);
      expect(schedule.overdue).to.equal(false);

      const nextSchedule = await veilPoolContract.getDrawSchedule();
      expect(nextSchedule.currentRoundId).to.equal(3);
      expect(nextSchedule.opensAt).to.equal(firstDrawOpensAt + 2n * BigInt(TEST_DRAW_PERIOD));
      expect(nextSchedule.closesAt).to.equal(firstDrawOpensAt + 3n * BigInt(TEST_DRAW_PERIOD));

      const publicDecryptResults = roundOneProof;
      const finalizeTx = await veilPoolContract
        .connect(signers.outsider)
        .finalizeWinner(1, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof);
      const finalizeReceipt = await finalizeTx.wait();
      if (!finalizeReceipt) throw new Error("Finalization receipt unavailable");
      const finalizeBlock = await ethers.provider.getBlock(finalizeReceipt.blockNumber);
      if (!finalizeBlock) throw new Error("Finalization block unavailable");

      const afterFinalize = await veilPoolContract.getDrawSchedule();
      expect(afterFinalize.currentRoundId).to.equal(3);
      expect(afterFinalize.opensAt).to.equal(nextSchedule.opensAt);
      expect(afterFinalize.closesAt).to.equal(nextSchedule.closesAt);
      expect(afterFinalize.unsettledRounds).to.equal(1);
      expect(afterFinalize.opensAt).to.not.equal(BigInt(finalizeBlock.timestamp));
      expect(await decryptSnapshotWeight(signers.alice, 2)).to.equal(10);
    });
  });
});
