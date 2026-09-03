import { Contract, ZeroAddress, ZeroHash, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import type { FhevmInstance, FhevmInstanceConfig } from "@zama-fhe/relayer-sdk/bundle";
import { UNVEIL_CONTRACTS, UNVEIL_NETWORK } from "./contracts";
import type { DrawAction, DrawLifecycleStage } from "./lib/drawAdvance";
import { readWithdrawalRequest } from "./veilClient";
import { SEPOLIA_READ_RPC_URLS, sepoliaReadProvider } from "./lib/sepoliaReadProvider";

const SEPOLIA_RPC_URL = SEPOLIA_READ_RPC_URLS[0];
const HISTORY_LIMIT = 20n;
const WITHDRAWAL_LOOKBACK = 32n;
const SHARD_COUNT = 24;
const PRIZE_SLOTS = 3;
const readProvider = sepoliaReadProvider;

const POOL_V4_ABI = [
  "function joined(address) view returns (bool)",
  "function seated(address) view returns (bool)",
  "function seatExpiresAt(address) view returns (uint64)",
  "function playerCount() view returns (uint16)",
  "function nextRoundId() view returns (uint256)",
  "function nextDrawOpensAt() view returns (uint64)",
  "function nextDrawClosesAt() view returns (uint64)",
  "function seatKeeper() view returns (address)",
  "function getDrawState(uint256 roundId) view returns (uint8)",
  "function getDrawInfo(uint256 roundId) view returns (uint64 snapshotBlock,uint16 participantCount,uint8 drawnPrizeCount,uint8 finalizedPrizeCount,uint8 winningPrizeCount,uint8 state)",
  "function getShardedSnapshotRound(uint256 roundId) view returns (uint64 startedBlock,uint64 finalizedBlock,uint16 participantCount,uint8 processedShardCount,bool begun,bool finalized)",
  "function getSnapshotShard(uint256 roundId,uint8 shard) view returns (uint8 participantCount,bool processed)",
  "function getShardedPrizeStatus(uint256 roundId,uint8 prizeIndex) view returns (bool shardDrawn,bool shardFinalized,uint8 shard,bool winnerDrawn,bool winnerFinalized,address winner)",
  "function getEncryptedPrizeShard(uint256 roundId,uint8 prizeIndex) view returns (bytes32)",
  "function getEncryptedPrizeWinner(uint256 roundId,uint8 prizeIndex) view returns (bytes32)",
  "function getPrizeWinner(uint256 roundId,uint8 prizeIndex) view returns (address)",
] as const;

const SEAT_KEEPER_V4_ABI = [
  "function getDrawAvailability() view returns (uint8)",
  "function getDrawSchedule() view returns (uint256 currentRoundId,uint256 unsettledRounds,uint64 opensAt,uint64 closesAt,bool timeReady,bool snapshotRequired,bool canAdvance,bool insufficientParticipants,bool overdue)",
  "function pendingSeatAttestationRequestId(address) view returns (uint256)",
  "function encryptedSeatAttestationOf(address) view returns (bytes32)",
] as const;

const PRIZE_V3_ABI = [
  "function roundStatus(uint256 roundId) view returns (bool funded,uint8 deliveredCount,bool delivered)",
  "function prizeStatus(uint256 roundId,uint8 prizeIndex) view returns (bool processed,address winner)",
  "function encryptedPrizeOf(uint256 roundId,uint8 prizeIndex) view returns (bytes32)",
] as const;

const MANAGER_V3_ABI = [
  "function nextPrizeRoundId() view returns (uint256)",
  "function nextWithdrawalRequestId() view returns (uint256)",
  "function withdrawalRequest(uint256 requestId) view returns (address account,bytes32 amount,bytes32 remaining,bytes32 paid,bytes32 completed,uint256 createdWithdrawalBatchId,uint256 createdWithdrawalFundingNonce,bool exists,bool canceled,bool settled)",
] as const;

export const DRAW_STATES_V4 = {
  NONE: 0,
  SNAPSHOTTED: 1,
  DRAWN: 2,
  FINALIZED: 3,
  CANCELLED: 4,
  SKIPPED: 5,
} as const;

export type V4DrawSchedule = {
  currentRoundId: bigint;
  unsettledRounds: bigint;
  opensAt: bigint;
  closesAt: bigint;
  timeReady: boolean;
  ready: boolean;
  canAdvance: boolean;
  insufficientParticipants: boolean;
  overdue: boolean;
  availability: number;
};

export type V4PrizeResult = {
  index: number;
  shard: number;
  winner: string;
  delivered: boolean;
};

export type VerifiedRoundV4 = {
  id: bigint;
  snapshotBlock: bigint;
  participantCount: number;
  state: number;
  status: "FINALIZED" | "CANCELLED" | "SKIPPED";
  winner?: string;
  processedPrize: boolean;
  prizes: V4PrizeResult[];
};

export type V4DrawAdvancement = {
  schedule: V4DrawSchedule;
  nextPrizeRoundId: bigint;
  action: DrawAction;
};

type ZamaRelayerSDK = {
  initSDK: (options?: Record<string, unknown>) => Promise<boolean>;
  createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;
  SepoliaConfig: FhevmInstanceConfig & { relayerUrl: string };
  __initialized__?: boolean;
};

type BrowserEthereum = Eip1193Provider & {
  isMetaMask?: boolean;
  providers?: BrowserEthereum[];
  on?: {
    (event: "accountsChanged", listener: (accounts: string[]) => void): void;
    (event: "chainChanged", listener: (chainId: string) => void): void;
    (event: "disconnect", listener: (error: unknown) => void): void;
  };
  removeListener?: {
    (event: "accountsChanged", listener: (accounts: string[]) => void): void;
    (event: "chainChanged", listener: (chainId: string) => void): void;
    (event: "disconnect", listener: (error: unknown) => void): void;
  };
};

declare global {
  interface Window {
    ethereum?: BrowserEthereum;
    relayerSDK?: ZamaRelayerSDK;
  }
}

let v4RelayerPromise: Promise<FhevmInstance> | null = null;
let v4SdkPromise: Promise<boolean> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function injectedProvider(): BrowserEthereum {
  const root = window.ethereum;
  if (!root) throw new Error("No injected wallet found. Install MetaMask to use the live Sepolia demo.");
  const providers = root.providers?.length ? root.providers : [root];
  return providers.find((provider) => provider.isMetaMask) ?? root;
}

export function resetV4Relayer() {
  v4RelayerPromise = null;
}

async function initializeV4Sdk() {
  const sdk = window.relayerSDK;
  if (!sdk) throw new Error("Zama Relayer SDK browser bundle did not load. Check cdn.zama.org connectivity and retry.");
  if (sdk.__initialized__ === true) return true;
  if (!v4SdkPromise) {
    v4SdkPromise = sdk
      .initSDK()
      .then((result) => {
        if (!result) throw new Error("Zama Relayer SDK initialization returned false.");
        sdk.__initialized__ = true;
        return true;
      })
      .catch((error) => {
        v4SdkPromise = null;
        throw error;
      });
  }
  return v4SdkPromise;
}

async function v4Relayer() {
  if (!v4RelayerPromise) {
    await initializeV4Sdk();
    const sdk = window.relayerSDK;
    if (!sdk) throw new Error("Zama Relayer SDK browser bundle is unavailable.");
    const baseConfig = sdk.SepoliaConfig;
    const relayerUrl = baseConfig.relayerUrl.endsWith("/v2") ? baseConfig.relayerUrl : `${baseConfig.relayerUrl}/v2`;
    v4RelayerPromise = withTimeout(
      sdk.createInstance({ ...baseConfig, relayerUrl, relayerRouteVersion: 2, network: injectedProvider() }),
      60_000,
      "Zama relayer instance creation timed out. Check relayer connectivity and retry.",
    ).catch((error) => {
      v4RelayerPromise = null;
      throw error;
    });
  }
  return v4RelayerPromise;
}

async function userDecryptOne(signer: JsonRpcSigner, handle: string, contractAddress: string) {
  if (handle === ZeroHash) return 0n;
  const fhe = await v4Relayer();
  const address = await signer.getAddress();
  const keypair = fhe.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [contractAddress];
  const eip712 = fhe.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );
  const result = await withTimeout(
    fhe.userDecrypt(
      [{ handle, contractAddress }],
      keypair.privateKey,
      keypair.publicKey,
      signature.replace("0x", ""),
      contractAddresses,
      address,
      startTimestamp,
      durationDays,
    ),
    60_000,
    "Private prize decryption timed out. Check network connectivity and retry.",
  );
  return BigInt(result[handle as `0x${string}`] as bigint | string);
}

