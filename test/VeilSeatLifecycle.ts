import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { MockConfidentialToken, VeilPool } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const TEST_DRAW_PERIOD = 60 * 60;

async function encrypted64(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

describe("VeilPool draw-seat lifecycle", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let token: MockConfidentialToken;
  let pool: VeilPool;
  let poolAddress: string;

  before(async function () {
    [, alice, bob] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    const tokenFactory = await ethers.getContractFactory("MockConfidentialToken");
    token = (await tokenFactory.deploy()) as MockConfidentialToken;

    const poolFactory = await ethers.getContractFactory("VeilPool");
    pool = (await poolFactory.deploy(await token.getAddress(), TEST_DRAW_PERIOD)) as VeilPool;
    poolAddress = await pool.getAddress();

    for (const signer of [alice, bob]) {
      await (await token.mint(signer.address, 100)).wait();
      await (await token.connect(signer).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
    }
  });

  async function deposit(signer: HardhatEthersSigner, amount: bigint | number) {
    const input = await encrypted64(poolAddress, signer, amount);
    await (await pool.connect(signer).deposit(input.handles[0], input.inputProof)).wait();
  }

  async function withdraw(signer: HardhatEthersSigner, amount: bigint | number) {
    const input = await encrypted64(poolAddress, signer, amount);
    await (await pool.connect(signer).withdraw(input.handles[0], input.inputProof)).wait();
  }

  async function decryptPosition(signer: HardhatEthersSigner) {
    const handle = await pool.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, signer);
  }

  async function advanceToDrawClose() {
    const closesAt = Number(await pool.nextDrawClosesAt());
    const latest = await ethers.provider.getBlock("latest");
    if (!latest) throw new Error("Latest block unavailable");
    const delta = closesAt - latest.timestamp;
    if (delta > 0) await ethers.provider.send("evm_increaseTime", [delta]);
    await ethers.provider.send("evm_mine", []);
  }

  it("expires draw seats without trapping confidential principal", async function () {
    await deposit(alice, 10);
    await deposit(bob, 20);

    expect(await pool.playerCount()).to.equal(2);
    expect(await pool.seated(alice.address)).to.equal(true);
    expect(await decryptPosition(alice)).to.equal(10);
    const latest = await ethers.provider.getBlock("latest");
    if (!latest) throw new Error("Latest block unavailable");
    expect((await pool.seatExpiresAt(alice.address)) - BigInt(latest.timestamp)).to.be.greaterThan(24n * 60n * 60n);

    await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await (await pool.pruneExpiredSeats()).wait();

    expect(await pool.playerCount()).to.equal(0);
    expect(await pool.seated(alice.address)).to.equal(false);
    expect(await pool.joined(alice.address)).to.equal(true);
    expect(await decryptPosition(alice)).to.equal(10);

    await withdraw(alice, 4);
    expect(await decryptPosition(alice)).to.equal(6);

    await (await pool.connect(alice).renewDrawSeat()).wait();
    expect(await pool.playerCount()).to.equal(1);
    expect(await pool.seated(alice.address)).to.equal(true);
    expect(await decryptPosition(alice)).to.equal(6);
  });

  it("lets a user release a draw seat without changing their private balance", async function () {
    await deposit(alice, 12);
    expect(await pool.playerCount()).to.equal(1);

    await (await pool.connect(alice).leaveDrawSeat()).wait();

    expect(await pool.playerCount()).to.equal(0);
    expect(await pool.seated(alice.address)).to.equal(false);
    expect(await pool.joined(alice.address)).to.equal(true);
    expect(await decryptPosition(alice)).to.equal(12);
  });

  it("turns an all-zero encrypted draw into a proven cancelled round", async function () {
    await deposit(alice, 0);
    await deposit(bob, 0);

    expect(await pool.playerCount()).to.equal(2);
    expect(await decryptPosition(alice)).to.equal(0);
    expect(await decryptPosition(bob)).to.equal(0);

    await advanceToDrawClose();
    await (await pool.snapshotRound()).wait();
    await (await pool.blindDraw(1)).wait();

    const encryptedWinner = await pool.getEncryptedWinner(1);
    const publicResult = await fhevm.publicDecrypt([encryptedWinner]);
    await (await pool.finalizeWinner(1, publicResult.abiEncodedClearValues, publicResult.decryptionProof)).wait();

    const draw = await pool.getDrawInfo(1);
    expect(draw.state).to.equal(4);
    expect(await pool.unsettledRoundCount()).to.equal(0);
    expect(await pool.nextDrawClosesAt()).to.be.greaterThan(0);
    await expect(pool.getWinner(1)).to.be.revertedWith("Winner not finalized");
  });
});
