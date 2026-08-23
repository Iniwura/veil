import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  type BrowserProvider as EthersBrowserProvider,
  type Eip1193Provider,
  type JsonRpcSigner,
} from "ethers";
import { VEIL_CONTRACTS, VEIL_NETWORK } from "./contracts";
import type { FhevmInstance, FhevmInstanceConfig } from "@zama-fhe/relayer-sdk/bundle";

type ZamaRelayerSDK = {
  initSDK: (options?: Record<string, unknown>) => Promise<boolean>;
  createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;
  SepoliaConfig: FhevmInstanceConfig & { relayerUrl: string };
  __initialized__?: boolean;
};

type EthereumProvider = Eip1193Provider & {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    relayerSDK?: ZamaRelayerSDK;
  }
}

const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL, VEIL_NETWORK.chainId, { staticNetwork: true });

const POOL_ABI = [
  "function joined(address) view returns (bool)",
  "function seated(address) view returns (bool)",
  "function seatExpiresAt(address) view returns (uint64)",
  "function playerCount() view returns (uint8)",
  "function nextRoundId() view returns (uint256)",
  "function drawPeriod() view returns (uint64)",
  "function nextDrawClosesAt() view returns (uint64)",
  "function encryptedBalanceOf() view returns (bytes32)",
  "function encryptedPosition() view returns (bytes32 balance,bytes32 totalDeposited,bytes32 totalWithdrawn,bytes32 lastDeposit,bytes32 lastWithdrawal)",
  "function encryptedSnapshotWeightOf(uint256 roundId) view returns (bytes32)",
  "function encryptedSnapshotTotalWeight(uint256 roundId) view returns (bytes32)",
  "function isSnapshotParticipant(uint256 roundId,address account) view returns (bool)",
  "function deposit(bytes32 encryptedAmount, bytes inputProof)",
  "function withdraw(bytes32 encryptedAmount, bytes inputProof)",
  "function renewDrawSeat()",
  "function closeDraw() returns (uint256)",
  "function blindDraw(uint256 roundId)",
  "function finalizeWinner(uint256 roundId,bytes abiEncodedClearWinner,bytes decryptionProof)",
  "function getDrawInfo(uint256 roundId) view returns (uint64 snapshotBlock,uint8 participantCount,uint8 state)",
  "function getDrawTiming(uint256 roundId) view returns (uint64 scheduledCloseAt,uint64 snapshotBlock)",
  "function getEncryptedWinner(uint256 roundId) view returns (bytes32)",
  "function getWinner(uint256 roundId) view returns (address)",
] as const;

const ASSET_ABI = [
  "function isOperator(address holder,address spender) view returns (bool)",
  "function setOperator(address operator,uint48 until)",
  "function mint(address to,uint64 amount)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;

const YIELD_ABI = [
  "function allocateAllToRound(uint256 roundId)",
  "function strategyOperator() view returns (address)",
] as const;

const PRIZE_ABI = [
  "function prizeStatus(uint256 roundId) view returns (bool funded,bool winnerAuthorized,bool claimed,address winner)",
  "function encryptedPrizeOf(uint256 roundId) view returns (bytes32)",
  "function authorizeWinner(uint256 roundId)",
  "function deliverPrize(uint256 roundId)",
] as const;

export type DrawState = 0 | 1 | 2 | 3 | 4;

export type RoundRecord = {
  id: bigint;
  scheduledCloseAt: bigint;
  snapshotBlock: bigint;
  participantCount: number;
  state: DrawState;
  winner: string;
  funded: boolean;
  winnerAuthorized: boolean;
  delivered: boolean;
};

export type PublicState = {
  playerCount: number;
  nextRoundId: bigint;
  drawPeriod: bigint;
  nextDrawClosesAt: bigint;
  rounds: RoundRecord[];
};

export type PrivatePosition = {
  balance: bigint;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  lastDeposit: bigint;
  lastWithdrawal: bigint;
};

export type PrivateRoundStats = {
  roundId: bigint;
  weight: bigint;
  totalWeight: bigint;
  oddsBps: bigint;
};

let relayerPromise: Promise<FhevmInstance> | null = null;
let sdkPromise: Promise<boolean> | null = null;

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

async function initializeSdk() {
  const sdk = window.relayerSDK;
  if (!sdk) {
    throw new Error("Zama Relayer SDK browser bundle did not load. Check cdn.zama.org connectivity and retry.");
  }
  if (sdk.__initialized__ === true) return true;

  if (!sdkPromise) {
    sdkPromise = sdk
      .initSDK()
      .then((result) => {
        if (!result) throw new Error("Zama Relayer SDK initialization returned false.");
        sdk.__initialized__ = true;
        return true;
      })
      .catch((error) => {
        sdkPromise = null;
        throw error;
      });
  }
  return sdkPromise;
}

async function relayer() {
  if (!relayerPromise) {
    await initializeSdk();
    const sdk = window.relayerSDK;
    if (!sdk) throw new Error("Zama Relayer SDK browser bundle is unavailable.");

    const baseConfig = sdk.SepoliaConfig;
    const relayerUrl = baseConfig.relayerUrl.endsWith("/v2") ? baseConfig.relayerUrl : `${baseConfig.relayerUrl}/v2`;

    relayerPromise = withTimeout(
      sdk.createInstance({
        ...baseConfig,
        relayerUrl,
        relayerRouteVersion: 2,
        network: injectedProvider(),
      }),
      60_000,
      "Zama relayer instance creation timed out. Check relayer connectivity and retry.",
    ).catch((error) => {
      relayerPromise = null;
      throw error;
    });
  }
  return relayerPromise;
}

function injectedProvider() {
  const root = window.ethereum;
  if (!root) throw new Error("No injected wallet found. Install MetaMask to use the live Sepolia demo.");
  const providers = root.providers?.length ? root.providers : [root];
  return providers.find((provider) => provider.isMetaMask) ?? root;
}

function rpcErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return Number((error as { code?: unknown }).code);
}

