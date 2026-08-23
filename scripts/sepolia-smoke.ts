import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network, deployments } from "hardhat";

import { MockConfidentialToken, VeilPool, VeilPrizeVault, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;

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

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run this script on Sepolia: npx hardhat run scripts/sepolia-smoke.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();

  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected at least three configured Sepolia signers");

  const assetAddress = await deploymentAddress("MockConfidentialToken", "UNVEIL_ASSET_ADDRESS");
  const poolAddress = await deploymentAddress("VeilPool", "UNVEIL_POOL_ADDRESS");
  const yieldSourceAddress = await deploymentAddress("VeilYieldSource", "UNVEIL_YIELD_SOURCE_ADDRESS");
  const prizeVaultAddress = await deploymentAddress("VeilPrizeVault", "UNVEIL_PRIZE_VAULT_ADDRESS");

  const token = (await ethers.getContractAt("MockConfidentialToken", assetAddress)) as MockConfidentialToken;
  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVault", prizeVaultAddress)) as VeilPrizeVault;

  console.log("UNVEIL Sepolia smoke test");
  console.log(`  deployer:    ${deployer.address}`);
  console.log(`  alice:       ${alice.address}`);
  console.log(`  bob:         ${bob.address}`);
  console.log(`  asset:       ${assetAddress}`);
  console.log(`  pool:        ${poolAddress}`);
  console.log(`  yieldSource: ${yieldSourceAddress}`);
  console.log(`  prizeVault:  ${prizeVaultAddress}`);
  console.log(`  drawPeriod:  ${(await pool.drawPeriod()).toString()} seconds`);

  for (const [label, contractAddress] of Object.entries({
    asset: assetAddress,
    pool: poolAddress,
    yieldSource: yieldSourceAddress,
    prizeVault: prizeVaultAddress,
  })) {
    if ((await ethers.provider.getCode(contractAddress)) === "0x")
      throw new Error(`${label} has no deployed bytecode at ${contractAddress}`);
  }

  if ((await pool.asset()).toLowerCase() !== assetAddress.toLowerCase()) throw new Error("Pool asset wiring mismatch");
  if ((await yieldSource.asset()).toLowerCase() !== assetAddress.toLowerCase())
    throw new Error("Yield source asset wiring mismatch");
  if ((await yieldSource.pool()).toLowerCase() !== poolAddress.toLowerCase())
    throw new Error("Yield source pool wiring mismatch");
  if ((await yieldSource.strategyOperator()).toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Unexpected strategy operator");
  }
  if ((await yieldSource.prizeVault()).toLowerCase() !== prizeVaultAddress.toLowerCase()) {
    throw new Error("Yield source prize vault wiring mismatch");
  }
  if ((await yieldSource.yieldRoundId()) !== 1n) throw new Error("Fresh yield cursor must start at round 1");
  if ((await prizeVault.pool()).toLowerCase() !== poolAddress.toLowerCase())
    throw new Error("Prize vault pool mismatch");
  if ((await prizeVault.yieldSource()).toLowerCase() !== yieldSourceAddress.toLowerCase())
    throw new Error("Prize vault yield source mismatch");

  const existingPlayers = await pool.playerCount();
  if (existingPlayers !== 0n && process.env.UNVEIL_SMOKE_ALLOW_DIRTY !== "true") {
    throw new Error(
      `Pool already has ${existingPlayers} active positions. Set UNVEIL_SMOKE_ALLOW_DIRTY=true only intentionally.`,
    );
  }

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);

  console.log("1/12 Minting test-only confidential assets...");
  await (await token.mint(alice.address, 100)).wait();
  await (await token.mint(bob.address, 100)).wait();
  await (await token.mint(deployer.address, 50)).wait();

  console.log("2/12 Authorizing confidential asset operators...");
  await (await token.connect(alice).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await token.connect(bob).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await token.connect(deployer).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();

  console.log("3/12 Making private encrypted deposits...");
  const aliceDeposit = await encrypted64(poolAddress, alice, 10);
  await (await pool.connect(alice).deposit(aliceDeposit.handles[0], aliceDeposit.inputProof)).wait();
  const bobDeposit = await encrypted64(poolAddress, bob, 30);
  await (await pool.connect(bob).deposit(bobDeposit.handles[0], bobDeposit.inputProof)).wait();

  const alicePosition = await pool.connect(alice).encryptedPosition();
  const alicePrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, alicePosition.balance, poolAddress, alice);
  const bobBalanceHandle = await pool.connect(bob).encryptedBalanceOf();
  const bobPrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, bobBalanceHandle, poolAddress, bob);
  if (alicePrincipal !== 10n || bobPrincipal !== 30n)
    throw new Error(`Unexpected principal: Alice=${alicePrincipal}, Bob=${bobPrincipal}`);

  const roundId = await pool.nextRoundId();
  if ((await yieldSource.yieldRoundId()) !== roundId) throw new Error("Yield bucket is not aligned with the open draw");

  console.log("4/12 Accruing asset-backed confidential demo yield during the open draw...");
  const accruedYield = await encrypted64(yieldSourceAddress, deployer, 15);
  await (await yieldSource.connect(deployer).accrueYield(accruedYield.handles[0], accruedYield.inputProof)).wait();

  console.log("5/12 Waiting for the onchain draw deadline...");
  await waitForDrawClose(pool);

  console.log("6/12 Permissionlessly closing and snapshotting the draw as Alice...");
  await (await pool.connect(alice).closeDraw()).wait();

  const aliceWeight = await pool.connect(alice).encryptedSnapshotWeightOf(roundId);
  const aliceTotal = await pool.connect(alice).encryptedSnapshotTotalWeight(roundId);
  const clearAliceWeight = await fhevm.userDecryptEuint(FhevmType.euint64, aliceWeight, poolAddress, alice);
  const clearAliceTotal = await fhevm.userDecryptEuint(FhevmType.euint64, aliceTotal, poolAddress, alice);
  if (clearAliceWeight !== 10n || clearAliceTotal !== 40n) {
    throw new Error(`Unexpected private odds inputs: weight=${clearAliceWeight}, total=${clearAliceTotal}`);
  }
  console.log("  Alice privately confirms exact snapshot odds: 25.00%");

  console.log("7/12 Permissionlessly running BlindDraw as Bob...");
  await (await pool.connect(bob).blindDraw(roundId)).wait();

  console.log("8/12 Publicly decrypting and proving the encrypted winner...");
  const encryptedWinner = await pool.getEncryptedWinner(roundId);
  const publicResult = await fhevm.publicDecrypt([encryptedWinner]);
  await (
    await pool.connect(alice).finalizeWinner(roundId, publicResult.abiEncodedClearValues, publicResult.decryptionProof)
  ).wait();
  const winnerAddress = await pool.getWinner(roundId);
  const winner = [alice, bob].find((signer) => signer.address.toLowerCase() === winnerAddress.toLowerCase());
  if (!winner) throw new Error(`Unexpected winner ${winnerAddress}`);
  console.log(`  winner: ${winnerAddress}`);

  console.log("9/12 Permissionlessly routing the predetermined round's encrypted yield as Bob...");
  await (await yieldSource.connect(bob).allocateRoundYield(roundId)).wait();
  if ((await yieldSource.yieldRoundId()) !== roundId + 1n) throw new Error("Yield cursor did not advance");

  console.log("10/12 Permissionlessly delivering the encrypted prize as Alice...");
  await (await prizeVault.connect(alice).deliverPrize(roundId)).wait();

  console.log("11/12 Winner privately unveils the delivered prize amount...");
  const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
  const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);
  if (clearPrize !== 15n) throw new Error(`Expected encrypted awarded amount 15, got ${clearPrize}`);

  console.log("12/12 Verifying delivery state and principal separation...");
  const status = await prizeVault.prizeStatus(roundId);
  if (!status.claimed) throw new Error("Prize delivery status was not persisted");
  const winnerPrincipalHandle = await pool.connect(winner).encryptedBalanceOf();
  const winnerPrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, winnerPrincipalHandle, poolAddress, winner);
  const expectedPrincipal = winner.address.toLowerCase() === alice.address.toLowerCase() ? 10n : 30n;
  if (winnerPrincipal !== expectedPrincipal) throw new Error("Prize delivery changed winner principal");

  console.log("\nUNVEIL Sepolia smoke test PASSED");
  console.log(`  round:        ${roundId}`);
  console.log(`  winner:       ${winnerAddress}`);
  console.log("  private odds: Alice 25.00% (unveiled only by Alice)");
  console.log(`  prize:        ${clearPrize} encrypted token units (unveiled only by winner)`);
  console.log("  maintenance: close, BlindDraw, yield routing, and payout were permissionless");
  console.log("  yield safety: keeper could not choose the prize round; the onchain cursor did");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
