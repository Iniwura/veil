import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { MockConfidentialToken, MockConfidentialToken__factory, VeilPool, VeilPool__factory } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;

describe("VeilPool withdrawal semantics", function () {
  let alice: HardhatEthersSigner;
  let token: MockConfidentialToken;
  let pool: VeilPool;
  let poolAddress: string;

  before(async function () {
    [, alice] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    const tokenFactory = (await ethers.getContractFactory("MockConfidentialToken")) as MockConfidentialToken__factory;
    token = (await tokenFactory.deploy()) as MockConfidentialToken;

    const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
    pool = (await poolFactory.deploy(await token.getAddress())) as VeilPool;
    poolAddress = await pool.getAddress();

    await (await token.mint(alice.address, 1_000)).wait();
    await (await token.connect(alice).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  });

  async function encrypt(amount: bigint | number) {
    return fhevm.createEncryptedInput(poolAddress, alice.address).add64(amount).encrypt();
  }

  async function deposit(amount: bigint | number) {
    const encrypted = await encrypt(amount);
    await (await pool.connect(alice).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function withdraw(amount: bigint | number) {
    const encrypted = await encrypt(amount);
    await (await pool.connect(alice).withdraw(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function principal() {
    const handle = await pool.connect(alice).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, alice);
  }

  async function walletBalance() {
    const handle = await token.confidentialBalanceOf(alice.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), alice);
  }

  it("keeps a zero principal at zero when a positive withdrawal is requested", async function () {
    await deposit(0);
    expect(await principal()).to.equal(0);

    await withdraw(1);

    expect(await principal()).to.equal(0);
    expect(await walletBalance()).to.equal(1_000);
  });

  it("subtracts the requested amount when it is within the private balance", async function () {
    await deposit(5);
    expect(await principal()).to.equal(5);
    expect(await walletBalance()).to.equal(995);

    await withdraw(2);

    expect(await principal()).to.equal(3);
    expect(await walletBalance()).to.equal(997);
  });

  it("caps an excessive request at the full private balance", async function () {
    await deposit(5);

    await withdraw(6);

    expect(await principal()).to.equal(0);
    expect(await walletBalance()).to.equal(1_000);
  });
});