function actionError(prefix: string, error: unknown): never {
  console.error(`[UNVEIL] ${prefix}`, error);
  if (rpcErrorCode(error) === 4001) throw error;
  const message = error instanceof Error ? error.message : "";
  if (message.toLowerCase().includes("user rejected")) throw error;
  throw new Error(`${prefix}${message ? ` ${message}` : ""}`);
}

export async function connectWallet() {
  const ethereum = injectedProvider();
  await withTimeout(
    ethereum.request({ method: "eth_requestAccounts" }),
    30_000,
    "Wallet did not respond to the connection request.",
  );
  await ensureSepolia(ethereum);
  relayerPromise = null;
  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export function watchWalletSession(onChange: () => void) {
  const ethereum = injectedProvider();
  const handler = () => {
    relayerPromise = null;
    onChange();
  };
  ethereum.on?.("accountsChanged", handler);
  ethereum.on?.("chainChanged", handler);
  return () => {
    ethereum.removeListener?.("accountsChanged", handler);
    ethereum.removeListener?.("chainChanged", handler);
  };
}

export async function ensureSepolia(ethereum = injectedProvider()) {
  const chainIdHex = `0x${VEIL_NETWORK.chainId.toString(16)}`;
  const current = await ethereum.request({ method: "eth_chainId" });
  if (current === chainIdHex) return;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (rpcErrorCode(error) !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [SEPOLIA_RPC_URL],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }
  const switched = await ethereum.request({ method: "eth_chainId" });
  if (switched !== chainIdHex) throw new Error("UNVEIL requires Sepolia. Switch your wallet to Sepolia and retry.");
  relayerPromise = null;
}

export function contracts(signer: JsonRpcSigner) {
  return {
    pool: new Contract(VEIL_CONTRACTS.pool, POOL_ABI, signer),
    asset: new Contract(VEIL_CONTRACTS.asset, ASSET_ABI, signer),
    yieldSource: new Contract(VEIL_CONTRACTS.yieldSource, YIELD_ABI, signer),
    prizeVault: new Contract(VEIL_CONTRACTS.prizeVault, PRIZE_ABI, signer),
  };
}

function readContracts() {
  return {
    pool: new Contract(VEIL_CONTRACTS.pool, POOL_ABI, readProvider),
    asset: new Contract(VEIL_CONTRACTS.asset, ASSET_ABI, readProvider),
    yieldSource: new Contract(VEIL_CONTRACTS.yieldSource, YIELD_ABI, readProvider),
    prizeVault: new Contract(VEIL_CONTRACTS.prizeVault, PRIZE_ABI, readProvider),
  };
}

export async function fundDemoWallet(signer: JsonRpcSigner, amount = 100n) {
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error("Invalid demo funding amount.");
  const address = await signer.getAddress();
  const { asset } = contracts(signer);
  try {
    const tx = await withTimeout(
      asset.mint(address, amount),
      30_000,
      "Wallet did not respond to the demo funding request. Open MetaMask and check for a pending confirmation.",
    );
    return await withTimeout(
      tx.wait(),
      120_000,
      "Demo funding transaction is still pending on Sepolia. Check MetaMask activity or Etherscan before retrying.",
    );
  } catch (error) {
    actionError("UNVEIL_DEMO_FUNDING_FAILED:", error);
  }
}

export async function ensurePoolOperator(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { asset: readAsset } = readContracts();
  const alreadyOperator = await withTimeout(
    readAsset.isOperator(address, VEIL_CONTRACTS.pool),
    15_000,
    "Sepolia did not respond while checking pool authorization.",
  );
  if (alreadyOperator) return false;

  const until = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30);
  const { asset } = contracts(signer);
  try {
    const tx = await withTimeout(
      asset.setOperator(VEIL_CONTRACTS.pool, until),
      30_000,
      "Wallet did not respond to the pool authorization request.",
    );
    await withTimeout(
      tx.wait(),
      120_000,
      "Pool authorization is still pending on Sepolia. Check your wallet activity before retrying.",
    );
  } catch (error) {
    actionError("UNVEIL_OPERATOR_AUTH_FAILED:", error);
  }
  return true;
}

