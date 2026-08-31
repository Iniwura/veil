import { Contract, ethers } from "ethers";
import { deployments, ethers as hardhatEthers, fhevm, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { V4_DEPLOYMENT_NAMES } from "../deploy/deploy-v4";
import { planShardedSnapshotBatches, type HistoricalShardWidth } from "./sharded-snapshot-hcu-budget";

const SHARD_COUNT = 24;
const PRIZE_SLOTS = 3;
const DEFAULT_MAX_STEPS = 32;
const DEFAULT_REFRESH_WINDOW_SECONDS = 6 * 60 * 60;
const HISTORY_LOOKBACK = 64n;
let fheCliInitialized = false;

const POOL_ABI = [
  "function seatKeeper() view returns (address)",
  "function seated(address) view returns (bool)",
  "function seatExpiresAt(address) view returns (uint64)",
  "function nextRoundId() view returns (uint256)",
  "function nextDrawClosesAt() view returns (uint64)",
  "function getDrawState(uint256) view returns (uint8)",
  "function getShardedSnapshotRound(uint256) view returns (uint64,uint64,uint16,uint8,bool,bool)",
  "function getSnapshotShard(uint256,uint8) view returns (uint8,bool)",
  "function beginSnapshotRound() returns (uint256)",
  "function completeSnapshotRound(uint256)",
  "function shardPlayerCount(uint8) view returns (uint8)",
  "function shardStateEpochCount(uint8) view returns (uint256)",
  "function getShardEpoch(uint8,uint256) view returns (uint256,uint256,uint8)",
  "function drawPrizeShard(uint256,uint8)",
  "function getShardedPrizeStatus(uint256,uint8) view returns (bool,bool,uint8,bool,bool,address)",
  "function getEncryptedPrizeShard(uint256,uint8) view returns (bytes32)",
  "function getEncryptedPrizeWinner(uint256,uint8) view returns (bytes32)",
  "function finalizePrizeMember(uint256,uint8,bytes,bytes)",
  "event ShardedSeatRenewed(address indexed player,uint8 indexed shard,uint64 expiresAt,uint256 eligibleFromRoundId)",
] as const;

const SEAT_KEEPER_ABI = [
  "function getDrawSchedule() view returns (uint256 currentRoundId,uint256 unsettledRounds,uint64 opensAt,uint64 closesAt,bool timeReady,bool snapshotRequired,bool canAdvance,bool insufficientParticipants,bool overdue)",
  "function pendingSeatAttestationRequestId(address) view returns (uint256)",
  "function encryptedSeatAttestationOf(address) view returns (bytes32)",
  "function refreshSeatAttestation(address)",
  "function finalizeSeatAttestation(address,uint256,bool,bytes)",
  "event SeatAttestationRequested(address indexed account,uint256 indexed requestId)",
] as const;

const SNAPSHOT_BATCHER_ABI = [
  "function beginAndSnapshotShards(uint8[])",
  "function beginSnapshotShardsAndComplete(uint8[])",
  "function snapshotShards(uint256,uint8[])",
  "function snapshotShardsAndComplete(uint256,uint8[])",
] as const;

const DRAW_BATCHER_ABI = ["function finalizePrizeShardAndDrawMember(uint256,uint8,uint8,bytes)"] as const;

const MANAGER_ABI = ["function nextPrizeRoundId() view returns (uint256)", "function processNextPrizeRound()"] as const;

const PRIZE_VAULT_ABI = [
  "function roundStatus(uint256) view returns (bool,uint8,bool)",
  "function deliverPrize(uint256,uint8)",
] as const;

const ADDRESS_ENV = {
  pool: "UNVEIL_V4_POOL_ADDRESS",
  snapshotBatcher: "UNVEIL_V4_SNAPSHOT_BATCHER_ADDRESS",
  drawBatcher: "UNVEIL_V4_DRAW_BATCHER_ADDRESS",
  prizeVault: "UNVEIL_V4_PRIZE_VAULT_ADDRESS",
  manager: "UNVEIL_V4_MANAGER_ADDRESS",
} as const;

type AddressKey = keyof typeof ADDRESS_ENV;
type KeeperContracts = {
  pool: Contract;
  seatKeeper: Contract;
  snapshotBatcher: Contract;
  drawBatcher: Contract;
  manager: Contract;
  prizeVault: Contract;
};

export type KeeperCycleResult = {
  transactions: number;
  actions: string[];
  idle: boolean;
};

function configuredInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be a decimal integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function resolveAddress(key: AddressKey): Promise<string> {
  const envName = ADDRESS_ENV[key];
  const configured = process.env[envName]?.trim();
  if (configured) {
    if (!ethers.isAddress(configured)) throw new Error(`${envName} is not a valid address`);
    return configured;
  }

  const deploymentName = V4_DEPLOYMENT_NAMES[key];
  const deployment = await deployments.getOrNull(deploymentName);
  if (!deployment) {
    throw new Error(`Missing ${deploymentName}; configure ${envName} for the deployed V4 stack.`);
  }
  return deployment.address;
}

async function loadContracts(signer?: HardhatEthersSigner): Promise<KeeperContracts> {
  const runner = signer ?? hardhatEthers.provider;
  const poolAddress = await resolveAddress("pool");
  const [snapshotAddress, drawAddress, prizeVaultAddress, managerAddress] = await Promise.all([
    resolveAddress("snapshotBatcher"),
    resolveAddress("drawBatcher"),
    resolveAddress("prizeVault"),
    resolveAddress("manager"),
  ]);
  const pool = new Contract(poolAddress, POOL_ABI, runner);
  const seatKeeper = new Contract(String(await pool.seatKeeper()), SEAT_KEEPER_ABI, runner);
  return {
    pool,
    seatKeeper,
    snapshotBatcher: new Contract(snapshotAddress, SNAPSHOT_BATCHER_ABI, runner),
    drawBatcher: new Contract(drawAddress, DRAW_BATCHER_ABI, runner),
    manager: new Contract(managerAddress, MANAGER_ABI, runner),
    prizeVault: new Contract(prizeVaultAddress, PRIZE_VAULT_ABI, runner),
  };
}

async function waitForTransaction(tx: { wait(): Promise<unknown> }): Promise<void> {
  await tx.wait();
}

function clearBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1" || value === "true";
}

