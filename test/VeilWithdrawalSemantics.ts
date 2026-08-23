import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { MockConfidentialToken, MockConfidentialToken__factory, VeilPool, VeilPool__factory } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const DRAW_PERIOD = 3_600n;

describe("VeilPool withdrawal semantics", function () {
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

    const tokenFactory = (await ethers.getContractFactory("MockConfidentialToken")) as MockConfidentialToken__factory;
    token = (await tokenFactory.deploy()) as MockConfidentialToken;

    const poolFactory = (await ethers.getContractFactory("VeilPool")) as VeilPool__factory;
    pool = (await poolFactory.deploy(await token.getAddress(), DRAW_PERIOD)) as VeilPool;
    poolAddress = await pool.getAddress();

    await (await token.mint(alice.address, 1_000)).wait();
    await (await token.mint(bob.address, 1_000)).wait();
    await (await token.connect(alice).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
    await (await token.connect(bob).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  });

  async function encryptFor(signer: HardhatEthersSigner, amount: bigint | number) {
    return fhevm.createEncryptedInput(poolAddress, signer.address).add64(amount).encrypt();
  }

  async function depositFor(signer: HardhatEthersSigner, amount: bigint | number) {
    const encrypted = await encryptFor(signer, amount);
    await (await pool.connect(signer).deposit(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function withdrawFor(signer: HardhatEthersSigner, amount: bigint | number) {
    const encrypted = await encryptFor(signer, amount);
    await (await pool.connect(signer).withdraw(encrypted.handles[0], encrypted.inputProof)).wait();
  }

  async function principalFor(signer: HardhatEthersSigner) {
    const handle = await pool.connect(signer).encryptedBalanceOf();
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, signer);
  }

  async function walletBalanceFor(signer: HardhatEthersSigner) {
    const handle = await token.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), signer);
  }

  async function deposit(amount: bigint | number) {
    return depositFor(alice, amount);
  }

  async function withdraw(amount: bigint | number) {
    return withdrawFor(alice, amount);
  }

  async function principal() {
    return principalFor(alice);
  }

  async function walletBalance() {
    return walletBalanceFor(alice);
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

  it("silently transfers zero when the request exceeds the private balance", async function () {
    await deposit(5);

    await withdraw(6);

    expect(await principal()).to.equal(5);
    expect(await walletBalance()).to.equal(995);
  });

  it("does not spend another depositor's pooled custody on an oversized withdrawal", async function () {
    await depositFor(alice, 1);
    await depositFor(bob, 20);

    expect(await principalFor(alice)).to.equal(1);
    expect(await principalFor(bob)).to.equal(20);
    expect(await walletBalanceFor(alice)).to.equal(999);

    // The pool holds 21 total, so the asset contract alone could satisfy this request.
    // UNVEIL must enforce all-or-zero against Alice's own encrypted principal first.
    await withdrawFor(alice, 2);

    expect(await principalFor(alice)).to.equal(1);
    expect(await principalFor(bob)).to.equal(20);
    expect(await walletBalanceFor(alice)).to.equal(999);
  });
});
