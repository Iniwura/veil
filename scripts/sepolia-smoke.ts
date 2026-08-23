import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";

import { MockConfidentialToken, VeilPool, VeilPrizeVault, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;

const DEFAULT_ADDRESSES = {
  asset: "0x79836eCae72C3EB5423fd5D1d200CbaEA0cCEE6e",
  pool: "0xd5395972b0Cd747fAD531389E449958a343adA1b",
  yieldSource: "0xdDB2b7fe447c55576F882138d59DE00a7d8EbE3D",
  prizeVault: "0xb580c50192f5d7C613Db4e9427a2fA0C9701Af84",
};

function address(name: keyof typeof DEFAULT_ADDRESSES): string {
  const envName = `VEIL_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_ADDRESS`;
  return process.env[envName] ?? DEFAULT_ADDRESSES[name];
}

async function ensureGas(deployer: HardhatEthersSigner, signer: HardhatEthersSigner) {
  const minimum = ethers.parseEther("0.01");
  const target = ethers.parseEther("0.02");
  const balance = await ethers.provider.getBalance(signer.address);

  if (balance >= minimum) return;

  const tx = await deployer.sendTransaction({
    to: signer.address,
    value: target - balance,
  });
  await tx.wait();
}

async function encrypted64(contractAddress: string, signer: HardhatEthersSigner, amount: bigint | number) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run this script on Sepolia: npx hardhat run scripts/sepolia-smoke.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();

  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected at least three configured Sepolia signers");

  const assetAddress = address("asset");
  const poolAddress = address("pool");
  const yieldSourceAddress = address("yieldSource");
  const prizeVaultAddress = address("prizeVault");

  const token = (await ethers.getContractAt("MockConfidentialToken", assetAddress)) as MockConfidentialToken;
  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVault", prizeVaultAddress)) as VeilPrizeVault;

  console.log("VEIL Sepolia smoke test");
  console.log(`  deployer:    ${deployer.address}`);
  console.log(`  alice:       ${alice.address}`);
  console.log(`  bob:         ${bob.address}`);
  console.log(`  asset:       ${assetAddress}`);
  console.log(`  pool:        ${poolAddress}`);
  console.log(`  yieldSource: ${yieldSourceAddress}`);
  console.log(`  prizeVault:  ${prizeVaultAddress}`);

  for (const [label, contractAddress] of Object.entries({
    asset: assetAddress,
    pool: poolAddress,
    yieldSource: yieldSourceAddress,
    prizeVault: prizeVaultAddress,
  })) {
    const code = await ethers.provider.getCode(contractAddress);
    if (code === "0x") throw new Error(`${label} has no deployed bytecode at ${contractAddress}`);
  }

  if ((await pool.asset()).toLowerCase() !== assetAddress.toLowerCase()) throw new Error("Pool asset wiring mismatch");
  if ((await yieldSource.asset()).toLowerCase() !== assetAddress.toLowerCase()) {
    throw new Error("Yield source asset wiring mismatch");
  }
  if ((await yieldSource.prizeVault()).toLowerCase() !== prizeVaultAddress.toLowerCase()) {
    throw new Error("Yield source prize vault wiring mismatch");
  }
  if ((await prizeVault.pool()).toLowerCase() !== poolAddress.toLowerCase())
    throw new Error("Prize vault pool mismatch");
  if ((await prizeVault.asset()).toLowerCase() !== assetAddress.toLowerCase())
    throw new Error("Prize vault asset mismatch");
  if ((await prizeVault.yieldSource()).toLowerCase() !== yieldSourceAddress.toLowerCase()) {
    throw new Error("Prize vault yield source mismatch");
  }

  const existingPlayers = await pool.playerCount();
  if (existingPlayers !== 0n && process.env.VEIL_SMOKE_ALLOW_DIRTY !== "true") {
    throw new Error(
      `Pool already has ${existingPlayers} registered players. Set VEIL_SMOKE_ALLOW_DIRTY=true only if you intentionally want to reuse this deployment.`,
    );
  }

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);

  console.log("1/10 Minting demo confidential assets...");
  await (await token.mint(alice.address, 100)).wait();
  await (await token.mint(bob.address, 100)).wait();
  await (await token.mint(deployer.address, 50)).wait();

  console.log("2/10 Authorizing confidential token operators...");
  await (await token.connect(alice).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await token.connect(bob).setOperator(poolAddress, MAX_OPERATOR_UNTIL)).wait();
  await (await token.connect(deployer).setOperator(yieldSourceAddress, MAX_OPERATOR_UNTIL)).wait();

  console.log("3/10 Making encrypted deposits...");
  const aliceDeposit = await encrypted64(poolAddress, alice, 10);
  await (await pool.connect(alice).deposit(aliceDeposit.handles[0], aliceDeposit.inputProof)).wait();
  const bobDeposit = await encrypted64(poolAddress, bob, 30);
  await (await pool.connect(bob).deposit(bobDeposit.handles[0], bobDeposit.inputProof)).wait();

  const aliceBalanceHandle = await pool.connect(alice).encryptedBalanceOf();
  const bobBalanceHandle = await pool.connect(bob).encryptedBalanceOf();
  const alicePrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, poolAddress, alice);
  const bobPrincipal = await fhevm.userDecryptEuint(FhevmType.euint64, bobBalanceHandle, poolAddress, bob);
  if (alicePrincipal !== 10n || bobPrincipal !== 30n) {
    throw new Error(`Unexpected encrypted principal balances: Alice=${alicePrincipal}, Bob=${bobPrincipal}`);
  }

  console.log("4/10 Snapshotting the encrypted pool...");
  const roundId = await pool.nextRoundId();
  await (await pool.snapshotRound()).wait();

  console.log(`5/10 Running BlindDraw for round ${roundId}...`);
  await (await pool.blindDraw(roundId)).wait();

  console.log("6/10 Publicly decrypting and proving the winner...");
  const encryptedWinner = await pool.getEncryptedWinner(roundId);
  const publicResult = await fhevm.publicDecrypt([encryptedWinner]);
  await (await pool.finalizeWinner(roundId, publicResult.abiEncodedClearValues, publicResult.decryptionProof)).wait();

  const winnerAddress = await pool.getWinner(roundId);
  const winner = [alice, bob].find((signer) => signer.address.toLowerCase() === winnerAddress.toLowerCase());
  if (!winner) throw new Error(`Unexpected winner ${winnerAddress}; smoke test expected Alice or Bob`);
  console.log(`  winner: ${winnerAddress}`);

  console.log("7/10 Accruing real asset-backed confidential yield...");
  const accruedYield = await encrypted64(yieldSourceAddress, deployer, 15);
  await (await yieldSource.accrueYield(accruedYield.handles[0], accruedYield.inputProof)).wait();

  console.log("8/10 Allocating encrypted yield to the round prize...");
  const allocatedYield = await encrypted64(yieldSourceAddress, deployer, 15);
  await (await yieldSource.allocateToRound(roundId, allocatedYield.handles[0], allocatedYield.inputProof)).wait();

  console.log("9/10 Authorizing only the finalized winner to decrypt the prize...");
  await (await prizeVault.authorizeWinner(roundId)).wait();
  const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
  const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, prizeVaultAddress, winner);
  if (clearPrize !== 15n) throw new Error(`Expected encrypted prize 15, got ${clearPrize}`);

  console.log("10/10 Claiming the confidential prize...");
  await (await prizeVault.connect(winner).claimPrize(roundId)).wait();
  const status = await prizeVault.prizeStatus(roundId);
  if (!status.claimed) throw new Error("Prize claim status was not persisted");

  console.log("\nVEIL Sepolia smoke test PASSED");
  console.log(`  round:  ${roundId}`);
  console.log(`  winner: ${winnerAddress}`);
  console.log(`  prize:  ${clearPrize} encrypted token units (decrypted only by winner)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