async function publicDecrypt(handle: string): Promise<{ value: unknown; proof: string }> {
  if (!fheCliInitialized) {
    await fhevm.initializeCLIApi();
    fheCliInitialized = true;
  }
  const result = await fhevm.publicDecrypt([handle]);
  const values = result.clearValues as Record<string, unknown>;
  const value = Object.values(values)[0];
  return { value, proof: result.decryptionProof };
}

async function queryFromBlock(): Promise<number> {
  const configured = process.env.UNVEIL_V4_KEEPER_FROM_BLOCK?.trim();
  if (configured) return configuredInteger("UNVEIL_V4_KEEPER_FROM_BLOCK", 0, 0, Number.MAX_SAFE_INTEGER);
  const deployment = await deployments.getOrNull(V4_DEPLOYMENT_NAMES.pool);
  const blockNumber = deployment?.receipt?.blockNumber;
  return blockNumber === undefined ? 0 : Number(blockNumber);
}

async function discoverAccounts(contracts: KeeperContracts, fromBlock: number): Promise<string[]> {
  const latest = await hardhatEthers.provider.getBlockNumber();
  const accounts = new Set<string>();
  const requested = await contracts.seatKeeper.queryFilter(
    contracts.seatKeeper.filters.SeatAttestationRequested(),
    fromBlock,
    latest,
  );
  for (const event of requested) {
    const args = (event as { args?: { account?: string } }).args;
    if (args?.account) accounts.add(args.account);
  }
  const renewed = await contracts.pool.queryFilter(contracts.pool.filters.ShardedSeatRenewed(), fromBlock, latest);
  for (const event of renewed) {
    const args = (event as { args?: { player?: string } }).args;
    if (args?.player) accounts.add(args.player);
  }
  return [...accounts];
}