export async function sealDeposit(signer: JsonRpcSigner, amount: bigint, onStep?: (message: string) => void) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

  onStep?.("Checking confidential pool authorization…");
  const operatorAdded = await ensurePoolOperator(signer);
  onStep?.(operatorAdded ? "Pool authorized. Initializing FHE…" : "Pool already authorized. Initializing FHE…");

  const address = await signer.getAddress();
  let encrypted;
  try {
    const fhe = await relayer();
    onStep?.("FHE ready. Encrypting your deposit locally…");
    encrypted = await withTimeout(
      fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt(),
      60_000,
      "FHE encryption timed out. Check network connectivity and retry.",
    );
  } catch (error) {
    actionError("UNVEIL_ENCRYPTION_FAILED:", error);
  }

  onStep?.("Encrypted request ready. Waiting for wallet confirmation…");
  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(
      pool.deposit(encrypted.handles[0], encrypted.inputProof),
      30_000,
      "Wallet did not respond to the encrypted deposit request.",
    );
    onStep?.("Deposit submitted. Waiting for Sepolia confirmation…");
    return await withTimeout(
      tx.wait(),
      120_000,
      "Encrypted deposit is still pending on Sepolia. Check your wallet activity before retrying.",
    );
  } catch (error) {
    actionError("UNVEIL_DEPOSIT_FAILED:", error);
  }
}

export async function withdrawPrivate(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const address = await signer.getAddress();
  let encrypted;
  try {
    const fhe = await relayer();
    encrypted = await withTimeout(
      fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt(),
      60_000,
      "FHE encryption timed out. Check network connectivity and retry.",
    );
  } catch (error) {
    actionError("UNVEIL_ENCRYPTION_FAILED:", error);
  }
  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(
      pool.withdraw(encrypted.handles[0], encrypted.inputProof),
      30_000,
      "Wallet did not respond to the withdrawal request.",
    );
    return await withTimeout(
      tx.wait(),
      120_000,
      "Withdrawal is still pending on Sepolia. Check your wallet activity before retrying.",
    );
  } catch (error) {
    actionError("UNVEIL_WITHDRAW_FAILED:", error);
  }
}

export async function renewDrawSeat(signer: JsonRpcSigner) {
  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(pool.renewDrawSeat(), 30_000, "Wallet did not respond to eligibility renewal.");
    return await withTimeout(
      tx.wait(),
      120_000,
      "Eligibility renewal is still pending on Sepolia. Check wallet activity before retrying.",
    );
  } catch (error) {
    actionError("UNVEIL_ELIGIBILITY_RENEWAL_FAILED:", error);
  }
}

type DecryptTarget = { key: string; handle: string; contractAddress: string };

