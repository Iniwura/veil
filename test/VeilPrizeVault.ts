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
  VeilYieldSource,
  VeilYieldSource__factory,
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

  const yieldFactory = (await ethers.getContractFactory("VeilYieldSource")) as VeilYieldSource__factory;
  const yieldSource = (await yieldFactory.deploy(tokenAddress)) as VeilYieldSource;
  const yieldSourceAddress = await yieldSource.getAddress();

  const vaultFactory = (await ethers.getContractFactory("VeilPrizeVault")) as VeilPrizeVault__factory;
  const prizeVault = (await vaultFactory.deploy(poolAddress, tokenAddress, yieldSourceAddress)) as VeilPrizeVault;
  const prizeVaultAddress = await prizeVault.getAddress();

  await (await yieldSource.configurePrizeVault(prizeVaultAddress)).wait();

  return { token, pool, poolAddress, yieldSource, yieldSourceAddress, prizeVault, prizeVaultAddress };
}

describe("VeilPrizeVault + VeilYieldSource", function () {
  let signers: Signers;
  let token: MockConfidentialToken;
  let pool: VeilPool;
  let poolAddress: string;
  let yieldSource: VeilYieldSource;
  let yieldSourceAddress: string;
  let prizeVault: VeilPrizeVault;
  let prizeVaultAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
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

    ({ token, pool, poolAddress, yieldSource, yieldSourceAddress, prizeVault, prizeVaultAddress } =
      await deployFixture());

    for (const signer of [signers.alice, signers.bob]) {
      await (await token.mint(signer.address, 1_000)).wait();
      await (await token.connect(signer).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
    }

    await (await token.mint(signers.deployer.address, 1_000)).wait();
    await (await token.connect(signers.deployer).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();

    await deposit(signers.alice, 10);
    await deposit(signers.bob, 30);
    await (await pool.snapshotRound()).wait();
    await (await pool.blindDraw(1)).wait();
  });

  async function encryptFor(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
    return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
  }

  async function deposit(signer: HardhatEthersSigner, amount: bigint | number) {
    const encrypted = await encryptFor(poolAddress, signer, amount);
    await (await pool.connect(signer).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function accrueYield(amount: bigint | number) {
    const encrypted = await encryptFor(yieldSourceAddress, signers.deployer, amount);
    await (await yieldSource.accrueYield(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function allocatePrize(amount: bigint | number, roundId = 1) {
    const encrypted = await encryptFor(yieldSourceAddress, signers.deployer, amount);
    await (await yieldSource.allocateToRound(roundId, encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function fundPrize(amount: bigint | number) {
    await accrueYield(amount);
    await allocatePrize(amount);
  }

  async function finalizeRound() {
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
    if (address === signers.alice.address) return signers.alice;
    if (address === signers.bob.address) return signers.bob;
    throw new Error(`Unexpected winner ${address}`);
  }

  function otherPlayer(address: string) {
    return address === signers.alice.address ? signers.bob : signers.alice;
  }

  async function decryptTokenBalance(signer: HardhatEthersSigner) {
    const encrypted = await token.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encrypted, await token.getAddress(), signer);
  }

  async function decryptPoolBalance(signer: HardhatEthersSigner) {
    const encrypted = await pool.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, encrypted, poolAddress, signer);
  }

  async function authorizeAndDecryptPrize(winnerAddress: string) {
    const winner = signerFor(winnerAddress);
    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();
    const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(1);
    const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);
    return { winner, clearPrize };
  }

  it("keeps principal, yield accounting, and prize custody physically separate", async function () {
    expect(await pool.asset()).to.equal(await token.getAddress());
    expect(await yieldSource.asset()).to.equal(await token.getAddress());
    expect(await prizeVault.asset()).to.equal(await token.getAddress());
    expect(await prizeVault.pool()).to.equal(poolAddress);
    expect(await prizeVault.yieldSource()).to.equal(yieldSourceAddress);
  });

  it("backs prize accounting with realized confidential assets without changing principal", async function () {
    const alicePrincipal = await decryptPoolBalance(signers.alice);
    const bobPrincipal = await decryptPoolBalance(signers.bob);

    await finalizeRound();
    await fundPrize(150);

    expect(await decryptPoolBalance(signers.alice)).to.equal(alicePrincipal);
    expect(await decryptPoolBalance(signers.bob)).to.equal(bobPrincipal);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(850);
  });

  it("rejects direct prize credits from accounts other than the yield source", async function () {
    const encrypted = await encryptFor(prizeVaultAddress, signers.outsider, 10);
    await expect(prizeVault.connect(signers.outsider).recordPrize(1, encrypted.handles[0])).to.be.revertedWith(
      "Only yield source",
    );
  });

  it("rejects prize allocation before the round winner is finalized without losing accrued yield", async function () {
    await accrueYield(150);
    await expect(allocatePrize(150)).to.be.rejectedWith("Winner not finalized");

    const statusBefore = await prizeVault.prizeStatus(1);
    expect(statusBefore.funded).to.equal(false);

    const winnerAddress = await finalizeRound();
    await allocatePrize(150);
    const { clearPrize } = await authorizeAndDecryptPrize(winnerAddress);
    expect(clearPrize).to.equal(150);
  });

  it("allows only the finalized winner to decrypt the encrypted prize", async function () {
    const winnerAddress = await finalizeRound();
    await fundPrize(150);
    const winner = signerFor(winnerAddress);
    const loser = otherPlayer(winnerAddress);

    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();

    const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(1);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner)).to.equal(150);
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, loser)).to.be.rejected;
  });

  it("pays confidential winnings without mutating the winner's principal", async function () {
    const winnerAddress = await finalizeRound();
    await fundPrize(150);
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
    const winnerAddress = await finalizeRound();
    await fundPrize(150);
    const loser = otherPlayer(winnerAddress);

    await (await prizeVault.connect(signers.outsider).authorizeWinner(1)).wait();
    await expect(prizeVault.connect(loser).claimPrize(1)).to.be.revertedWith("Not winner");
  });

  it("uses silent-zero semantics when requested yield exceeds real confidential assets", async function () {
    await accrueYield(2_000);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(1_000);

    const winnerAddress = await finalizeRound();
    await allocatePrize(2_000);
    const { clearPrize } = await authorizeAndDecryptPrize(winnerAddress);
    expect(clearPrize).to.equal(0);
  });

  it("does not clamp an oversized allocation to the remaining realized yield", async function () {
    await accrueYield(100);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(900);

    const winnerAddress = await finalizeRound();
    await allocatePrize(150);
    const { clearPrize } = await authorizeAndDecryptPrize(winnerAddress);

    expect(clearPrize).to.equal(0);
  });
});