async function readContractsV4() {
  const pool = new Contract(UNVEIL_CONTRACTS.pool, POOL_V4_ABI, readProvider);
  const seatKeeperAddress = String(await pool.seatKeeper());
  return {
    pool,
    seatKeeper: new Contract(seatKeeperAddress, SEAT_KEEPER_V4_ABI, readProvider),
    prizeVault: new Contract(UNVEIL_CONTRACTS.prizeVault, PRIZE_V3_ABI, readProvider),
    manager: new Contract(UNVEIL_CONTRACTS.manager, MANAGER_V3_ABI, readProvider),
  };
}

async function writeContractsV4(signer: JsonRpcSigner) {
  return { prizeVault: new Contract(UNVEIL_CONTRACTS.prizeVault, PRIZE_V3_ABI, signer) };
}

function normalizeSchedule(
  schedule: {
    currentRoundId: bigint | string | number;
    unsettledRounds: bigint | string | number;
    opensAt: bigint | string | number;
    closesAt: bigint | string | number;
    timeReady: boolean;
    snapshotRequired: boolean;
    canAdvance: boolean;
    insufficientParticipants: boolean;
    overdue: boolean;
  },
  availability: number,
): V4DrawSchedule {
  return {
    currentRoundId: BigInt(schedule.currentRoundId),
    unsettledRounds: BigInt(schedule.unsettledRounds),
    opensAt: BigInt(schedule.opensAt),
    closesAt: BigInt(schedule.closesAt),
    timeReady: Boolean(schedule.timeReady),
    ready: Boolean(schedule.snapshotRequired),
    canAdvance: Boolean(schedule.canAdvance),
    insufficientParticipants: Boolean(schedule.insufficientParticipants),
    overdue: Boolean(schedule.overdue),
    availability,
  };
}