async function userDecryptHandles(signer: JsonRpcSigner, targets: DecryptTarget[]) {
  if (targets.length === 0) return {} as Record<string, bigint>;

  const fhe = await relayer();
  const address = await signer.getAddress();
  const keypair = fhe.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [...new Set(targets.map((target) => target.contractAddress))];
  const eip712 = fhe.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );
  const result = await withTimeout(
    fhe.userDecrypt(
      targets.map((target) => ({ handle: target.handle, contractAddress: target.contractAddress })),
      keypair.privateKey,
      keypair.publicKey,
      signature.replace("0x", ""),
      contractAddresses,
      address,
      startTimestamp,
      durationDays,
    ),
    60_000,
    "Private decryption timed out. Check network connectivity and retry.",
  );

  return Object.fromEntries(
    targets.map((target) => {
      const handleKey = target.handle as `0x${string}`;
      return [target.key, BigInt(result[handleKey] as bigint)];
    }),
  );
}

export async function revealPrivatePosition(signer: JsonRpcSigner): Promise<PrivatePosition> {
  const { pool } = contracts(signer);
  const encrypted = await pool.encryptedPosition();
  const values = await userDecryptHandles(signer, [
    { key: "balance", handle: encrypted.balance as string, contractAddress: VEIL_CONTRACTS.pool },
    { key: "totalDeposited", handle: encrypted.totalDeposited as string, contractAddress: VEIL_CONTRACTS.pool },
    { key: "totalWithdrawn", handle: encrypted.totalWithdrawn as string, contractAddress: VEIL_CONTRACTS.pool },
    { key: "lastDeposit", handle: encrypted.lastDeposit as string, contractAddress: VEIL_CONTRACTS.pool },
    { key: "lastWithdrawal", handle: encrypted.lastWithdrawal as string, contractAddress: VEIL_CONTRACTS.pool },
  ]);

  return {
    balance: values.balance,
    totalDeposited: values.totalDeposited,
    totalWithdrawn: values.totalWithdrawn,
    lastDeposit: values.lastDeposit,
    lastWithdrawal: values.lastWithdrawal,
  };
}

export async function revealPrivateBalance(signer: JsonRpcSigner) {
  return (await revealPrivatePosition(signer)).balance;
}

export async function revealRoundStats(signer: JsonRpcSigner, roundId: bigint): Promise<PrivateRoundStats> {
  const { pool } = contracts(signer);
  const [weightHandle, totalHandle] = await Promise.all([
    pool.encryptedSnapshotWeightOf(roundId),
    pool.encryptedSnapshotTotalWeight(roundId),
  ]);
  const values = await userDecryptHandles(signer, [
    { key: "weight", handle: weightHandle as string, contractAddress: VEIL_CONTRACTS.pool },
    { key: "totalWeight", handle: totalHandle as string, contractAddress: VEIL_CONTRACTS.pool },
  ]);
  const oddsBps = values.totalWeight === 0n ? 0n : (values.weight * 10_000n) / values.totalWeight;
  return { roundId, weight: values.weight, totalWeight: values.totalWeight, oddsBps };
}

export async function revealPrize(signer: JsonRpcSigner, roundId: bigint) {
  const { prizeVault } = contracts(signer);
  const handle = (await prizeVault.encryptedPrizeOf(roundId)) as string;
  const result = await userDecryptHandles(signer, [
    { key: "prize", handle, contractAddress: VEIL_CONTRACTS.prizeVault },
  ]);
  return result.prize;
}

async function readRounds(latestRound: bigint): Promise<RoundRecord[]> {
  if (latestRound === 0n) return [];
  const { pool, prizeVault } = readContracts();
  const first = latestRound > 11n ? latestRound - 11n : 1n;
  const ids: bigint[] = [];
  for (let id = latestRound; id >= first; id--) ids.push(id);

  const rounds = await Promise.all(
    ids.map(async (id) => {
      try {
        const [draw, timing] = await Promise.all([pool.getDrawInfo(id), pool.getDrawTiming(id)]);
        const state = Number(draw.state) as DrawState;
        const winner =
          state === 3 ? ((await pool.getWinner(id)) as string) : "0x0000000000000000000000000000000000000000";
        const prize = state === 3 ? await prizeVault.prizeStatus(id).catch(() => null) : null;
        return {
          id,
          scheduledCloseAt: BigInt(timing.scheduledCloseAt),
          snapshotBlock: BigInt(draw.snapshotBlock),
          participantCount: Number(draw.participantCount),
          state,
          winner,
          funded: prize ? Boolean(prize.funded) : false,
          winnerAuthorized: prize ? Boolean(prize.winnerAuthorized) : false,
          delivered: prize ? Boolean(prize.claimed) : false,
        } satisfies RoundRecord;
      } catch {
        return null;
      }
    }),
  );
  return rounds.filter((round): round is RoundRecord => round !== null);
}

