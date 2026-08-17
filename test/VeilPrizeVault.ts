import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import {
  MockConfidentialToken,
  MockConfidentialToken__factory,
  VeilPool,
  VeilPool__factory,
  VeilPrizeVault,
  VeilPrizeVault__factory,
} from "../types";

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
  const pool = (await poolFactory.deploy(tokenAddress)) as VeilPool;
  const poolAddress = await pool.getAddress();

  const prizeFactory = (await ethers.getContractFactory("VeilPrizeVault")) as VeilPrizeVault__factory;
  const prizeVault = (await prizeFactory.deploy(poolAddress, tokenAddress)) as VeilPrizeVault;
  const prizeVaultAddress = await prizeVault.getAddress();

  return { token, tokenAddress, pool, poolAddress, prizeVault, prizeVaultAddress };
}

describe("VeilPrizeVault", function () {
  let signers: Signers;
  let token: MockConfidentialToken;
  let pool: VeilPool;
  let poolAddress: string;
  let prizeVault: VeilPrizeVault;
  let prizeVaultAddress: string;

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

    ({ token, pool, poolAddress, prizeVault, prizeVaultAddress } = await deployFixture());

    for (const signer of [signers.alice, signers.bob]) {
      await (await token.mint(signer.address, 1_000)).wait();
      await (await token.connect(signer).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
    }

    await (await token.mint(signers.deployer.address, 1_000)).wait();
    await (await token.connect(signers.deployer).setOperator(prizeVaultAddress, MAX_OPERATOR_UNTIL)).wait();
  });

  async function deposit(signer: HardhatEthersSigner, amount: number) {
    const encrypted = await fhevm.createEncryptedInput(poolAddress, signer.address).add64(amount).encrypt();
    await (await pool.connect(signer).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function fundPrize(amount: number) {
    const encrypted = await fhevm
      .createEncryptedInput(prizeVaultAddress, signers.deployer.address)
      .add64(amount)
      .encrypt();
    await (await prizeVault.fundPrize(1, encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function decryptTokenBalance(signer: HardhatEthersSigner) {
    const encrypted = await token.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encrypted, await token.getAddress(), signer);
  }

  async function decryptPoolBalance(signer: HardhatEthersSigner) {
    const encrypted = await pool.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, encrypted, poolAddress, signer);
  }

  async function finalizeRound() {
    await deposit(signers.alice, 10);
    await deposit(signers.bob, 30);
    await (await pool.snapshotRound()).wait();
    await (await pool.blindDraw(1)).wait();

    const encryptedWinner = await pool.getEncryptedWinner(1);
    const publicDecryptResults = await fhevm.publicDecrypt([encryptedWinner]);

    await (
      await pool
        .connect(signers.outsider)
        .finalizeWinner(1, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof)
    ).wait();

    return pool.getWinner(1);
  }

  function signerFor(address: string) {
    if (address.toLowerCase() === signers.alice.address.toLowerCase()) return signers.alice;
    if (address.toLowerCase() === signers.bob.address.toLowerCase()) return signers.bob;
    throw new Error(`Unexpected winner ${address}`);
  }

  function otherPlayer(winner: string) {
    return winner.toLowerCase() === signers.alice.address.toLowerCase() ? signers.bob : signers.alice;
  }

  it("keeps prize custody configured separately from pool custody", async function () {
    expect(await prizeVault.owner()).to.equal(signers.deployer.address);
    expect(await prizeVault.pool()).to.equal(poolAddress);
    expect(await prizeVault.asset()).to.equal(await token.getAddress());
  });

  it("funds a prize with actual confidential assets without changing principal weights", async function () {
    await deposit(signers.alice, 40);
    await fundPrize(250);

    expect(await decryptPoolBalance(signers.alice)).to.equal(40);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(750);

    const status = await prizeVault.prizeStatus(1);
    expect(status.funded).to.equal(true);
    expect(status.winnerAuthorized).to.equal(false);
    expect(status.claimed).to.equal(false);
  });

  it("does not expose the prize before the pool has a finalized winner", async function () {
    await fundPrize(150);
    await deposit(signers.alice, 10);
    await deposit(signers.bob, 30);
    await (await pool.snapshotRound()).wait();
    await (await pool.blindDraw(1)).wait();

    await expect(prizeVault.connect(signers.outsider).authorizeWinner(1)).to.be.revertedWith("Winner not finalized");
  });

  it("allows only the finalized winner to decrypt the encrypted prize", async function () {
    await fundPrize(150);
    const winnerAddress = await finalizeRound();
    const winner = signerFor(winnerAddress);
    const loser = otherPlayer(winnerAddress);

    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();

    const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(1);
    const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);

    expect(clearPrize).to.equal(150);
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, loser)).to.be.rejected;
    await expect(prizeVault.connect(loser).encryptedPrizeOf(1)).to.be.revertedWith("Not winner");
  });

  it("pays the confidential prize without mutating the winner's principal", async function () {
    await fundPrize(150);
    const winnerAddress = await finalizeRound();
    const winner = signerFor(winnerAddress);

    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();

    const tokenBefore = await decryptTokenBalance(winner);
    const principalBefore = await decryptPoolBalance(winner);

    await (await prizeVault.connect(winner).claimPrize(1)).wait();

    expect(await decryptTokenBalance(winner)).to.equal(tokenBefore + 150n);
    expect(await decryptPoolBalance(winner)).to.equal(principalBefore);

    const status = await prizeVault.prizeStatus(1);
    expect(status.claimed).to.equal(true);
    expect(status.winner).to.equal(winnerAddress);
    await expect(prizeVault.connect(winner).claimPrize(1)).to.be.revertedWith("Prize already claimed");
  });

  it("prevents a losing participant from claiming the prize", async function () {
    await fundPrize(150);
    const winnerAddress = await finalizeRound();
    const loser = otherPlayer(winnerAddress);

    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();
    await expect(prizeVault.connect(loser).claimPrize(1)).to.be.revertedWith("Not winner");
  });

  it("clips prize funding to the funder's real confidential token balance", async function () {
    await fundPrize(2_000);

    expect(await decryptTokenBalance(signers.deployer)).to.equal(0);
    expect((await prizeVault.prizeStatus(1)).funded).to.equal(true);
  });
});