function action(
  kind: DrawAction["kind"],
  roundId: bigint,
  title: string,
  description: string,
  actionable: boolean,
  stage: DrawLifecycleStage,
  extra: Pick<DrawAction, "shardIndex" | "prizeIndex"> = {},
): DrawAction {
  return { kind, roundId, title, description, actionable, stage, ...extra };
}

async function pendingFundedPrizeAction(prizeVault: Contract, nextPrizeRoundId: bigint) {
  if (nextPrizeRoundId <= 1n) return undefined;
  const first = nextPrizeRoundId > HISTORY_LIMIT ? nextPrizeRoundId - HISTORY_LIMIT : 1n;
  for (let roundId = first; roundId < nextPrizeRoundId; roundId++) {
    const status = await prizeVault.roundStatus(roundId);
    if (Boolean(status.funded) && !Boolean(status.delivered)) {
      const prizeIndex = Number(status.deliveredCount);
      return action(
        "DELIVER_PRIZE",
        roundId,
        `DELIVER PRIZE ${prizeIndex + 1}/3`,
        "Deliver one bounded confidential strategy-share prize to its verified winner.",
        true,
        "DELIVER",
        { prizeIndex },
      );
    }
  }
  return undefined;
}

async function nextSnapshotAction(pool: Contract, roundId: bigint) {
  const snapshot = await pool.getShardedSnapshotRound(roundId);
  if (!Boolean(snapshot.begun)) {
    return action(
      "BLOCKED",
      roundId,
      "SNAPSHOT STATE NEEDS REVIEW",
      "The pool reports a snapshotted round without a begun sharded snapshot.",
      false,
      "BLOCKED",
    );
  }
  if (!Boolean(snapshot.finalized)) {
    if (Number(snapshot.processedShardCount) < SHARD_COUNT) {
      const shardStates = await Promise.all(
        Array.from({ length: SHARD_COUNT }, (_, shard) => pool.getSnapshotShard(roundId, shard)),
      );
      const shardIndex = shardStates.findIndex((status) => !Boolean(status.processed));
      if (shardIndex < 0) {
        return action(
          "BLOCKED",
          roundId,
          "SHARD SNAPSHOT STATE NEEDS REVIEW",
          "The processed-shard count and shard flags disagree.",
          false,
          "BLOCKED",
        );
      }
      return action(
        "SNAPSHOT_SHARD",
        roundId,
        `SNAPSHOT SHARD ${shardIndex + 1}/24`,
        "Checkpoint the next greedy batch of historical shards under both published HCU limits.",
        true,
        "SNAPSHOT",
        { shardIndex },
      );
    }
    return action(
      "COMPLETE_SNAPSHOT",
      roundId,
      "COMPLETE SHARDED SNAPSHOT",
      "Finalize the 24-shard checkpoint, or mark the round skipped if fewer than two mature seats exist.",
      true,
      "SNAPSHOT",
    );
  }

  for (let prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
    const status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
    if (!Boolean(status.shardDrawn)) {
      return action(
        "DRAW_SHARD",
        roundId,
        `DRAW PRIZE ${prizeIndex + 1} SHARD`,
        "Run encrypted weighted selection across the 24 private shard totals.",
        true,
        "BLIND_DRAW",
        { prizeIndex },
      );
    }
    if (!Boolean(status.shardFinalized)) {
      return action(
        "FINALIZE_SHARD",
        roundId,
        `VERIFY PRIZE ${prizeIndex + 1} SHARD`,
        "Publicly decrypt only the selected shard index and verify it with the Zama KMS proof.",
        true,
        "VERIFY",
        { prizeIndex },
      );
    }
    if (!Boolean(status.winnerDrawn)) {
      return action(
        "DRAW_MEMBER",
        roundId,
        `DRAW PRIZE ${prizeIndex + 1} MEMBER`,
        "Run encrypted weighted selection only inside the KMS-verified winning shard.",
        true,
        "BLIND_DRAW",
        { prizeIndex, shardIndex: Number(status.shard) },
      );
    }
    if (!Boolean(status.winnerFinalized)) {
      return action(
        "FINALIZE_MEMBER",
        roundId,
        `VERIFY PRIZE ${prizeIndex + 1} WINNER`,
        "Publicly decrypt only the selected member address and verify it with the Zama KMS proof.",
        true,
        "VERIFY",
        { prizeIndex, shardIndex: Number(status.shard) },
      );
    }
  }

  return action(
    "BLOCKED",
    roundId,
    "DRAW STATE IS SETTLING",
    "All prize slots appear finalized but the round state has not advanced yet. Refresh before submitting another write.",
    false,
    "BLOCKED",
  );
}