async function settleSeatAttestations(
  contracts: KeeperContracts,
  fromBlock: number,
  refreshWindow: number,
  actions: string[],
): Promise<number> {
  const accounts = await discoverAccounts(contracts, fromBlock);
  let transactions = 0;
  const now = BigInt((await hardhatEthers.provider.getBlock("latest"))?.timestamp ?? 0);

  for (const account of accounts) {
    const requestId = BigInt(await contracts.seatKeeper.pendingSeatAttestationRequestId(account));
    if (requestId !== 0n) {
      const currentRequestId = BigInt(await contracts.seatKeeper.pendingSeatAttestationRequestId(account));
      if (currentRequestId !== requestId) continue;
      const handle = String(await contracts.seatKeeper.encryptedSeatAttestationOf(account));
      const decrypted = await publicDecrypt(handle);
      const latestRequestId = BigInt(await contracts.seatKeeper.pendingSeatAttestationRequestId(account));
      if (latestRequestId !== requestId) continue;
      await waitForTransaction(
        await contracts.seatKeeper.finalizeSeatAttestation(
          account,
          requestId,
          clearBoolean(decrypted.value),
          decrypted.proof,
        ),
      );
      transactions++;
      actions.push(`finalize seat attestation ${account}`);
      continue;
    }

    const seated = Boolean(await contracts.pool.seated(account));
    if (!seated) continue;
    const expiresAt = BigInt(await contracts.pool.seatExpiresAt(account));
    if (expiresAt > now + BigInt(refreshWindow)) continue;
    const beforeRefresh = BigInt(await contracts.seatKeeper.pendingSeatAttestationRequestId(account));
    if (beforeRefresh !== 0n) continue;
    await waitForTransaction(await contracts.seatKeeper.refreshSeatAttestation(account));
    transactions++;
    actions.push(`refresh seat attestation ${account}`);
  }
  return transactions;
}

async function historicalSourceParticipantCount(pool: Contract, roundId: bigint, shard: number): Promise<number> {
  const epochCount = BigInt(await pool.shardStateEpochCount(shard));
  let low = 1n;
  let high = epochCount;
  while (low <= high) {
    const middle = low + (high - low) / 2n;
    const epoch = await pool.getShardEpoch(shard, middle);
    const startRoundId = BigInt(epoch[0]);
    const endRoundId = BigInt(epoch[1]);
    if (roundId < startRoundId) high = middle - 1n;
    else if (roundId > endRoundId) low = middle + 1n;
    else return Number(epoch[2]);
  }
  return Number(await pool.shardPlayerCount(shard));
}

async function historicalWidths(pool: Contract, roundId: bigint): Promise<HistoricalShardWidth[]> {
  const widths: HistoricalShardWidth[] = [];
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    const participants = await historicalSourceParticipantCount(pool, roundId, shard);
    if (participants > 0) widths.push({ shard, participants });
  }
  return widths;
}

async function beginSnapshot(contracts: KeeperContracts, roundId: bigint, actions: string[]): Promise<number> {
  const widths = await historicalWidths(contracts.pool, roundId);
  const plan = planShardedSnapshotBatches(widths);
  const liveRound = BigInt(await contracts.pool.nextRoundId());
  if (liveRound !== roundId) return 0;
  const liveState = Number(await contracts.pool.getDrawState(roundId));
  if (liveState !== 0) return 0;
  if (plan.length === 0) {
    await waitForTransaction(await contracts.pool.beginSnapshotRound());
    const begun = await contracts.pool.getShardedSnapshotRound(roundId);
    if (!begun[4] || begun[5]) return 1;
    const stateBeforeComplete = Number(await contracts.pool.getDrawState(roundId));
    if (stateBeforeComplete !== 1) return 1;
    await waitForTransaction(await contracts.pool.completeSnapshotRound(roundId));
    actions.push(`begin and skip empty round ${roundId}`);
    return 2;
  }
  if (plan.length === 1) {
    await waitForTransaction(await contracts.snapshotBatcher.beginSnapshotShardsAndComplete(plan[0].shards));
    actions.push(`begin, snapshot, complete round ${roundId} (${plan[0].shards.length} shards)`);
  } else {
    await waitForTransaction(await contracts.snapshotBatcher.beginAndSnapshotShards(plan[0].shards));
    actions.push(`begin and snapshot round ${roundId} (${plan[0].shards.length} shards)`);
  }
  return 1;
}

