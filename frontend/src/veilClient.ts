import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  ZeroHash,
  type BrowserProvider as EthersBrowserProvider,
  type Eip1193Provider,
  type JsonRpcSigner,
  type TransactionReceipt,
} from "ethers";
import { UNVEIL_CONTRACTS, UNVEIL_NETWORK } from "./contracts";
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

export type WalletLifecycleHandlers = {
  accountsChanged: (accounts: string[]) => void;
  chainChanged: (chainId: string) => void;
  disconnect: (error: unknown) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    relayerSDK?: ZamaRelayerSDK;
  }
}

const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const HISTORY_LIMIT = 20n;
const WITHDRAWAL_LOOKBACK = 32n;
const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL, UNVEIL_NETWORK.chainId, { staticNetwork: true });

const POOL_ABI = [
  "function joined(address) view returns (bool)",
  "function seated(address) view returns (bool)",
  "function seatExpiresAt(address) view returns (uint64)",
  "function playerCount() view returns (uint8)",
  "function nextRoundId() view returns (uint256)",
  "function nextDrawOpensAt() view returns (uint64)",
  "function nextDrawClosesAt() view returns (uint64)",
  "function getDrawSchedule() view returns (uint256 currentRoundId,uint256 unsettledRounds,uint64 opensAt,uint64 closesAt,bool timeReady,bool ready,bool canAdvance,bool insufficientParticipants,bool overdue)",
  "function getDrawInfo(uint256 roundId) view returns (uint64 snapshotBlock,uint8 participantCount,uint8 state)",
  "function getDrawState(uint256 roundId) view returns (uint8)",
  "function getWinner(uint256 roundId) view returns (address)",
  "function encryptedBalanceOf() view returns (bytes32)",
  "function encryptedReservedWithdrawalOf() view returns (bytes32)",
  "function encryptedSnapshotWeightOf(uint256 roundId) view returns (bytes32)",
  "function deposit(bytes32 encryptedAmount,bytes inputProof)",
  "function withdraw(bytes32 encryptedAmount,bytes inputProof) returns (uint256 requestId)",
  "function cancelWithdrawal(uint256 requestId) returns (bytes32 canceledAmount)",
  "function renewDrawSeat()",
  "function leaveDrawSeat()",
  "event WithdrawalRecorded(address indexed player,uint256 indexed requestId)",
] as const;

const UNDERLYING_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function mint(address to,uint256 amount)",
] as const;