async function readDrawAdvancementFromContracts(
  pool: Contract,
  seatKeeper: Contract,
  manager: Contract,
  prizeVault: Contract,
): Promise<V4DrawAdvancement> {
  const [rawSchedule, rawAvailability, rawNextPrizeRoundId] = await Promise.all([
    seatKeeper.getDrawSchedule(),
    seatKeeper.getDrawAvailability(),
    manager.nextPrizeRoundId(),
  ]);
  const schedule = normalizeSchedule(rawSchedule, Number(rawAvailability));
  const nextPrizeRoundId = BigInt(rawNextPrizeRoundId);

  const pendingDelivery = await pendingFundedPrizeAction(prizeVault, nextPrizeRoundId);
  if (pendingDelivery) return { schedule, nextPrizeRoundId, action: pendingDelivery };

  if (nextPrizeRoundId < schedule.currentRoundId) {
    const state = Number(await pool.getDrawState(nextPrizeRoundId));
    if (state === DRAW_STATES_V4.SNAPSHOTTED || state === DRAW_STATES_V4.DRAWN) {
      return { schedule, nextPrizeRoundId, action: await nextSnapshotAction(pool, nextPrizeRoundId) };
    }
    if (state === DRAW_STATES_V4.FINALIZED) {
      const prizeRound = await prizeVault.roundStatus(nextPrizeRoundId);
      if (Boolean(prizeRound.funded)) {
        if (!Boolean(prizeRound.delivered)) {
          const prizeIndex = Number(prizeRound.deliveredCount);
          return {
            schedule,
            nextPrizeRoundId,
            action: action(
              "DELIVER_PRIZE",
              nextPrizeRoundId,
              `DELIVER PRIZE ${prizeIndex + 1}/3`,
              "Deliver one bounded confidential strategy-share prize to its verified winner.",
              true,
              "DELIVER",
              { prizeIndex },
            ),
          };
        }
        return {
          schedule,
          nextPrizeRoundId,
          action: action(
            "BLOCKED",
            nextPrizeRoundId,
            "PRIZE POINTER NEEDS REVIEW",
            "The round is already fully delivered while the manager pointer still targets it.",
            false,
            "BLOCKED",
          ),
        };
      }
      return {
        schedule,
        nextPrizeRoundId,
        action: action(
          "FUND_PRIZE",
          nextPrizeRoundId,
          "FUND THREE PRIZE SLOTS",
          "Move only the current safe confidential strategy-share surplus into the V3 prize vault for this finalized round.",
          true,
          "DELIVER",
        ),
      };
    }
    if (state === DRAW_STATES_V4.CANCELLED || state === DRAW_STATES_V4.SKIPPED) {
      return {
        schedule,
        nextPrizeRoundId,
        action: action(
          "ADVANCE_NO_PRIZE",
          nextPrizeRoundId,
          "COMPLETE ROUND",
          "No prize is due. Advance the manager pointer over this cancelled or skipped round.",
          true,
          "COMPLETE",
        ),
      };
    }
    return {
      schedule,
      nextPrizeRoundId,
      action: action(
        "BLOCKED",
        nextPrizeRoundId,
        "PROTOCOL STATE NEEDS REVIEW",
        `Round ${nextPrizeRoundId} is behind the schedule but remains in state ${state}.`,
        false,
        "BLOCKED",
      ),
    };
  }

  if (nextPrizeRoundId > schedule.currentRoundId) {
    return {
      schedule,
      nextPrizeRoundId,
      action: action(
        "BLOCKED",
        nextPrizeRoundId,
        "PROTOCOL STATE NEEDS REVIEW",
        "The public prize pointer is ahead of the scheduled draw.",
        false,
        "BLOCKED",
      ),
    };
  }

  if (schedule.ready || schedule.timeReady) {
    return {
      schedule,
      nextPrizeRoundId,
      action: action(
        "BEGIN_SNAPSHOT",
        schedule.currentRoundId,
        "BEGIN SHARDED SNAPSHOT",
        "Open the closed round checkpoint and move scheduling forward before processing its 24 bounded shards.",
        true,
        "SNAPSHOT",
      ),
    };
  }

  return {
    schedule,
    nextPrizeRoundId,
    action: action(
      "WAIT",
      schedule.currentRoundId,
      "WAITING FOR SCHEDULED CLOSE",
      "The current draw remains open until its scheduled close.",
      false,
      "WAIT",
    ),
  };
}