async function advanceSnapshot(contracts: KeeperContracts, roundId: bigint, actions: string[]): Promise<number> {
  const snapshot = await contracts.pool.getShardedSnapshotRound(roundId);
  if (snapshot[5]) return 0;
  const pending: HistoricalShardWidth[] = [];
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    const status = await contracts.pool.getSnapshotShard(roundId, shard);
    if (status[1]) continue;
    const participants = await historicalSourceParticipantCount(contracts.pool, roundId, shard);
    if (participants > 0) pending.push({ shard, participants });
  }
  if (pending.length === 0) {
    const current = await contracts.pool.getShardedSnapshotRound(roundId);
    if (Number(current[3]) !== SHARD_COUNT) return 0;
    await waitForTransaction(await contracts.pool.completeSnapshotRound(roundId));
    actions.push(`complete snapshot round ${roundId}`);
    return 1;
  }
  const plan = planShardedSnapshotBatches(pending);
  if (plan.length === 0) return 0;
  const live = await contracts.pool.getShardedSnapshotRound(roundId);
  if (live[5]) return 0;
  if (plan.length === 1) {
    await waitForTransaction(await contracts.snapshotBatcher.snapshotShardsAndComplete(roundId, plan[0].shards));
    actions.push(`snapshot and complete round ${roundId} (${plan[0].shards.length} shards)`);
  } else {
    await waitForTransaction(await contracts.snapshotBatcher.snapshotShards(roundId, plan[0].shards));
    actions.push(`snapshot round ${roundId} (${plan[0].shards.length} shards)`);
  }
  return 1;
}

async function advancePrize(contracts: KeeperContracts, roundId: bigint, actions: string[]): Promise<number> {
  for (let prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
    let status = await contracts.pool.getShardedPrizeStatus(roundId, prizeIndex);
    if (!status[0]) {
      const reread = await contracts.pool.getShardedPrizeStatus(roundId, prizeIndex);
      if (reread[0]) continue;
      await waitForTransaction(await contracts.pool.drawPrizeShard(roundId, prizeIndex));
      actions.push(`draw prize ${prizeIndex + 1} shard for round ${roundId}`);
      return 1;
    }
    if (!status[1]) {
      const handle = String(await contracts.pool.getEncryptedPrizeShard(roundId, prizeIndex));
      const decrypted = await publicDecrypt(handle);
      const shard = Number(decrypted.value);
      status = await contracts.pool.getShardedPrizeStatus(roundId, prizeIndex);
      if (status[1]) continue;
      await waitForTransaction(
        await contracts.drawBatcher.finalizePrizeShardAndDrawMember(roundId, prizeIndex, shard, decrypted.proof),
      );
      actions.push(`verify shard and draw member for prize ${prizeIndex + 1}, round ${roundId}`);
      return 1;
    }
    if (!status[3]) {
      const reread = await contracts.pool.getShardedPrizeStatus(roundId, prizeIndex);
      if (reread[3]) continue;
      throw new Error(`round ${roundId} prize ${prizeIndex} is not fused; refusing a separate member draw`);
    }
    if (!status[4]) {
      const handle = String(await contracts.pool.getEncryptedPrizeWinner(roundId, prizeIndex));
      const decrypted = await publicDecrypt(handle);
      const winner = ethers.getAddress(String(decrypted.value));
      const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [winner]);
      const reread = await contracts.pool.getShardedPrizeStatus(roundId, prizeIndex);
      if (reread[4]) continue;
      await waitForTransaction(
        await contracts.pool.finalizePrizeMember(roundId, prizeIndex, encodedWinner, decrypted.proof),
      );
      actions.push(`verify winner for prize ${prizeIndex + 1}, round ${roundId}`);
      return 1;
    }
  }
  return 0;
}

async function deliverPrize(contracts: KeeperContracts, actions: string[]): Promise<number> {
  const nextPrizeRoundId = BigInt(await contracts.manager.nextPrizeRoundId());
  const first = nextPrizeRoundId > HISTORY_LOOKBACK ? nextPrizeRoundId - HISTORY_LOOKBACK : 1n;
  for (let roundId = first; roundId < nextPrizeRoundId; roundId++) {
    const status = await contracts.prizeVault.roundStatus(roundId);
    if (!status[0] || status[2]) continue;
    const prizeIndex = Number(status[1]);
    const reread = await contracts.prizeVault.roundStatus(roundId);
    if (!reread[0] || reread[2]) continue;
    await waitForTransaction(await contracts.prizeVault.deliverPrize(roundId, prizeIndex));
    actions.push(`deliver prize ${prizeIndex + 1} for round ${roundId}`);
    return 1;
  }
  return 0;
}