const CONFIDENTIAL_TOKEN_ABI = [
  "function isOperator(address holder,address spender) view returns (bool)",
  "function setOperator(address operator,uint48 until)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;

const PRINCIPAL_ABI = [
  ...CONFIDENTIAL_TOKEN_ABI,
  "function wrap(address to,uint256 amount) returns (bytes32)",
] as const;

const PRIZE_ABI = [
  "function prizeStatus(uint256 roundId) view returns (bool processed,address winner)",
  "function encryptedPrizeOf(uint256 roundId) view returns (bytes32)",
] as const;

const MANAGER_ABI = [
  "function nextPrizeRoundId() view returns (uint256)",
  "function nextWithdrawalRequestId() view returns (uint256)",
  "function withdrawalRequest(uint256 requestId) view returns (address account,bytes32 amount,bytes32 remaining,bytes32 paid,bytes32 completed,uint256 createdWithdrawalBatchId,uint256 createdWithdrawalFundingNonce,bool exists,bool canceled,bool settled)",
  "function withdrawalRequestQueueState(uint256 requestId) view returns (bool classified,bool queued,uint256 queueSequence)",
  "function withdrawalRequestCommitted(uint256 requestId) view returns (bool)",
] as const;

export const DRAW_STATES = {
  NONE: 0,
  SNAPSHOTTED: 1,
  DRAWN: 2,
  FINALIZED: 3,
  CANCELLED: 4,
  SKIPPED: 5,
} as const;

export type DrawStateName = keyof typeof DRAW_STATES;

export type DrawSchedule = {
  currentRoundId: bigint;
  unsettledRounds: bigint;
  opensAt: bigint;
  closesAt: bigint;
  timeReady: boolean;
  ready: boolean;
  canAdvance: boolean;
  insufficientParticipants: boolean;
  overdue: boolean;
};

export type VerifiedRound = {
  id: bigint;
  snapshotBlock: bigint;
  participantCount: number;
  state: number;
  status: "FINALIZED" | "CANCELLED" | "SKIPPED";
  winner?: string;
  processedPrize: boolean;
};

export type WithdrawalStatus =
  | "REQUESTED"
  | "QUEUED"
  | "COMMITTED"
  | "AWAITING LIQUIDITY"
  | "READY / SETTLED"
  | "CANCELED";

export type WithdrawalView = {
  requestId: bigint;
  account: string;
  exists: boolean;
  canceled: boolean;
  settled: boolean;
  classified: boolean;
  queued: boolean;
  committed: boolean;
  queueSequence: bigint;
  createdWithdrawalBatchId: bigint;
  status: WithdrawalStatus;
};

export type MyVault = {
  activePrincipal: bigint;
  reservedPrincipal: bigint;
  strategySharePrizeBalance: bigint;
};

let relayerPromise: Promise<FhevmInstance> | null = null;
let sdkPromise: Promise<boolean> | null = null;

export function resetWalletRelayer() {
  relayerPromise = null;
}

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
  if (!sdk) throw new Error("Zama Relayer SDK browser bundle did not load. Check cdn.zama.org connectivity and retry.");
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
      sdk.createInstance({ ...baseConfig, relayerUrl, relayerRouteVersion: 2, network: injectedProvider() }),
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

export function subscribeWalletLifecycle(handlers: WalletLifecycleHandlers) {
  let ethereum: EthereumProvider;
  try {
    ethereum = injectedProvider();
  } catch {
    return () => undefined;
  }
  if (!ethereum.on || !ethereum.removeListener) return () => undefined;

  const accountsChanged = (accounts: string[]) => {
    resetWalletRelayer();
    handlers.accountsChanged(accounts);
  };
  const chainChanged = (chainId: string) => {
    resetWalletRelayer();
    handlers.chainChanged(chainId);
  };
  const disconnect = (error: unknown) => {
    resetWalletRelayer();
    handlers.disconnect(error);
  };

  ethereum.on("accountsChanged", accountsChanged);
  ethereum.on("chainChanged", chainChanged);
  ethereum.on("disconnect", disconnect);
  return () => {
    ethereum.removeListener?.("accountsChanged", accountsChanged);
    ethereum.removeListener?.("chainChanged", chainChanged);
    ethereum.removeListener?.("disconnect", disconnect);
  };
}

export function parseWalletChainId(chainId: string) {
  try {
    const parsed = Number(BigInt(chainId));
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function readInjectedWalletState() {
  try {
    const ethereum = injectedProvider();
    const [chainId, accounts] = await Promise.all([
      ethereum.request({ method: "eth_chainId" }),
      ethereum.request({ method: "eth_accounts" }),
    ]);
    return {
      chainId: typeof chainId === "string" ? parseWalletChainId(chainId) : undefined,
      accounts: Array.isArray(accounts)
        ? accounts.filter((account): account is string => typeof account === "string")
        : [],
    };
  } catch {
    return undefined;
  }
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
    "Wallet did not respond to connection.",
  );
  await ensureSepolia(ethereum);
  resetWalletRelayer();
  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const accounts = await ethereum.request({ method: "eth_accounts" });
  if (
    !Array.isArray(accounts) ||
    !accounts.some((account) => typeof account === "string" && account.toLowerCase() === address.toLowerCase())
  ) {
    throw new Error("Wallet account changed during connection. Reconnect to load the current account.");
  }
  return { provider, signer, address };
}

export async function ensureSepolia(ethereum = injectedProvider()) {
  const chainIdHex = `0x${UNVEIL_NETWORK.chainId.toString(16)}`;
  if ((await ethereum.request({ method: "eth_chainId" })) === chainIdHex) return;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (rpcErrorCode(error) !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: UNVEIL_NETWORK.name,
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [SEPOLIA_RPC_URL],
          blockExplorerUrls: [UNVEIL_NETWORK.explorer],
        },
      ],
    });
  }
  if ((await ethereum.request({ method: "eth_chainId" })) !== chainIdHex) {
    throw new Error("UNVEIL requires Sepolia. Switch your wallet to Sepolia and retry.");
  }
  resetWalletRelayer();
}

