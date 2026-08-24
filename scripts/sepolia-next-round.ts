import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";

import { MockConfidentialToken, VeilPool, VeilPrizeVault, VeilYieldSource } from "../types";

const MAX_OPERATOR_UNTIL = 281_474_976_710_655n;
const PRIZE_AMOUNT = 15n;

const ADDRESSES = {
  asset: "0x2a267e64bb8B460EEFF9bA25e51b8D9431A00125",
  pool: "0x523b515A6e3fCB19737dF45243616c36564fD62f",
  yieldSource: "0x752c132D7E6d45F7dA71D7Fe00F4afde22eAc7b3",
  prizeVault: "0x217a64703DfBfC92A52a81cBfF0d86078dc84aF8",
};

async function encrypted64(contractAddress: string, signer: HardhatEthersSigner, amount: bigint) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run on Sepolia: npx hardhat run scripts/sepolia-next-round.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();

  const signers = (await ethers.getSigners()) as HardhatEthersSigner[];
  const deployer = signers[0];
  if (!deployer) throw new Error("Missing configured Sepolia deployer signer");

  const token = (await ethers.getContractAt("MockConfidentialToken", ADDRESSES.asset)) as MockConfidentialToken;
  const pool = (await ethers.getContractAt("VeilPool", ADDRESSES.pool)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", ADDRESSES.yieldSource)) as VeilYieldSource;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVault", ADDRESSES.prizeVault)) as VeilPrizeVault;

  // Draw progression is permissionless. The deployer still needs to own the demo yield adapter
  // because the prize-funding portion of this script intentionally remains owner-controlled.
  const yieldOwner = await yieldSource.owner();
  if (yieldOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Configured deployer ${deployer.address} is not yield-source owner ${yieldOwner}`);
  }

  const playerCount = await pool.playerCount();
  if (playerCount < 2n) throw new Error(`Need at least 2 players; current playerCount=${playerCount}`);

  const roundId = await pool.nextRoundId();
  console.log("VEIL Sepolia next-round runner");
  console.log(`  draw caller: ${deployer.address} (permissionless)`);
  console.log(`  yield owner: ${deployer.address}`);
  console.log(`  participants:${playerCount}`);
  console.log(`  round:       ${roundId}`);

  const schedule = await pool.getDrawSchedule();
  if (!schedule.ready) {
    throw new Error(`Draw ${roundId} is not ready. Its window closes at Unix timestamp ${schedule.closesAt}.`);
  }

  console.log("1/7 Snapshotting current encrypted pool...");
  await (await pool.snapshotRound()).wait();

  console.log(`2/7 Running BlindDraw for round ${roundId}...`);
  await (await pool.blindDraw(roundId)).wait();

  console.log("3/7 Publicly decrypting and proving winner...");
  const encryptedWinner = await pool.getEncryptedWinner(roundId);
  const publicResult = await fhevm.publicDecrypt([encryptedWinner]);
  await (await pool.finalizeWinner(roundId, publicResult.abiEncodedClearValues, publicResult.decryptionProof)).wait();

  const winnerAddress = await pool.getWinner(roundId);
  console.log(`  winner: ${winnerAddress}`);

  const winner = signers.find((signer) => signer.address.toLowerCase() === winnerAddress.toLowerCase());
  if (!winner) {
    throw new Error(
      `Winner ${winnerAddress} is not one of the configured local Sepolia signers. Round is finalized, but prize claim must be completed by that wallet.`,
    );
  }

  console.log("4/7 Ensuring yield-source operator authorization...");
  if (!(await token.isOperator(deployer.address, ADDRESSES.yieldSource))) {
    await (await token.connect(deployer).setOperator(ADDRESSES.yieldSource, MAX_OPERATOR_UNTIL)).wait();
  }

  console.log(`5/7 Accruing and allocating ${PRIZE_AMOUNT} encrypted demo token units...`);
  const accruedYield = await encrypted64(ADDRESSES.yieldSource, deployer, PRIZE_AMOUNT);
  await (await yieldSource.accrueYield(accruedYield.handles[0], accruedYield.inputProof)).wait();

  const allocatedYield = await encrypted64(ADDRESSES.yieldSource, deployer, PRIZE_AMOUNT);
  await (await yieldSource.allocateToRound(roundId, allocatedYield.handles[0], allocatedYield.inputProof)).wait();

  console.log("6/7 Authorizing finalized winner and verifying private prize...");
  await (await prizeVault.authorizeWinner(roundId)).wait();
  const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
  const clearPrize = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedPrize, ADDRESSES.prizeVault, winner);
  if (clearPrize !== PRIZE_AMOUNT) {
    throw new Error(`Expected prize ${PRIZE_AMOUNT}, got ${clearPrize}`);
  }

  console.log("7/7 Claiming encrypted prize...");
  await (await prizeVault.connect(winner).claimPrize(roundId)).wait();
  const status = await prizeVault.prizeStatus(roundId);
  if (!status.claimed) throw new Error("Prize claim status was not persisted");

  console.log("\nVEIL Sepolia Round PASSED");
  console.log(`  round:  ${roundId}`);
  console.log(`  winner: ${winnerAddress}`);
  console.log(`  prize:  ${clearPrize} encrypted token units`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