export async function readDrawAdvancementV4() {
  const { pool, seatKeeper, manager, prizeVault } = await readContractsV4();
  return readDrawAdvancementFromContracts(pool, seatKeeper, manager, prizeVault);
}

async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRoundV4[]> {
  if (latestRound === 0n) return [];
  const { pool, prizeVault } = await readContractsV4();
  const first = latestRound > HISTORY_LIMIT ? latestRound - HISTORY_LIMIT + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = latestRound; id >= first; id--) ids.push(id);

  const rounds = await Promise.all(
    ids.map(async (id): Promise<VerifiedRoundV4 | null> => {
      try {
        const draw = await pool.getDrawInfo(id);
        const state = Number(draw.state);
        if (
          state !== DRAW_STATES_V4.FINALIZED &&
          state !== DRAW_STATES_V4.CANCELLED &&
          state !== DRAW_STATES_V4.SKIPPED
        ) {
          return null;
        }

        if (state === DRAW_STATES_V4.FINALIZED) {
          const prizes = await Promise.all(
            Array.from({ length: PRIZE_SLOTS }, async (_, index): Promise<V4PrizeResult> => {
              const [status, delivery] = await Promise.all([
                pool.getShardedPrizeStatus(id, index),
                prizeVault.prizeStatus(id, index),
              ]);
              return {
                index,
                shard: Number(status.shard),
                winner: String(status.winner),
                delivered: Boolean(delivery.processed),
              };
            }),
          );
          const firstWinner = prizes.find((prize) => prize.winner !== ZeroAddress)?.winner;
          return {
            id,
            snapshotBlock: BigInt(draw.snapshotBlock),
            participantCount: Number(draw.participantCount),
            state,
            status: "FINALIZED",
            winner: firstWinner,
            processedPrize: prizes.every((prize) => prize.delivered),
            prizes,
          };
        }

        return {
          id,
          snapshotBlock: BigInt(draw.snapshotBlock),
          participantCount: Number(draw.participantCount),
          state,
          status: state === DRAW_STATES_V4.CANCELLED ? "CANCELLED" : "SKIPPED",
          processedPrize: false,
          prizes: [],
        };
      } catch {
        return null;
      }
    }),
  );

  return rounds.filter((round): round is VerifiedRoundV4 => round !== null);
}