export function contracts(signer: JsonRpcSigner) {
  return {
    underlying: new Contract(UNVEIL_CONTRACTS.underlying, UNDERLYING_ABI, signer),
    principal: new Contract(UNVEIL_CONTRACTS.principal, PRINCIPAL_ABI, signer),
    shares: new Contract(UNVEIL_CONTRACTS.shares, CONFIDENTIAL_TOKEN_ABI, signer),
    pool: new Contract(UNVEIL_CONTRACTS.pool, POOL_ABI, signer),
    prizeVault: new Contract(UNVEIL_CONTRACTS.prizeVault, PRIZE_ABI, signer),
    manager: new Contract(UNVEIL_CONTRACTS.manager, MANAGER_ABI, signer),
  };
}

function readContracts() {
  return {
    underlying: new Contract(UNVEIL_CONTRACTS.underlying, UNDERLYING_ABI, readProvider),
    principal: new Contract(UNVEIL_CONTRACTS.principal, PRINCIPAL_ABI, readProvider),
    shares: new Contract(UNVEIL_CONTRACTS.shares, CONFIDENTIAL_TOKEN_ABI, readProvider),
    pool: new Contract(UNVEIL_CONTRACTS.pool, POOL_ABI, readProvider),
    prizeVault: new Contract(UNVEIL_CONTRACTS.prizeVault, PRIZE_ABI, readProvider),
    manager: new Contract(UNVEIL_CONTRACTS.manager, MANAGER_ABI, readProvider),
  };
}

async function userDecryptHandles(signer: JsonRpcSigner, requests: Array<{ handle: string; contractAddress: string }>) {
  const values = new Map<string, bigint>();
  const decryptable = requests.filter(({ handle }) => handle !== ZeroHash);
  for (const { handle } of requests) if (handle === ZeroHash) values.set(handle, 0n);
  if (decryptable.length === 0) return values;

  const fhe = await relayer();
  const address = await signer.getAddress();
  const keypair = fhe.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [...new Set(decryptable.map(({ contractAddress }) => contractAddress))];
  const eip712 = fhe.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );
  const result = await withTimeout(
    fhe.userDecrypt(
      decryptable,
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
  for (const { handle } of decryptable) values.set(handle, BigInt(result[handle as `0x${string}`] as bigint | string));
  return values;
}

async function decryptOne(signer: JsonRpcSigner, handle: string, contractAddress: string) {
  return (await userDecryptHandles(signer, [{ handle, contractAddress }])).get(handle) ?? 0n;
}

export async function fundDemoWallet(signer: JsonRpcSigner, targetAmount = 100n) {
  if (targetAmount <= 0n || targetAmount > MAX_UINT64) throw new Error("Invalid TEST funding amount.");
  const address = await signer.getAddress();
  const { underlying, principal } = contracts(signer);
  try {
    const wrappedHandle = (await principal.confidentialBalanceOf(address)) as string;
    const wrappedBalance = await decryptOne(signer, wrappedHandle, UNVEIL_CONTRACTS.principal);
    if (wrappedBalance >= targetAmount) return { minted: 0n, wrapped: 0n, alreadyFunded: true };

    const needed = targetAmount - wrappedBalance;
    const publicBalance = BigInt(await underlying.balanceOf(address));
    const mintAmount = publicBalance >= needed ? 0n : needed - publicBalance;
    if (mintAmount > 0n) {
      const mintTx = await withTimeout(
        underlying.mint(address, mintAmount),
        30_000,
        "Wallet did not respond to TEST mint.",
      );
      await withTimeout(mintTx.wait(), 120_000, "TEST mint is still pending on Sepolia.");
    }

    const allowance = BigInt(await underlying.allowance(address, UNVEIL_CONTRACTS.principal));
    if (allowance < needed) {
      const approveTx = await withTimeout(
        underlying.approve(UNVEIL_CONTRACTS.principal, needed),
        30_000,
        "Wallet did not respond to TEST token approval.",
      );
      await withTimeout(approveTx.wait(), 120_000, "TEST token approval is still pending on Sepolia.");
    }

    const wrapTx = await withTimeout(
      principal.wrap(address, needed),
      30_000,
      "Wallet did not respond to TEST wrapping.",
    );
    await withTimeout(wrapTx.wait(), 120_000, "TEST principal wrapping is still pending on Sepolia.");
    return { minted: mintAmount, wrapped: needed, alreadyFunded: false };
  } catch (error) {
    actionError("UNVEIL_TEST_FUNDING_FAILED:", error);
  }
}

export async function ensurePoolOperator(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { principal: readPrincipal } = readContracts();
  const alreadyOperator = await withTimeout(
    readPrincipal.isOperator(address, UNVEIL_CONTRACTS.pool),
    15_000,
    "Sepolia did not respond while checking pool authorization.",
  );
  if (alreadyOperator) return false;
  const until = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7);
  try {
    const tx = await withTimeout(
      contracts(signer).principal.setOperator(UNVEIL_CONTRACTS.pool, until),
      30_000,
      "Wallet did not respond to pool authorization.",
    );
    await withTimeout(tx.wait(), 120_000, "Pool authorization is still pending on Sepolia.");
  } catch (error) {
    actionError("UNVEIL_OPERATOR_AUTH_FAILED:", error);
  }
  return true;
}

