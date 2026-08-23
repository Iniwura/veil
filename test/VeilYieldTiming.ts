import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { MockConfidentialToken, VeilPool, VeilYieldSource } from "../types";

const DRAW_PERIOD = 3_600n;
const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;

async function encrypted64(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

describe("VeilYieldSource round timing", function () {
  let strategy: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let keeper: HardhatEthersSigner;
  let token: MockConfidentialToken;
  let pool: VeilPool;
  let yieldSource: VeilYieldSource;
  let poolAddress: string;
  let yieldSourceAddress: string;

  before(async function () {
    [strategy, alice, bob, keeper] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    const tokenFactory = await ethers.getContractFactory("MockConfidentialToken");
    token = (await tokenFactory.deploy()) as MockConfidentialToken;

    const poolFactory = await ethers.getContractFactory("VeilPool");
    pool = (await poolFactory.deploy(await token.getAddress(), DRAW_PERIOD)) as VeilPool;
    poolAddress = await pool.getAddress();

    const yieldFactory = await ethers.getContractFactory("VeilYieldSource");
    yieldSource = (await yieldFactory.deploy(await token.getAddress(), poolAddress, strategy.address)) as VeilYieldSource;
    yieldSourceAddress = await yieldSource.getAddress();

    for (const participant of [alice, bob]) {
      await (await token.mint(participant.address, 100)).wait();
      await (await token.connect(participant).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
      const deposit = await encrypted64(poolAddress, participant, 10);
      await (await pool.connect(participant).deposit(deposit.handles[0], deposit.inputProof)).wait();
    }

    await (await token.mint(strategy.address, 100)).wait();
    await (await token.connect(strategy).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();
  });

  it("allows yield accrual while a draw is open but forbids sealing it before close", async function () {
    const accrued = await encrypted64(yieldSourceAddress, strategy, 25);
    await (await yieldSource.connect(strategy).accrueYield(accrued.handles[0], accrued.inputProof)).wait();

    expect(await yieldSource.yieldRoundId()).to.equal(1);
    expect(await yieldSource.yieldReady()).to.equal(false);
    await expect(yieldSource.connect(strategy).sealRoundYield()).to.be.revertedWith("Round still open");

    await time.increaseTo(Number(await pool.nextDrawClosesAt()));
    await (await pool.connect(keeper).closeDraw()).wait();

    await (await yieldSource.connect(strategy).sealRoundYield()).wait();
    expect(await yieldSource.yieldReady()).to.equal(true);
  });
});
