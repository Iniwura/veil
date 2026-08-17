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

async function deployFixture() {
  const tokenFactory = (await ethers.getContractFactory("MockConfidentialToken")) as MockConfidentialToken__factory;
  const token = (await tokenFactory.deploy()) as MockConfidentialToken;
  const tokenAddress = await token.getAddress();

  const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
  const veilPoolContract = (await poolFactory.deploy(tokenAddress)) as VeilPool;
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

  it("starts with zero players, the configured asset, and deployer ownership", async function () {
    expect(await veilPoolContract.playerCount()).to.equal(0);
    expect(await veilPoolContract.nextRoundId()).to.equal(1);
    expect(await veilPoolContract.owner()).to.equal(signers.deployer.address);
    expect(await veilPoolContract.asset()).to.equal(await token.getAddress());
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

  it("backs draw weight with the amount actually transferred by the asset", async function () {
    await deposit(signers.alice, 250);

    expect(await decryptOwnBalance(signers.alice)).to.equal(250);
    expect(await decryptTokenBalance(signers.alice)).to.equal(750);

    await deposit(signers.alice, 2_000);

    expect(await decryptOwnBalance(signers.alice)).to.equal(1_000);
    expect(await decryptTokenBalance(signers.alice)).to.equal(0);
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
    await (await veilPoolContract.snapshotRound()).wait();

    await withdraw(signers.alice, 40);

    expect(await decryptOwnBalance(signers.alice)).to.equal(60);
    expect(await decryptTokenBalance(signers.alice)).to.equal(940);
    expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(100);
  });

  it("caps an over-withdrawal at the user's confidential live principal", async function () {
    await deposit(signers.alice, 75);
    await withdraw(signers.alice, 500);

    expect(await decryptOwnBalance(signers.alice)).to.equal(0);
    expect(await decryptTokenBalance(signers.alice)).to.equal(1_000);
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

  it("enforces the maximum of 32 registered players", async function () {
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
    await expect(deposit(wallets[32], 1)).to.be.rejectedWith("Pool full");
  });

  describe("encrypted snapshots and BlindDraw", function () {
    beforeEach(async function () {
      await deposit(signers.alice, 10);
      await deposit(signers.bob, 30);
    });

    it("creates immutable encrypted snapshot weights while live balances keep moving", async function () {
      await (await veilPoolContract.snapshotRound()).wait();

      await deposit(signers.alice, 15);
      await withdraw(signers.bob, 10);

      expect(await decryptOwnBalance(signers.alice)).to.equal(25);
      expect(await decryptOwnBalance(signers.bob)).to.equal(20);
      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);
    });

    it("lets each participant decrypt only their own historical weight", async function () {
      await (await veilPoolContract.snapshotRound()).wait();

      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);
      expect(await decryptSnapshotWeight(signers.bob, 1)).to.equal(30);

      const bobWeight = await veilPoolContract.connect(signers.bob).encryptedSnapshotWeightOf(1);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, bobWeight, veilPoolContractAddress, signers.alice)).to.be
        .rejected;
    });

    it("runs BlindDraw once against the frozen asset-backed snapshot", async function () {
      await (await veilPoolContract.snapshotRound()).wait();
      await withdraw(signers.alice, 10);

      await (await veilPoolContract.blindDraw(1)).wait();

      const draw = await veilPoolContract.getDrawInfo(1);
      expect(draw.participantCount).to.equal(2);
      expect(draw.state).to.equal(2);
      expect(await decryptSnapshotWeight(signers.alice, 1)).to.equal(10);

      const encryptedWinner = await veilPoolContract.getEncryptedWinner(1);
      expect(encryptedWinner).to.not.equal(ethers.ZeroHash);
      await expect(veilPoolContract.blindDraw(1)).to.be.revertedWith("Round not ready");
    });

    it("retains owner controls and round validation", async function () {
      await expect(veilPoolContract.connect(signers.alice).snapshotRound()).to.be.revertedWith("Only owner");
      await expect(veilPoolContract.blindDraw(99)).to.be.revertedWith("Round not ready");

      await (await veilPoolContract.snapshotRound()).wait();

      expect(await veilPoolContract.getSnapshotPlayer(1, 0)).to.equal(signers.alice.address);
      expect(await veilPoolContract.getSnapshotPlayer(1, 1)).to.equal(signers.bob.address);
      await expect(veilPoolContract.getSnapshotPlayer(1, 2)).to.be.revertedWith("Invalid index");
    });
  });
});