async function encryptedInput(signer: JsonRpcSigner, amount: bigint) {
  const address = await signer.getAddress();
  const fhe = await relayer();
  return withTimeout(
    fhe.createEncryptedInput(UNVEIL_CONTRACTS.pool, address).add64(amount).encrypt(),
    60_000,
    "FHE encryption timed out. Check network connectivity and retry.",
  );
}

export async function sealDeposit(signer: JsonRpcSigner, amount: bigint, onStep?: (message: string) => void) {
  if (amount <= 0n || amount > MAX_UINT64) throw new Error("Enter a valid whole-number amount.");
  onStep?.("Checking confidential principal authorization…");
  const operatorAdded = await ensurePoolOperator(signer);
  onStep?.(
    operatorAdded ? "Pool authorization confirmed. Initializing FHE…" : "Pool already authorized. Initializing FHE…",
  );
  let encrypted;
  try {
    onStep?.("Encrypting deposit locally…");
    encrypted = await encryptedInput(signer, amount);
  } catch (error) {
    actionError("UNVEIL_ENCRYPTION_FAILED:", error);
  }
  try {
    onStep?.("Encrypted request ready. Waiting for wallet confirmation…");
    const tx = await withTimeout(
      contracts(signer).pool.deposit(encrypted.handles[0], encrypted.inputProof),
      30_000,
      "Wallet did not respond to encrypted deposit.",
    );
    onStep?.("Deposit submitted. Waiting for Sepolia confirmation…");
    return await withTimeout(tx.wait(), 120_000, "Encrypted deposit is still pending on Sepolia.");
  } catch (error) {
    actionError("UNVEIL_DEPOSIT_FAILED:", error);
  }
}

function withdrawalStatus(
  settled: boolean,
  canceled: boolean,
  classified: boolean,
  queued: boolean,
  committed: boolean,
) {
  if (settled) return "READY / SETTLED" as const;
  if (canceled) return "CANCELED" as const;
  if (!classified) return "REQUESTED" as const;
  if (!queued) return "COMMITTED" as const;
  if (committed) return "AWAITING LIQUIDITY" as const;
  return "QUEUED" as const;
}