async function readLatestWithdrawal(address: string, nextRequestId: bigint) {
  const lowerBound = nextRequestId > WITHDRAWAL_LOOKBACK ? nextRequestId - WITHDRAWAL_LOOKBACK : 1n;
  const { manager } = await readContractsV4();
  const ids: bigint[] = [];
  for (let id = nextRequestId - 1n; id >= lowerBound && id > 0n; id--) ids.push(id);
  const candidates = await Promise.all(
    ids.map(async (requestId) => {
      try {
        const request = await manager.withdrawalRequest(requestId);
        return Boolean(request.exists) ? { requestId, account: String(request.account) } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const latest = candidates.find((candidate) => candidate?.account.toLowerCase() === address.toLowerCase());
  return latest ? readWithdrawalRequest(latest.requestId) : undefined;
}

export async function readDashboardV4(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { pool, seatKeeper, manager, prizeVault } = await readContractsV4();
  const [
    joined,
    seated,
    seatExpiresAt,
    playerCount,
    pendingSeatAttestationRequestId,
    advancement,
    nextWithdrawalRequestId,
  ] = await Promise.all([
    pool.joined(address),
    pool.seated(address),
    pool.seatExpiresAt(address),
    pool.playerCount(),
    seatKeeper.pendingSeatAttestationRequestId(address),
    readDrawAdvancementFromContracts(pool, seatKeeper, manager, prizeVault),
    manager.nextWithdrawalRequestId(),
  ]);
  const latestRound = advancement.schedule.currentRoundId > 1n ? advancement.schedule.currentRoundId - 1n : 0n;
  const [history, latestWithdrawal] = await Promise.all([
    readVerifiedRounds(latestRound),
    readLatestWithdrawal(address, BigInt(nextWithdrawalRequestId)),
  ]);
  return {
    joined: Boolean(joined),
    seated: Boolean(seated),
    pendingSeatAttestationRequestId: BigInt(pendingSeatAttestationRequestId),
    pendingSeatAttestation: BigInt(pendingSeatAttestationRequestId) !== 0n,
    seatExpiresAt: BigInt(seatExpiresAt),
    playerCount: Number(playerCount),
    nextRoundId: advancement.schedule.currentRoundId,
    latestRound,
    schedule: advancement.schedule,
    nextPrizeRoundId: advancement.nextPrizeRoundId,
    drawAction: advancement.action,
    nextWithdrawalRequestId: BigInt(nextWithdrawalRequestId),
    latestWithdrawal,
    latestFinalized: history.find((round) => round.status === "FINALIZED"),
    history,
  };
}

export async function readPublicProtocolV4() {
  const { pool, seatKeeper, manager, prizeVault } = await readContractsV4();
  const [advancement, playerCount] = await Promise.all([
    readDrawAdvancementFromContracts(pool, seatKeeper, manager, prizeVault),
    pool.playerCount(),
  ]);
  const latestRound = advancement.schedule.currentRoundId > 1n ? advancement.schedule.currentRoundId - 1n : 0n;
  const history = await readVerifiedRounds(latestRound);
  return {
    schedule: advancement.schedule,
    nextPrizeRoundId: advancement.nextPrizeRoundId,
    drawAction: advancement.action,
    playerCount: Number(playerCount),
    latestRound,
    latestFinalized: history.find((round) => round.status === "FINALIZED"),
    history,
  };
}

export function isConnectedWinnerV4(address: string, round?: VerifiedRoundV4) {
  if (!address || !round) return false;
  return round.prizes.some(
    (prize) => prize.winner !== ZeroAddress && prize.winner.toLowerCase() === address.toLowerCase(),
  );
}

export function deliveredPrizesForAddressV4(history: VerifiedRoundV4[], address: string) {
  if (!address) return [];
  return history.filter(
    (round) =>
      round.status === "FINALIZED" &&
      round.prizes.some(
        (prize) =>
          prize.delivered && prize.winner !== ZeroAddress && prize.winner.toLowerCase() === address.toLowerCase(),
      ),
  );
}

export function deliveredPrizeSlotForRoundV4(history: VerifiedRoundV4[], address: string, roundId: bigint) {
  const round = history.find((candidate) => candidate.id === roundId && candidate.status === "FINALIZED");
  if (!round || !address) return undefined;
  const prize = round.prizes.find(
    (candidate) =>
      candidate.delivered &&
      candidate.winner !== ZeroAddress &&
      candidate.winner.toLowerCase() === address.toLowerCase(),
  );
  return prize ? { round, prize } : undefined;
}

export async function revealPrizeV4(signer: JsonRpcSigner, roundId: bigint, prizeIndex: number) {
  if (prizeIndex < 0 || prizeIndex >= PRIZE_SLOTS) throw new Error("Invalid V4 prize index.");
  try {
    const prizeVault = (await writeContractsV4(signer)).prizeVault;
    const handle = String(await prizeVault.encryptedPrizeOf(roundId, prizeIndex));
    return await userDecryptOne(signer, handle, UNVEIL_CONTRACTS.prizeVault);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(`UNVEIL_PRIZE_WINNER_ONLY:${message ? ` ${message}` : ""}`);
  }
}

/** Permissionless keeper maintenance. This never decrypts or accepts a balance amount. */