export async function readPublicState(): Promise<PublicState> {
  const { pool } = readContracts();
  const [playerCount, nextRoundId, drawPeriod, nextDrawClosesAt] = await Promise.all([
    pool.playerCount(),
    pool.nextRoundId(),
    pool.drawPeriod(),
    pool.nextDrawClosesAt(),
  ]);
  const latestRound = nextRoundId > 1n ? nextRoundId - 1n : 0n;
  return {
    playerCount: Number(playerCount),
    nextRoundId: BigInt(nextRoundId),
    drawPeriod: BigInt(drawPeriod),
    nextDrawClosesAt: BigInt(nextDrawClosesAt),
    rounds: await readRounds(latestRound),
  };
}

export async function readDashboard(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { pool } = readContracts();
  const publicState = await readPublicState();
  const [joined, seated, seatExpiresAt] = await Promise.all([
    pool.joined(address),
    pool.seated(address),
    pool.seatExpiresAt(address),
  ]);
  const latestRound = publicState.nextRoundId > 1n ? publicState.nextRoundId - 1n : 0n;
  const inLatestRound =
    latestRound > 0n ? Boolean(await pool.isSnapshotParticipant(latestRound, address).catch(() => false)) : false;

  return {
    ...publicState,
    address,
    joined: Boolean(joined),
    seated: Boolean(seated),
    seatExpiresAt: BigInt(seatExpiresAt),
    latestRound,
    inLatestRound,
  };
}

export function drawStateLabel(state: DrawState) {
  if (state === 1) return "SNAPSHOTTED";
  if (state === 2) return "DRAWING";
  if (state === 3) return "FINALIZED";
  if (state === 4) return "CANCELLED";
  return "OPEN";
}

export async function advanceRoundMaintenance(signer: JsonRpcSigner, onStep?: (message: string) => void) {
  const dashboard = await readDashboard(signer);
  const { pool, yieldSource, prizeVault } = contracts(signer);
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (now >= dashboard.nextDrawClosesAt) {
    onStep?.("Closing the elapsed draw period and freezing encrypted weights…");
    const tx = await pool.closeDraw();
    await withTimeout(tx.wait(), 120_000, "Draw close is still pending on Sepolia.");
    return "closed" as const;
  }

  const latest = dashboard.rounds[0];
  if (!latest) return "waiting" as const;

  if (latest.state === 1) {
    onStep?.("Running BlindDraw over the frozen encrypted weights…");
    const tx = await pool.blindDraw(latest.id);
    await withTimeout(tx.wait(), 120_000, "BlindDraw is still pending on Sepolia.");
    return "drawn" as const;
  }

  if (latest.state === 2) {
    onStep?.("Requesting Zama public decryption proof for the encrypted winner…");
    const winnerHandle = (await pool.getEncryptedWinner(latest.id)) as string;
    const fhe = await relayer();
    const result = await withTimeout(
      fhe.publicDecrypt([winnerHandle]),
      90_000,
      "Zama public winner decryption timed out. Retry when the relayer is available.",
    );
    onStep?.("Winner proof ready. Verifying it onchain…");
    const tx = await pool.finalizeWinner(latest.id, result.abiEncodedClearValues, result.decryptionProof);
    await withTimeout(tx.wait(), 120_000, "Winner finalization is still pending on Sepolia.");
    return "finalized" as const;
  }

  if (latest.state === 3 && !latest.funded) {
    onStep?.("Routing all realized confidential strategy yield to this finalized round…");
    const tx = await yieldSource.allocateAllToRound(latest.id);
    await withTimeout(tx.wait(), 120_000, "Prize allocation is still pending on Sepolia.");
    return "funded" as const;
  }

  if (latest.state === 3 && latest.funded && !latest.delivered) {
    onStep?.("Delivering the encrypted prize directly to the finalized winner…");
    const tx = await prizeVault.deliverPrize(latest.id);
    await withTimeout(tx.wait(), 120_000, "Prize delivery is still pending on Sepolia.");
    return "delivered" as const;
  }

  return "waiting" as const;
}