export async function readWithdrawalRequest(requestId: bigint): Promise<WithdrawalView> {
  try {
    const { manager } = readContracts();
    const [request, queue, committed] = await Promise.all([
      manager.withdrawalRequest(requestId),
      manager.withdrawalRequestQueueState(requestId),
      manager.withdrawalRequestCommitted(requestId),
    ]);
    const exists = Boolean(request.exists);
    if (!exists) throw new Error("Request does not exist.");
    const settled = Boolean(request.settled);
    const canceled = Boolean(request.canceled);
    const classified = Boolean(queue.classified);
    const queued = Boolean(queue.queued);
    const isCommitted = Boolean(committed);
    return {
      requestId,
      account: request.account as string,
      exists,
      canceled,
      settled,
      classified,
      queued,
      committed: isCommitted,
      queueSequence: BigInt(queue.queueSequence),
      createdWithdrawalBatchId: BigInt(request.createdWithdrawalBatchId),
      status: withdrawalStatus(settled, canceled, classified, queued, isCommitted),
    };
  } catch (error) {
    actionError("UNVEIL_MANAGER_REQUEST_UNAVAILABLE:", error);
  }
}

function requestIdFromReceipt(receipt: TransactionReceipt, player: string) {
  const pool = new Contract(UNVEIL_CONTRACTS.pool, POOL_ABI);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== UNVEIL_CONTRACTS.pool.toLowerCase()) continue;
    try {
      const parsed = pool.interface.parseLog(log);
      if (parsed?.name === "WithdrawalRecorded" && String(parsed.args.player).toLowerCase() === player.toLowerCase()) {
        return BigInt(parsed.args.requestId);
      }
    } catch {
      // Ignore unrelated pool logs.
    }
  }
  throw new Error("UNVEIL_MANAGER_REQUEST_UNAVAILABLE: WithdrawalRecorded event was not found.");
}

export async function withdrawPrivate(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n || amount > MAX_UINT64) throw new Error("Enter a valid whole-number amount.");
  let encrypted;
  try {
    encrypted = await encryptedInput(signer, amount);
  } catch (error) {
    actionError("UNVEIL_ENCRYPTION_FAILED:", error);
  }
  try {
    const tx = await withTimeout(
      contracts(signer).pool.withdraw(encrypted.handles[0], encrypted.inputProof),
      30_000,
      "Wallet did not respond to withdrawal request.",
    );
    const receipt = (await withTimeout(
      tx.wait(),
      120_000,
      "Withdrawal request is still pending on Sepolia.",
    )) as TransactionReceipt | null;
    if (!receipt) throw new Error("Withdrawal receipt is unavailable.");
    const requestId = requestIdFromReceipt(receipt, await signer.getAddress());
    return { receipt, requestId, request: await readWithdrawalRequest(requestId) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNVEIL_MANAGER_REQUEST_UNAVAILABLE:")) throw error;
    actionError("UNVEIL_WITHDRAW_FAILED:", error);
  }
}

export async function cancelWithdrawal(signer: JsonRpcSigner, requestId: bigint) {
  try {
    const tx = await withTimeout(
      contracts(signer).pool.cancelWithdrawal(requestId),
      30_000,
      "Wallet did not respond to withdrawal cancellation.",
    );
    return await withTimeout(tx.wait(), 120_000, "Withdrawal cancellation is still pending on Sepolia.");
  } catch (error) {
    actionError("UNVEIL_WITHDRAW_CANCEL_FAILED:", error);
  }
}

export async function renewDrawSeat(signer: JsonRpcSigner) {
  try {
    const tx = await withTimeout(
      contracts(signer).pool.renewDrawSeat(),
      30_000,
      "Wallet did not respond to seat renewal.",
    );
    return await withTimeout(tx.wait(), 120_000, "Draw-seat renewal is still pending on Sepolia.");
  } catch (error) {
    actionError("UNVEIL_SEAT_RENEWAL_FAILED:", error);
  }
}