async function advanceRound(contracts: KeeperContracts, actions: string[]): Promise<number> {
  const schedule = await contracts.seatKeeper.getDrawSchedule();
  const currentRoundId = BigInt(schedule[0]);
  const nextPrizeRoundId = BigInt(await contracts.manager.nextPrizeRoundId());

  if (nextPrizeRoundId < currentRoundId) {
    const state = Number(await contracts.pool.getDrawState(nextPrizeRoundId));
    if (state === 1) {
      const snapshot = await contracts.pool.getShardedSnapshotRound(nextPrizeRoundId);
      return snapshot[5]
        ? advancePrize(contracts, nextPrizeRoundId, actions)
        : advanceSnapshot(contracts, nextPrizeRoundId, actions);
    }
    if (state === 2) return advancePrize(contracts, nextPrizeRoundId, actions);
    if (state === 3 || state === 4 || state === 5) {
      const rereadState = Number(await contracts.pool.getDrawState(nextPrizeRoundId));
      if (rereadState !== state) return 0;
      await waitForTransaction(await contracts.manager.processNextPrizeRound());
      actions.push(`process round ${nextPrizeRoundId} (${state === 3 ? "fund" : "skip"})`);
      return 1;
    }
    return 0;
  }
  if (nextPrizeRoundId > currentRoundId) return 0;
  const timeReady = schedule[4];
  if (!timeReady) return 0;
  const liveRound = BigInt(await contracts.pool.nextRoundId());
  if (liveRound !== currentRoundId) return 0;
  return beginSnapshot(contracts, currentRoundId, actions);
}

/** Executes a bounded, idempotent keeper pass. Every write is preceded by a fresh state read. */
export async function runKeeperCycle(): Promise<KeeperCycleResult> {
  if (network.name !== "sepolia" && process.env.UNVEIL_V4_KEEPER_ALLOW_LOCAL !== "true") {
    throw new Error("Run the V4 keeper on Sepolia (set UNVEIL_V4_KEEPER_ALLOW_LOCAL=true only for a local demo).");
  }
  const [keeper] = (await hardhatEthers.getSigners()) as HardhatEthersSigner[];
  if (!keeper) throw new Error("No configured Hardhat network signer is available for the V4 keeper.");
  const contracts = await loadContracts(keeper);
  const actions: string[] = [];
  const fromBlock = await queryFromBlock();
  const refreshWindow = configuredInteger(
    "UNVEIL_V4_KEEPER_REFRESH_WINDOW_SECONDS",
    DEFAULT_REFRESH_WINDOW_SECONDS,
    0,
    30 * 24 * 60 * 60,
  );
  let transactions = await settleSeatAttestations(contracts, fromBlock, refreshWindow, actions);
  const maxSteps = configuredInteger("UNVEIL_V4_KEEPER_MAX_STEPS", DEFAULT_MAX_STEPS, 1, 256);
  for (let step = 0; step < maxSteps; step++) {
    const progressed = await deliverPrize(contracts, actions);
    if (progressed > 0) {
      transactions += progressed;
      continue;
    }
    const roundProgress = await advanceRound(contracts, actions);
    if (roundProgress === 0) break;
    transactions += roundProgress;
  }
  return { transactions, actions, idle: transactions === 0 };
}

async function main(): Promise<void> {
  const watch = process.argv.includes("--watch") || process.env.UNVEIL_V4_KEEPER_WATCH === "true";
  const intervalMs = configuredInteger("UNVEIL_V4_KEEPER_INTERVAL_MS", 30_000, 1_000, 3_600_000);
  for (let running = true; running; ) {
    try {
      const result = await runKeeperCycle();
      console.log(
        result.actions.length ? result.actions.map((action) => `V4 keeper: ${action}`).join("\n") : "V4 keeper: idle",
      );
    } catch (error) {
      console.error("V4 keeper cycle failed", error);
      if (!watch) throw error;
    }
    if (!watch) running = false;
    else await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
