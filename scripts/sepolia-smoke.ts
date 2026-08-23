import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import { deployments, ethers, fhevm, network } from "hardhat";

import { VeilPool, VeilPrizeVault, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const CUSDC_UNIT = 1_000_000n;

const WRAPPER_ABI = [
  "function underlying() view returns (address)",
  "function setOperator(address operator,uint48 until)",
  "function isOperator(address holder,address spender) view returns (bool)",
  "function wrap(address to,uint256 amount) returns (bytes32)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;

const UNDERLYING_ABI = [
  "function mint(address to,uint256 amount)",
  "function approve(address spender,uint256 amount) returns (bool)",
] as const;

async function deploymentAddress(name: string, envName: string) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  const deployment = await deployments.getOrNull(name);
  if (!deployment) throw new Error(`Missing ${envName} and no ${name} deployment was found for ${network.name}`);
  return deployment.address;
}

async function ensureGas(deployer: HardhatEthersSigner, signer: HardhatEthersSigner) {
  const minimum = ethers.parseEther("0.01");
  const target = ethers.parseEther("0.02");
  const balance = await ethers.provider.getBalance(signer.address);
  if (balance >= minimum) return;
  const tx = await deployer.sendTransaction({ to: signer.address, value: target - balance });
  await tx.wait();
}

async function encrypted64(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function waitForDrawClose(pool: VeilPool) {
  const closesAt = await pool.nextDrawClosesAt();
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= closesAt) return;

  const waitSeconds = Number(closesAt - now + 2n);
  if (waitSeconds > 1_800) {
    throw new Error(
      `Next draw closes in ${waitSeconds}s. Deploy the Sepolia demo with a shorter UNVEIL_DRAW_PERIOD_SECONDS for smoke validation.`,
    );
  }

  console.log(`  waiting ${waitSeconds}s for the contract-enforced draw deadline...`);
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
}

async function wrapDemoCusdc(
  wrapper: Contract,
  underlying: Contract,
  signer: HardhatEthersSigner,
  wholeTokens: bigint,
) {
  const amount = wholeTokens * CUSDC_UNIT;
  await (await underlying.connect(signer).mint(signer.address, amount)).wait();
  await (await underlying.connect(signer).approve(await wrapper.getAddress(), amount)).wait();
  await (await wrapper.connect(signer).wrap(signer.address, amount)).wait();
  return amount;
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run this script on Sepolia: npx hardhat run scripts/sepolia-smoke.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();

  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected at least three configured Sepolia signers");

  const poolAddress = await deploymentAddress("VeilPool", "UNVEIL_POOL_ADDRESS");
  const yieldSourceAddress = await deploymentAddress("VeilYieldSource", "UNVEIL_YIELD_SOURCE_ADDRESS");
  const prizeVaultAddress = await deploymentAddress("VeilPrizeVault", "UNVEIL_PRIZE_VAULT_ADDRESS");

  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVault", prizeVaultAddress)) as VeilPrizeVault;
  const assetAddress = process.env.UNVEIL_ASSET_ADDRESS?.trim() || (await pool.asset());
  const wrapper = new Contract(assetAddress, WRAPPER_ABI, deployer);
  const underlyingAddress = await wrapper.underlying();
  const underlying = new Contract(underlyingAddress, UNDERLYING_ABI, deployer);

  console.log("UNVEIL Sepolia smoke test");
  console.log(`  deployer:     ${deployer.address}`);
  console.log(`  alice:        ${alice.address}`);
  console.log(`  bob:          ${bob.address}`);
  console.log(`  cUSDC:        ${assetAddress}`);
  console.log(`  mock USDC:    ${underlyingAddress}`);
  console.log(`  pool:         ${poolAddress}`);
  console.log(`  yieldSource:  ${yieldSourceAddress}`);
  console.log(`  prizeVault:   ${prizeVaultAddress}`);
  console.log(`  drawPeriod:   ${(await pool.drawPeriod()).toString()} seconds`);

  for (const [label, contractAddress] of Object.entries({
    asset: assetAddress,
    pool: poolAddress,
    yieldSource: yieldSourceAddress,
    prizeVault: prizeVaultAddress,
  })) {
    if ((await ethers.provider.getCode(contractAddress)) === "0x") {
      throw new Error(`${label} has no deployed bytecode at ${contractAddress}`);
    }
  }

  if ((await pool.asset()).toLowerCase() !== assetAddress.toLowerCase()) throw new Error("Pool asset wiring mismatch");
  if ((await yieldSource.asset()).toLowerCase() !== assetAddress.toLowerCase()) {
    throw new Error("Yield source asset wiring mismatch");
  }
  if ((await yieldSource.pool()).toLowerCase() !== poolAddress.toLowerCase()) {
    throw new Error("Yield source pool wiring mismatch");
  }
  if ((await yieldSource.strategyOperator()).toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Unexpected strategy operator");
  }
  if ((await yieldSource.prizeVault()).toLowerCase() !== prizeVaultAddress.toLowerCase()) {
    throw new Error("Yield source prize vault wiring mismatch");
  }
  if ((await yieldSource.yieldRoundId()) !== 1n) throw new Error("Fresh yield cursor must start at round 1");
  if (await yieldSource.yieldReady()) throw new Error("Fresh yield bucket must start unsealed");
  if ((await prizeVault.pool()).toLowerCase() !== poolAddress.toLowerCase()) {
    throw new Error("Prize vault pool mismatch");
  }
  if ((await prizeVault.yieldSource()).toLowerCase() !== yieldSourceAddress.toLowerCase()) {
    throw new Error("Prize vault yield source mismatch");
  }

  const existingPlayers = await pool.playerCount();
  if (existingPlayers !== 0n && process.env.UNVEIL_SMOKE_ALLOW_DIRTY !== "true") {
    throw new Error(
      `Pool already has ${existingPlayers} active positions. Set UNVEIL_SMOKE_ALLOW_DIRTY=true only intentionally.`,
    );
  }

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);

  console.log("1/14 Minting mock USDC and wrapping it through Zama's official cUSDC wrapper...");
  await wrapDemoCusdc(wrapper, underlying, alice, 100n);
  await wrapDemoCusdc(wrapper, underlying, bob, 100n);
  await wrapDemoCusdc(wrapper, underlying, deployer, 50n);

  console.log("2/14 Authorizing UNVEIL as an ERC-7984 cUSDC operator...");
  await (await wrapper.connect(alice).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await wrapper.connect(bob).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await wrapper.connect(deployer).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();

  console.log("3/14 Making private encrypted cUSDC deposits...");
  const aliceDepositAmount = 10n * CUSDC_UNIT;
  const bobDepositAmount = 30n * CUSDC_UNIT;
  const aliceDeposit = await encrypted64(poolAddress, alice, aliceDepositAmount);
  await (await pool.connect(alice).deposit(aliceDeposit.handles[0], aliceDeposit.inputProof)).wait();
  const bobDeposit = await encrypted64(poolAddress, bob, bobDepositAmount);
  await (await pool.connect(bob).deposit(bobDeposit.handles[0], bobDeposit.inputProof)).wait();

  const alicePosition = await pool.connect(alice).encryptedPosition();
  const alicePrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, alicePosition.balance, poolAddress, alice);
  const bobBalanceHandle = await pool.connect(bob).encryptedBalanceOf();
  const bobPrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, bobBalanceHandle, poolAddress, bob);
  if (alicePrincipal !== aliceDepositAmount || bobPrincipal !== bobDepositAmount) {
    throw new Error(`Unexpected principal: Alice=${alicePrincipal}, Bob=${bobPrincipal}`);
  }

  const roundId = await pool.nextRoundId();
  if ((await yieldSource.yieldRoundId()) !== roundId) throw new Error("Yield bucket is not aligned with the open draw");

  console.log("4/14 Accruing asset-backed confidential demo yield during the open draw...");
  const prizeAmount = 15n * CUSDC_UNIT;
  const accruedYield = await encrypted64(yieldSourceAddress, deployer, prizeAmount);
  await (await yieldSource.connect(deployer).accrueYield(accruedYield.handles[0], accruedYield.inputProof)).wait();

  console.log("5/14 Waiting for the onchain draw deadline...");
  await waitForDrawClose(pool);

  console.log("6/14 Permissionlessly closing and snapshotting the draw as Alice...");
  await (await pool.connect(alice).closeDraw()).wait();

  console.log("7/14 Alice privately unveils her exact odds inputs...");
  const aliceWeight = await pool.connect(alice).encryptedSnapshotWeightOf(roundId);
  const aliceTotal = await pool.connect(alice).encryptedSnapshotTotalWeight(roundId);
  const clearAliceWeight = await fhevm.userDecryptEuint(FhevmType.euint64, aliceWeight, poolAddress, alice);
  const clearAliceTotal = await fhevm.userDecryptEuint(FhevmType.euint64, aliceTotal, poolAddress, alice);
  if (clearAliceWeight !== aliceDepositAmount || clearAliceTotal !== 40n * CUSDC_UNIT) {
    throw new Error(`Unexpected private odds inputs: weight=${clearAliceWeight}, total=${clearAliceTotal}`);
  }
  console.log("  Alice privately confirms exact snapshot odds: 25.00%");

  console.log("8/14 Permissionlessly running BlindDraw as Bob...");
  await (await pool.connect(bob).blindDraw(roundId)).wait();

  console.log("9/14 Publicly decrypting and proving the encrypted winner...");
  const encryptedWinner = await pool.getEncryptedWinner(roundId);
  const publicResult = await fhevm.publicDecrypt([encryptedWinner]);
  await (
    await pool.connect(alice).finalizeWinner(roundId, publicResult.abiEncodedClearValues, publicResult.decryptionProof)
  ).wait();
  const winnerAddress = await pool.getWinner(roundId);
  const winner = [alice, bob].find((signer) => signer.address.toLowerCase() === winnerAddress.toLowerCase());
  if (!winner) throw new Error(`Unexpected winner ${winnerAddress}`);
  console.log(`  winner: ${winnerAddress}`);

  console.log("10/14 Proving a keeper cannot race unfinished strategy yield sync...");
  await expectRevertReason(() => yieldSource.connect(bob).allocateRoundYield(roundId), "Yield not ready");

  console.log("11/14 Strategy sealing the encrypted realized-yield bucket...");
  await (await yieldSource.connect(deployer).sealRoundYield()).wait();
  if (!(await yieldSource.yieldReady())) throw new Error("Yield readiness was not persisted");

  console.log("12/14 Permissionlessly routing the predetermined sealed yield as Bob...");
  await (await yieldSource.connect(bob).allocateRoundYield(roundId)).wait();
  if ((await yieldSource.yieldRoundId()) !== roundId + 1n) throw new Error("Yield cursor did not advance");
  if (await yieldSource.yieldReady()) throw new Error("Next round yield bucket should reopen after allocation");

  console.log("13/14 Permissionlessly delivering the encrypted prize as Alice...");
  await (await prizeVault.connect(alice).deliverPrize(roundId)).wait();

  console.log("14/14 Winner privately unveils prize amount and verifies principal separation...");
  const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
  const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);
  if (clearPrize !== prizeAmount) throw new Error(`Expected encrypted awarded amount ${prizeAmount}, got ${clearPrize}`);

  const status = await prizeVault.prizeStatus(roundId);
  if (!status.claimed) throw new Error("Prize delivery status was not persisted");
  const winnerPrincipalHandle = await pool.connect(winner).encryptedBalanceOf();
  const winnerPrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, winnerPrincipalHandle, poolAddress, winner);
  const expectedPrincipal = winner.address.toLowerCase() === alice.address.toLowerCase() ? aliceDepositAmount : bobDepositAmount;
  if (winnerPrincipal !== expectedPrincipal) throw new Error("Prize delivery changed winner principal");

  console.log("\nUNVEIL Sepolia smoke test PASSED");
  console.log(`  round:        ${roundId}`);
  console.log(`  winner:       ${winnerAddress}`);
  console.log("  asset:        official Zama cUSDCMock ERC-7984 wrapper");
  console.log("  private odds: Alice 25.00% (unveiled only by Alice)");
  console.log("  prize:        15 cUSDC (unveiled only by winner)");
  console.log("  maintenance:  close, BlindDraw, yield routing, and payout were permissionless");
  console.log("  yield safety: keeper could not choose the round or race the unsealed strategy bucket");
}

async function expectRevertReason(action: () => Promise<unknown>, reason: string) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(reason)) return;
    throw error;
  }
  throw new Error(`Expected transaction to revert with ${reason}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