export async function leaveDrawSeat(signer: JsonRpcSigner) {
  try {
    const tx = await withTimeout(
      contracts(signer).pool.leaveDrawSeat(),
      30_000,
      "Wallet did not respond to seat release.",
    );
    return await withTimeout(tx.wait(), 120_000, "Draw-seat release is still pending on Sepolia.");
  } catch (error) {
    actionError("UNVEIL_SEAT_RELEASE_FAILED:", error);
  }
}

export async function revealMyVault(signer: JsonRpcSigner): Promise<MyVault> {
  const address = await signer.getAddress();
  const { pool, shares } = contracts(signer);
  const isJoined = Boolean(await pool.joined(address));
  const [activeHandle, reservedHandle, sharesHandle] = (await Promise.all([
    isJoined ? pool.encryptedBalanceOf() : Promise.resolve(ZeroHash),
    isJoined ? pool.encryptedReservedWithdrawalOf() : Promise.resolve(ZeroHash),
    shares.confidentialBalanceOf(address),
  ])) as [string, string, string];
  const values = await userDecryptHandles(signer, [
    { handle: activeHandle, contractAddress: UNVEIL_CONTRACTS.pool },
    { handle: reservedHandle, contractAddress: UNVEIL_CONTRACTS.pool },
    { handle: sharesHandle, contractAddress: UNVEIL_CONTRACTS.shares },
  ]);
  return {
    activePrincipal: values.get(activeHandle) ?? 0n,
    reservedPrincipal: values.get(reservedHandle) ?? 0n,
    strategySharePrizeBalance: values.get(sharesHandle) ?? 0n,
  };
}

export async function revealMyRoundWeight(signer: JsonRpcSigner, roundId: bigint) {
  try {
    const handle = (await contracts(signer).pool.encryptedSnapshotWeightOf(roundId)) as string;
    return await decryptOne(signer, handle, UNVEIL_CONTRACTS.pool);
  } catch (error) {
    actionError("UNVEIL_ROUND_WEIGHT_UNAVAILABLE:", error);
  }
}

export async function revealPrize(signer: JsonRpcSigner, roundId: bigint) {
  try {
    const handle = (await contracts(signer).prizeVault.encryptedPrizeOf(roundId)) as string;
    return await decryptOne(signer, handle, UNVEIL_CONTRACTS.prizeVault);
  } catch (error) {
    actionError("UNVEIL_PRIZE_WINNER_ONLY:", error);
  }
}

async function readSchedule(): Promise<DrawSchedule> {
  const schedule = await readContracts().pool.getDrawSchedule();
  return {
    currentRoundId: BigInt(schedule.currentRoundId),
    unsettledRounds: BigInt(schedule.unsettledRounds),
    opensAt: BigInt(schedule.opensAt),
    closesAt: BigInt(schedule.closesAt),
    timeReady: Boolean(schedule.timeReady),
    ready: Boolean(schedule.ready),
    canAdvance: Boolean(schedule.canAdvance),
    insufficientParticipants: Boolean(schedule.insufficientParticipants),
    overdue: Boolean(schedule.overdue),
  };
}

async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {
  if (latestRound === 0n) return [];
  const { pool, prizeVault } = readContracts();
  const first = latestRound > HISTORY_LIMIT ? latestRound - HISTORY_LIMIT + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = latestRound; id >= first; id--) ids.push(id);
  const rounds: Array<VerifiedRound | null> = await Promise.all(
    ids.map(async (id): Promise<VerifiedRound | null> => {
      try {
        const draw = await pool.getDrawInfo(id);
        const state = Number(draw.state);
        if (state !== DRAW_STATES.FINALIZED && state !== DRAW_STATES.CANCELLED && state !== DRAW_STATES.SKIPPED)
          return null;
        if (state === DRAW_STATES.FINALIZED) {
          const [winner, prize] = await Promise.all([pool.getWinner(id), prizeVault.prizeStatus(id)]);
          return {
            id,
            snapshotBlock: BigInt(draw.snapshotBlock),
            participantCount: Number(draw.participantCount),
            state,
            status: "FINALIZED",
            winner: winner as string,
            processedPrize: Boolean(prize.processed),
          } satisfies VerifiedRound;
        }
        return {
          id,
          snapshotBlock: BigInt(draw.snapshotBlock),
          participantCount: Number(draw.participantCount),
          state,
          status: state === DRAW_STATES.CANCELLED ? "CANCELLED" : "SKIPPED",
          processedPrize: false,
        } satisfies VerifiedRound;
      } catch {
        return null;
      }
    }),
  );
  return rounds.filter((round): round is VerifiedRound => round !== null);
}

