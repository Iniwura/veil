import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractTransactionResponse, HDNodeWallet, Wallet } from "ethers";
import { ethers, fhevm } from "hardhat";

import { VeilPool, VeilPool__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
  const veilPoolContract = (await factory.deploy()) as VeilPool;
  const veilPoolContractAddress = await veilPoolContract.getAddress();

  return { veilPoolContract, veilPoolContractAddress };
}

describe("VeilPool", function () {
  let signers: Signers;
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

    ({ veilPoolContract, veilPoolContractAddress } = await deployFixture());
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

  async function decryptOwnBalance(signer: HardhatEthersSigner) {
    const encryptedBalance = await veilPoolContract.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, veilPoolContractAddress, signer);
  }

  async function decryptSnapshotWeight(signer: HardhatEthersSigner, roundId: bigint | number) {
    const encryptedWeight = await veilPoolContract.connect(signer).encryptedSnapshotWeightOf(roundId);
    return fhevm.userDecryptEuint(FhevmType.euint64, encryptedWeight, veilPoolContractAddress, signer);
  }

  it("starts with zero players", async function () {
    expect(await veilPoolContract.playerCount()).to.equal(0);
    expect(await veilPoolContract.nextRoundId()).to.equal(1);
  });

  it("registers Alice on her first encrypted deposit", async function () {
    await deposit(signers.alice, 11);

    expect(await veilPoolContract.playerCount()).to.equal(1);
    expect(await veilPoolContract.joined(signers.alice.address)).to.equal(true);
    expect(await veilPoolContract.getPlayer(0)).to.equal(signers.alice.address);
  });

  it("allows Alice to decrypt her own encrypted balance", async function () {
    await deposit(signers.alice, 37);

    expect(await decryptOwnBalance(signers.alice)).to.equal(37);
  });

  it("keeps different Alice and Bob deposits separate and confidential", async function () {
    await deposit(signers.alice, 17);
    await deposit(signers.bob, 29);

    const aliceEncryptedBalance = await veilPoolContract.connect(signers.alice).encryptedBalanceOf();
    const bobEncryptedBalance = await veilPoolContract.connect(signers.bob).encryptedBalanceOf();

    expect(
      await fhevm.userDecryptEuint(FhevmType.euint64, aliceEncryptedBalance, veilPoolContractAddress, signers.alice),
    ).to.equal(17);
    expect(
      await fhevm.userDecryptEuint(FhevmType.euint64, bobEncryptedBalance, veilPoolContractAddress, signers.bob),
    ).to.equal(29);

    await expect(fhevm.userDecryptEuint(FhevmType.euint64, bobEncryptedBalance, veilPoolContractAddress, signers.alice))
      .to.be.rejected;
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, aliceEncryptedBalance, veilPoolContractAddress, signers.bob))
      .to.be.rejected;
  });

  it("accumulates repeated deposits without increasing playerCount", async function () {
    await deposit(signers.alice, 5);
    await deposit(signers.alice, 8);
    await deposit(signers.alice, 13);

    expect(await decryptOwnBalance(signers.alice)).to.equal(26);
    expect(await veilPoolContract.playerCount()).to.equal(1);
    expect(await veilPoolContract.getPlayer(0)).to.equal(signers.alice.address);
  });

  it("returns participant addresses in registration order", async function () {
    await deposit(signers.bob, 3);
    await deposit(signers.alice, 7);

    expect(await veilPoolContract.getPlayer(0)).to.equal(signers.bob.address);
    expect(await veilPoolContract.getPlayer(1)).to.equal(signers.alice.address);
  });

  it("enforces the maximum of 32 players", async function () {
    const wallets = Array.from({ length: 33 }, () => Wallet.createRandom().connect(ethers.provider));

    for (const wallet of wallets) {
      await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
    }
    for (const wallet of wallets.slice(0, 32)) {
      await deposit(wallet, 1);
    }

    expect(await veilPoolContract.playerCount()).to.equal(32);
    await expect(deposit(wallets[32], 1)).to.be.rejectedWith("Pool full");
    expect(await veilPoolContract.playerCount()).to.equal(32);
    expect(await veilPoolContract.joined(wallets[32].address)).to.equal(false);
  });

  it("reverts for invalid player indexes", async function () {
    await expect(veilPoolContract.getPlayer(0)).to.be.revertedWith("Invalid index");

    await deposit(signers.alice, 1);
    await expect(veilPoolContract.getPlayer(1)).to.be.revertedWith("Invalid index");
  });

  it("rejects encryptedBalanceOf calls from non-participants", async function () {
    await deposit(signers.alice, 9);

    await expect(veilPoolContract.connect(signers.outsider).encryptedBalanceOf()).to.be.revertedWith("Not joined");
  });

  describe("encrypted draw snapshots", function () {
    beforeEach(async function () {
      await deposit(signers.alice, 10);
      await deposit(signers.bob, 30);
    });

    it("requires at least two participants before snapshotting", async function () {
      const fresh = await deployFixture();
      await expect(fresh.veilPoolContract.snapshotRound()).to.be.revertedWith("Need 2 players");
    });

    it("creates round metadata and preserves participant order", async function () {
      const tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      expect(await veilPoolContract.nextRoundId()).to.equal(2);

      const draw = await veilPoolContract.getDrawInfo(1);
      expect(draw.participantCount).to.equal(2);
      expect(draw.state).to.equal(1);
      expect(draw.snapshotBlock).to.be.greaterThan(0);

      expect(await veilPoolContract.getSnapshotPlayer(1, 0)).to.equal(signers.alice.address);
      expect(await veilPoolContract.getSnapshotPlayer(1, 1)).to.equal(signers.bob.address);
    });

    it("lets each participant decrypt only their own snapshot weight", async function () {
      const tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);

      const bobWeight = await veilPoolContract.connect(signers.bob).encryptedSnapshotWeightOf(1);
      await expect(
        fhevm.userDecryptEuint(FhevmType.euint64, bobWeight, veilPoolContractAddress, signers.alice),
      ).to.be.rejected;
    });

    it("keeps a round snapshot immutable while the live position continues changing", async function () {
      let tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      await deposit(signers.alice, 15);

      expect(await decryptOwnBalance(signers.alice)).to.equal(25);
      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);

      tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      expect(await decryptSnapshotWeight(signers.alice, 2)).to.equal(25);
      expect(await decryptSnapshotWeight(signers.bob, 2)).to.equal(30);
    });

    it("does not retroactively add a new live participant to an older round", async function () {
      let tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      await deposit(signers.outsider, 50);

      await expect(veilPoolContract.connect(signers.outsider).encryptedSnapshotWeightOf(1)).to.be.revertedWith(
        "Not in round",
      );

      const firstDraw = await veilPoolContract.getDrawInfo(1);
      expect(firstDraw.participantCount).to.equal(2);

      tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      const secondDraw = await veilPoolContract.getDrawInfo(2);
      expect(secondDraw.participantCount).to.equal(3);
      expect(await decryptSnapshotWeight(signers.outsider, 2)).to.equal(50);
      expect(await veilPoolContract.getSnapshotPlayer(2, 2)).to.equal(signers.outsider.address);
    });

    it("rejects unknown rounds and invalid snapshot indexes", async function () {
      await expect(veilPoolContract.getDrawInfo(1)).to.be.revertedWith("Unknown round");

      const tx = await veilPoolContract.snapshotRound();
      await tx.wait();

      await expect(veilPoolContract.getSnapshotPlayer(1, 2)).to.be.revertedWith("Invalid index");
      await expect(veilPoolContract.getSnapshotPlayer(99, 0)).to.be.revertedWith("Unknown round");
    });
  });
});
