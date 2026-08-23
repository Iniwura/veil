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

async function settleYieldCursor(
  keeper: HardhatEthersSigner,
  pool: VeilPool,
  yieldSource: VeilYieldSource,
  prizeVault: VeilPrizeVault,
  latestRoundId: bigint,
) {
  let cursor = await yieldSource.yieldRoundId();

  while (cursor <= latestRoundId) {
    const draw = await pool.getDrawInfo(cursor);
    const state = Number(draw.state);

    if (state === 4) {
      console.log(`  carrying encrypted yield through cancelled round ${cursor}...`);
      await (await yieldSource.connect(keeper).carryCancelledYield(cursor)).wait();
      cursor = await yieldSource.yieldRoundId();
      continue;
    }

    if (state !== 3) {
      console.log(`  yield cursor is waiting for round ${cursor}; current state=${draw.state}`);
      break;
    }

    console.log(`  routing the encrypted yield bucket to predetermined round ${cursor}...`);
    await (await yieldSource.connect(keeper).allocateRoundYield(cursor)).wait();

    const prize = await prizeVault.prizeStatus(cursor);
    if (prize.funded && !prize.claimed) {
      console.log(`  delivering round ${cursor} prize to its proof-finalized winner...`);
      await (await prizeVault.connect(keeper).deliverPrize(cursor)).wait();
    }

    cursor = await yieldSource.yieldRoundId();
  }

  return cursor;
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
  console.log(`  keeper:       ${keeper.address}`);
  console.log(`  pool:         ${poolAddress}`);
  console.log(`  next round:   ${nextRoundId}`);
  console.log(`  next close:   ${closesAt}`);
  console.log(`  yield cursor: ${await yieldSource.yieldRoundId()}`);

  if (now >= closesAt) {
    console.log("1/5 Closing elapsed draw and freezing encrypted weights...");
    const before = await pool.nextRoundId();
    await (await pool.connect(keeper).closeDraw()).wait();
    const after = await pool.nextRoundId();
    if (after === before) {
      console.log("  period skipped because fewer than two eligible positions were present at the scheduled close");
    }
  } else {
    console.log(`1/5 Draw still open for ${closesAt - now}s; no privileged early close is possible.`);
  }

  const latestRoundId = (await pool.nextRoundId()) - 1n;
  if (latestRoundId <= 0n) {
    console.log("No snapshotted round exists yet.");
    return;
  }

  let draw = await pool.getDrawInfo(latestRoundId);

  if (Number(draw.state) === 1) {
    console.log(`2/5 Running FHE BlindDraw for round ${latestRoundId}...`);
    await (await pool.connect(keeper).blindDraw(latestRoundId)).wait();
    draw = await pool.getDrawInfo(latestRoundId);
  } else {
    console.log(`2/5 BlindDraw step already advanced; current state=${draw.state}`);
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

  if (Number(draw.state) === 3) {
    console.log(`  winner: ${await pool.getWinner(latestRoundId)}`);
  } else if (Number(draw.state) === 4) {
    console.log(`  round ${latestRoundId} is KMS-proven CANCELLED; its encrypted yield will carry forward.`);
  } else {
    console.log(`  round ${latestRoundId} is not settled yet; current state=${draw.state}`);
  }

  console.log("4/5 Settling sequential confidential yield without caller-selected round routing...");
  const nextYieldRound = await settleYieldCursor(keeper, pool, yieldSource, prizeVault, latestRoundId);

  console.log("5/5 Checking latest-round payout state...");
  if (Number(draw.state) === 3) {
    const prize = await prizeVault.prizeStatus(latestRoundId);
    if (prize.funded && !prize.claimed) {
      await (await prizeVault.connect(keeper).deliverPrize(latestRoundId)).wait();
    }
    const finalStatus = await prizeVault.prizeStatus(latestRoundId);
    console.log(`  funded:    ${finalStatus.funded}`);
    console.log(`  delivered: ${finalStatus.claimed}`);
  } else {
    console.log("  no payout is created for a cancelled or unfinished round");
  }

  console.log("\nUNVEIL keeper run complete");
  console.log(`  latest round:      ${latestRoundId}`);
  console.log(`  next yield cursor: ${nextYieldRound}`);
  console.log("  note: the keeper cannot choose a prize beneficiary or decrypt any prize amount");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