async function readLatestWithdrawal(address: string, nextRequestId: bigint) {
  const lowerBound = nextRequestId > WITHDRAWAL_LOOKBACK ? nextRequestId - WITHDRAWAL_LOOKBACK : 1n;
  const { manager } = readContracts();
  const ids: bigint[] = [];
  for (let id = nextRequestId - 1n; id >= lowerBound && id > 0n; id--) {
    ids.push(id);
  }
  const candidates = await Promise.all(
    ids.map(async (requestId) => {
      try {
        const request = await manager.withdrawalRequest(requestId);
        return Boolean(request.exists) ? { requestId, account: request.account as string } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const latest = candidates.find((candidate) => candidate?.account.toLowerCase() === address.toLowerCase());
  return latest ? readWithdrawalRequest(latest.requestId) : undefined;
}

export async function readDashboard(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { pool, manager } = readContracts();
  const [joined, seated, seatExpiresAt, playerCount, nextRoundId, schedule, nextPrizeRoundId, nextWithdrawalRequestId] =
    await Promise.all([
      pool.joined(address),
      pool.seated(address),
      pool.seatExpiresAt(address),
      pool.playerCount(),
      pool.nextRoundId(),
      readSchedule(),
      manager.nextPrizeRoundId(),
      manager.nextWithdrawalRequestId(),
    ]);
  const latestRound = BigInt(nextRoundId) > 1n ? BigInt(nextRoundId) - 1n : 0n;
  const [history, latestWithdrawal] = await Promise.all([
    readVerifiedRounds(latestRound),
    readLatestWithdrawal(address, BigInt(nextWithdrawalRequestId)),
  ]);
  const latestFinalized = history.find((round) => round.status === "FINALIZED");
  return {
    joined: Boolean(joined),
    seated: Boolean(seated),
    seatExpiresAt: BigInt(seatExpiresAt),
    playerCount: Number(playerCount),
    nextRoundId: BigInt(nextRoundId),
    latestRound,
    schedule,
    nextPrizeRoundId: BigInt(nextPrizeRoundId),
    nextWithdrawalRequestId: BigInt(nextWithdrawalRequestId),
    latestWithdrawal,
    latestFinalized,
    history,
  };
}

export async function readPublicProtocol() {
  const { pool } = readContracts();
  const [schedule, playerCount, nextRoundId] = await Promise.all([
    readSchedule(),
    pool.playerCount(),
    pool.nextRoundId(),
  ]);
  const latestRound = BigInt(nextRoundId) > 1n ? BigInt(nextRoundId) - 1n : 0n;
  const history = await readVerifiedRounds(latestRound);
  return {
    schedule,
    playerCount: Number(playerCount),
    latestRound,
    latestFinalized: history.find((round) => round.status === "FINALIZED"),
    history,
  };
}

export function isConnectedWinner(address: string, round?: VerifiedRound) {
  return Boolean(round?.winner && round.winner !== ZeroAddress && round.winner.toLowerCase() === address.toLowerCase());
}

export function deliveredPrizesForAddress(history: VerifiedRound[], address: string) {
  if (!address) return [];
  return history.filter(
    (round) => round.status === "FINALIZED" && round.processedPrize && isConnectedWinner(address, round),
  );
}

export function deliveredPrizeForRound(history: VerifiedRound[], address: string, roundId: bigint) {
  return deliveredPrizesForAddress(history, address).find((round) => round.id === roundId);
}
