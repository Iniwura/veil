import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network, deployments } from "hardhat";

import { VeilPool, VeilPrizeVault, VeilYieldSource } from "../types";

async function address(name: string, envName: string) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  const deployment = await deployments.getOrNull(name);
  if (!deployment) throw new Error(`Missing ${envName} and no ${name} deployment exists for ${network.name}`);
  return deployment.address;
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error("Run on Sepolia: npx hardhat run scripts/sepolia-next-round.ts --network sepolia");
  }

  await fhevm.initializeCLIApi();
  const [keeper] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!keeper) throw new Error("Missing configured Sepolia keeper signer");

  const poolAddress = await address("VeilPool", "UNVEIL_POOL_ADDRESS");
  const yieldSourceAddress = await address("VeilYieldSource", "UNVEIL_YIELD_SOURCE_ADDRESS");
  const prizeVaultAddress = await address("VeilPrizeVault", "UNVEIL_PRIZE_VAULT_ADDRESS");

  const pool = (await ethers.getContractAt("VeilPool", poolAddress)) as VeilPool;
  const yieldSource = (await ethers.getContractAt("VeilYieldSource", yieldSourceAddress)) as VeilYieldSource;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVault", prizeVaultAddress)) as VeilPrizeVault;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const closesAt = await pool.nextDrawClosesAt();
  const nextRoundId = await pool.nextRoundId();

  console.log("UNVEIL permissionless keeper");
  console.log(`  keeper:      ${keeper.address}`);
  console.log(`  pool:        ${poolAddress}`);
  console.log(`  next round:  ${nextRoundId}`);
  console.log(`  next close:  ${closesAt}`);

  if (now >= closesAt) {
    console.log("1/5 Closing elapsed draw and freezing encrypted weights...");
    const before = await pool.nextRoundId();
    await (await pool.connect(keeper).closeDraw()).wait();
    const after = await pool.nextRoundId();
    if (after === before) {
      console.log("  period skipped because fewer than two eligible positions were present at the scheduled close");
      return;
    }
  } else {
    console.log(`1/5 Draw still open for ${closesAt - now}s; no privileged early close is possible.`);
  }

  const latestRoundId = (await pool.nextRoundId()) - 1n;
  if (latestRoundId <= 0n) return;
  let draw = await pool.getDrawInfo(latestRoundId);

  if (Number(draw.state) === 1) {
    console.log(`2/5 Running FHE BlindDraw for round ${latestRoundId}...`);
    await (await pool.connect(keeper).blindDraw(latestRoundId)).wait();
    draw = await pool.getDrawInfo(latestRoundId);
  } else {
    console.log(`2/5 BlindDraw already advanced; current state=${draw.state}`);
  }

  if (Number(draw.state) === 2) {
    console.log("3/5 Requesting Zama public decryption and finalizing winner proof...");
    const encryptedWinner = await pool.getEncryptedWinner(latestRoundId);
    const result = await fhevm.publicDecrypt([encryptedWinner]);
    await (
      await pool.connect(keeper).finalizeWinner(latestRoundId, result.abiEncodedClearValues, result.decryptionProof)
    ).wait();
    draw = await pool.getDrawInfo(latestRoundId);
  } else {
    console.log(`3/5 Winner proof step already advanced; current state=${draw.state}`);
  }

  if (Number(draw.state) === 4) {
    console.log(`Round ${latestRoundId} was proven to have no eligible positive weight and is CANCELLED.`);
    return;
  }

  if (Number(draw.state) !== 3) {
    console.log(`Round ${latestRoundId} is not finalized yet; stopping at state=${draw.state}.`);
    return;
  }

  const winner = await pool.getWinner(latestRoundId);
  console.log(`  winner: ${winner}`);

  let prize = await prizeVault.prizeStatus(latestRoundId);
  if (!prize.funded) {
    console.log("4/5 Routing all currently realized confidential strategy yield to the finalized round...");
    await (await yieldSource.connect(keeper).allocateAllToRound(latestRoundId)).wait();
    prize = await prizeVault.prizeStatus(latestRoundId);
  } else {
    console.log("4/5 Prize already funded.");
  }

  if (!prize.claimed) {
    console.log("5/5 Delivering encrypted prize directly to the finalized winner...");
    await (await prizeVault.connect(keeper).deliverPrize(latestRoundId)).wait();
  } else {
    console.log("5/5 Prize already delivered.");
  }

  const finalStatus = await prizeVault.prizeStatus(latestRoundId);
  console.log("\nUNVEIL keeper run complete");
  console.log(`  round:     ${latestRoundId}`);
  console.log(`  winner:    ${winner}`);
  console.log(`  funded:    ${finalStatus.funded}`);
  console.log(`  delivered: ${finalStatus.claimed}`);
  console.log("  note: prize amount remains encrypted and is revealable only by the winner");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
