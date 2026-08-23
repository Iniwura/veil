import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
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
const DRAW_PERIOD = 3_600n;

async function deployFixture(deployer: HardhatEthersSigner) {
  const tokenFactory = (await ethers.getContractFactory("MockConfidentialToken")) as MockConfidentialToken__factory;
  const token = (await tokenFactory.deploy()) as MockConfidentialToken;
  const tokenAddress = await token.getAddress();

  const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
  const pool = (await poolFactory.deploy(tokenAddress, DRAW_PERIOD)) as VeilPool;
  const poolAddress = await pool.getAddress();

  const yieldFactory = (await ethers.getContractFactory("VeilYieldSource")) as VeilYieldSource__factory;
  const yieldSource = (await yieldFactory.deploy(tokenAddress, poolAddress, deployer.address)) as VeilYieldSource;
  const yieldSourceAddress = await yieldSource.getAddress();

  const vaultFactory = (await ethers.getContractFactory("VeilPrizeVault")) as VeilPrizeVault__factory;
  const prizeVault = (await vaultFactory.deploy(poolAddress, tokenAddress, yieldSourceAddress)) as VeilPrizeVault;
  const prizeVaultAddress = await prizeVault.getAddress();

  await (await yieldSource.connect(deployer).configurePrizeVault(prizeVaultAddress)).wait();

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

    ({ token, pool, poolAddress, yieldSource, yieldSourceAddress, prizeVault, prizeVaultAddress } = await deployFixture(
      signers.deployer,
    ));

    for (const signer of [signers.alice, signers.bob]) {
      await (await token.mint(signer.address, 1_000)).wait();
      await (await token.connect(signer).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
    }

    await (await token.mint(signers.deployer.address, 1_000)).wait();
    await (await token.connect(signers.deployer).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();

    await deposit(signers.alice, 10);
    await deposit(signers.bob, 30);
    await closeAndDraw();
  });

  async function encryptFor(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
    return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
  }

  async function deposit(signer: HardhatEthersSigner, amount: bigint | number) {
    const encrypted = await encryptFor(poolAddress, signer, amount);
    await (await pool.connect(signer).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function withdraw(signer: HardhatEthersSigner, amount: bigint | number) {
    const encrypted = await encryptFor(poolAddress, signer, amount);
    await (await pool.connect(signer).withdraw(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function closeAndDraw() {
    await time.increaseTo(Number(await pool.nextDrawClosesAt()));
    await (await pool.connect(signers.outsider).closeDraw()).wait();
    const roundId = (await pool.nextRoundId()) - 1n;
    await (await pool.connect(signers.outsider).blindDraw(roundId)).wait();
    return roundId;
  }

  async function accrueYield(amount: bigint | number) {
    const encrypted = await encryptFor(yieldSourceAddress, signers.deployer, amount);
    await (await yieldSource.connect(signers.deployer).accrueYield(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function allocatePrize(roundId = 1) {
    await (await yieldSource.connect(signers.outsider).allocateRoundYield(roundId)).wait();
  }

  async function fundPrize(amount: bigint | number) {
    await accrueYield(amount);
    await allocatePrize();
  }

  async function finalizeRound(roundId = 1) {
    const encryptedWinner = await pool.getEncryptedWinner(roundId);
    const publicDecryptResults = await fhevm.publicDecrypt([encryptedWinner]);
    await (
      await pool
        .connect(signers.outsider)
        .finalizeWinner(roundId, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof)
    ).wait();
    return pool.getWinner(roundId);
  }

  async function finalizeOrCancel(roundId: bigint | number) {
    const encryptedWinner = await pool.getEncryptedWinner(roundId);
    const publicDecryptResults = await fhevm.publicDecrypt([encryptedWinner]);
    await (
      await pool
        .connect(signers.outsider)
        .finalizeWinner(roundId, publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof)
    ).wait();
    return pool.getDrawInfo(roundId);
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

  async function authorizeAndDecryptPrize(winnerAddress: string, roundId = 1) {
    const winner = signerFor(winnerAddress);
    await (await prizeVault.connect(signers.outsider).authorizeWinner(roundId)).wait();
    const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
    const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);
    return { winner, clearPrize };
  }

  it("keeps principal, strategy yield, and prize custody physically separate", async function () {
    expect(await pool.asset()).to.equal(await token.getAddress());
    expect(await yieldSource.asset()).to.equal(await token.getAddress());
    expect(await yieldSource.pool()).to.equal(poolAddress);
    expect(await yieldSource.strategyOperator()).to.equal(signers.deployer.address);
    expect(await yieldSource.yieldRoundId()).to.equal(1);
    expect(await prizeVault.asset()).to.equal(await token.getAddress());
    expect(await prizeVault.pool()).to.equal(poolAddress);
    expect(await prizeVault.yieldSource()).to.equal(yieldSourceAddress);
  });

  it("backs prize accounting with realized confidential assets without changing principal", async function () {
    const alicePrincipal = await decryptPoolBalance(signers.alice);
    const bobPrincipal = await decryptPoolBalance(signers.bob);

    await accrueYield(150);
    await finalizeRound();
    await allocatePrize();

    expect(await decryptPoolBalance(signers.alice)).to.equal(alicePrincipal);
    expect(await decryptPoolBalance(signers.bob)).to.equal(bobPrincipal);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(850);
    expect(await yieldSource.yieldRoundId()).to.equal(2);
  });

  it("restricts yield accrual to the configured strategy operator", async function () {
    const encrypted = await encryptFor(yieldSourceAddress, signers.outsider, 10);
    await expect(
      yieldSource.connect(signers.outsider).accrueYield(encrypted.handles[0], encrypted.inputProof),
    ).to.be.revertedWith("Only strategy");
  });

  it("rejects direct prize credits from accounts other than the yield source", async function () {
    const encrypted = await encryptFor(prizeVaultAddress, signers.outsider, 10);
    await expect(prizeVault.connect(signers.outsider).recordPrize(1, encrypted.handles[0])).to.be.revertedWith(
      "Only yield source",
    );
  });

  it("rejects allocation before winner finalization without losing realized yield", async function () {
    await accrueYield(150);
    await expect(allocatePrize()).to.be.rejectedWith("Round not finalized");
    expect(await yieldSource.yieldRoundId()).to.equal(1);

    const statusBefore = await prizeVault.prizeStatus(1);
    expect(statusBefore.funded).to.equal(false);

    const winnerAddress = await finalizeRound();
    await allocatePrize();
    const { clearPrize } = await authorizeAndDecryptPrize(winnerAddress);
    expect(clearPrize).to.equal(150);
    expect(await yieldSource.yieldRoundId()).to.equal(2);
  });

  it("prevents a permissionless keeper from redirecting current yield to another round", async function () {
    await accrueYield(150);
    await finalizeRound();

    await expect(allocatePrize(2)).to.be.revertedWith("Wrong yield round");
    expect(await yieldSource.yieldRoundId()).to.equal(1);
    expect((await prizeVault.prizeStatus(1)).funded).to.equal(false);

    await allocatePrize(1);
    expect(await yieldSource.yieldRoundId()).to.equal(2);
    await expect(allocatePrize(1)).to.be.revertedWith("Wrong yield round");
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

  it("lets any keeper deliver winnings directly to the finalized winner", async function () {
    const winnerAddress = await finalizeRound();
    await fundPrize(150);
    const winner = signerFor(winnerAddress);

    const tokenBefore = await decryptTokenBalance(winner);
    const principalBefore = await decryptPoolBalance(winner);

    await (await prizeVault.connect(signers.outsider).deliverPrize(1)).wait();

    expect(await decryptTokenBalance(winner)).to.equal(tokenBefore + 150n);
    expect(await decryptPoolBalance(winner)).to.equal(principalBefore);

    const status = await prizeVault.prizeStatus(1);
    expect(status.claimed).to.equal(true);
    expect(status.winner).to.equal(winnerAddress);
    await expect(prizeVault.connect(signers.outsider).deliverPrize(1)).to.be.revertedWith("Prize already delivered");
  });

  it("never redirects a keeper-triggered prize to the caller", async function () {
    const winnerAddress = await finalizeRound();
    await fundPrize(150);
    const outsiderBefore = await decryptTokenBalance(signers.outsider).catch(() => 0n);

    await (await prizeVault.connect(signers.outsider).deliverPrize(1)).wait();

    const loser = otherPlayer(winnerAddress);
    expect(await decryptTokenBalance(loser)).to.equal(1_000n - (loser.address === signers.alice.address ? 10n : 30n));
    expect(await decryptTokenBalance(signers.outsider).catch(() => 0n)).to.equal(outsiderBefore);
  });

  it("preserves silent-zero behavior when strategy accrual exceeds real confidential assets", async function () {
    await accrueYield(2_000);
    expect(await decryptTokenBalance(signers.deployer)).to.equal(1_000);

    const winnerAddress = await finalizeRound();
    await allocatePrize();
    const { clearPrize } = await authorizeAndDecryptPrize(winnerAddress);
    expect(clearPrize).to.equal(0);
  });

  it("carries encrypted yield through a cancelled round and preserves it for the next eligible winner", async function () {
    await accrueYield(25);
    const round1Winner = await finalizeRound();
    await allocatePrize(1);
    await (await prizeVault.connect(signers.outsider).deliverPrize(1)).wait();
    expect(await yieldSource.yieldRoundId()).to.equal(2);

    await accrueYield(40);
    await withdraw(signers.alice, await decryptPoolBalance(signers.alice));
    await withdraw(signers.bob, await decryptPoolBalance(signers.bob));

    const round2 = await closeAndDraw();
    expect(round2).to.equal(2);
    const cancelled = await finalizeOrCancel(round2);
    expect(cancelled.state).to.equal(4);

    await expect(yieldSource.connect(signers.outsider).allocateRoundYield(2)).to.be.revertedWith("Round not finalized");
    await (await yieldSource.connect(signers.outsider).carryCancelledYield(2)).wait();
    expect(await yieldSource.yieldRoundId()).to.equal(3);

    await deposit(signers.alice, 12);
    await deposit(signers.bob, 28);
    const round3 = await closeAndDraw();
    expect(round3).to.equal(3);
    const round3Winner = await finalizeRound(3);

    await allocatePrize(3);
    const { clearPrize } = await authorizeAndDecryptPrize(round3Winner, 3);
    expect(clearPrize).to.equal(40);
    expect(await yieldSource.yieldRoundId()).to.equal(4);
    expect(round1Winner).to.not.equal(ethers.ZeroAddress);
  });

  it("rejects cancelled-yield carry for a round that is not cancelled", async function () {
    await finalizeRound();
    await expect(yieldSource.connect(signers.outsider).carryCancelledYield(1)).to.be.revertedWith(
      "Round not cancelled",
    );
    expect(await yieldSource.yieldRoundId()).to.equal(1);
  });
});
