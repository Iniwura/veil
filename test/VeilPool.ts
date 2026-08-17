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

  it("starts with zero players", async function () {
    expect(await veilPoolContract.playerCount()).to.equal(0);
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
});
