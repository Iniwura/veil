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
const TFHE_WASM_URL = "/tfhe_bg.wasm";
const KMS_WASM_URL = "/kms_lib_bg.wasm";
const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL, VEIL_NETWORK.chainId, { staticNetwork: true });

const POOL_ABI = [
  "function joined(address) view returns (bool)",
  "function seated(address) view returns (bool)",
  "function seatExpiresAt(address) view returns (uint64)",
  "function renewDrawSeat()",
  "function playerCount() view returns (uint8)",
  "function nextRoundId() view returns (uint256)",
  "function encryptedBalanceOf() view returns (bytes32)",
  "function deposit(bytes32 encryptedAmount, bytes inputProof)",
  "function withdraw(bytes32 encryptedAmount, bytes inputProof)",
  "function getDrawInfo(uint256 roundId) view returns (uint64 snapshotBlock,uint8 participantCount,uint8 state)",
  "function getWinner(uint256 roundId) view returns (address)",
] as const;

const ASSET_ABI = [
  "function isOperator(address holder,address spender) view returns (bool)",
  "function setOperator(address operator,uint48 until)",
  "function mint(address to,uint64 amount)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
] as const;

const PRIZE_ABI = [
  "function prizeStatus(uint256 roundId) view returns (bool funded,bool winnerAuthorized,bool claimed,address winner)",
  "function encryptedPrizeOf(uint256 roundId) view returns (bytes32)",
  "function authorizeWinner(uint256 roundId)",
  "function claimPrize(uint256 roundId)",
] as const;

export type VerifiedRound = {
  id: bigint;
  snapshotBlock: bigint;
  participantCount: number;
  state: number;
  cancelled: boolean;
  winner: string;
  funded: boolean;
  winnerAuthorized: boolean;
  claimed: boolean;
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
    // Match Zama's official browser loader: let the CDN bundle resolve its own WASM/worker assets.
    sdkPromise = sdk.initSDK().then((result) => {
      if (!result) throw new Error("Zama Relayer SDK initialization returned false.");
      sdk.__initialized__ = true;
      return true;
    }).catch((error) => {
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
    const relayerUrl = baseConfig.relayerUrl.endsWith("/v2")
      ? baseConfig.relayerUrl
      : baseConfig.relayerUrl + "/v2";

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
  console.error(`[VEIL] ${prefix}`, error);
  if (rpcErrorCode(error) === 4001) throw error;
  const message = error instanceof Error ? error.message : "";
  if (message.toLowerCase().includes("user rejected")) throw error;
  throw new Error(`${prefix}${message ? ` ${message}` : ""}`);
}

export async function connectWallet() {
  const ethereum = injectedProvider();
  await withTimeout(ethereum.request({ method: "eth_requestAccounts" }), 30_000, "Wallet did not respond to the connection request.");
  await ensureSepolia(ethereum);
  relayerPromise = null;
  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export async function ensureSepolia(ethereum = injectedProvider()) {
  const chainIdHex = `0x${VEIL_NETWORK.chainId.toString(16)}`;
  const current = await ethereum.request({ method: "eth_chainId" });
  if (current === chainIdHex) return;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (rpcErrorCode(error) !== 4902) throw error;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainIdHex, chainName: "Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [SEPOLIA_RPC_URL], blockExplorerUrls: ["https://sepolia.etherscan.io"] }] });
  }
  const switched = await ethereum.request({ method: "eth_chainId" });
  if (switched !== chainIdHex) throw new Error("VEIL requires Sepolia. Switch your wallet to Sepolia and retry.");
  relayerPromise = null;
}

export function contracts(signer: JsonRpcSigner) {
  return {
    pool: new Contract(VEIL_CONTRACTS.pool, POOL_ABI, signer),
    asset: new Contract(VEIL_CONTRACTS.asset, ASSET_ABI, signer),
    prizeVault: new Contract(VEIL_CONTRACTS.prizeVault, PRIZE_ABI, signer),
  };
}

function readContracts() {
  return {
    pool: new Contract(VEIL_CONTRACTS.pool, POOL_ABI, readProvider),
    asset: new Contract(VEIL_CONTRACTS.asset, ASSET_ABI, readProvider),
    prizeVault: new Contract(VEIL_CONTRACTS.prizeVault, PRIZE_ABI, readProvider),
  };
}

export async function fundDemoWallet(signer: JsonRpcSigner, amount = 100n) {
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error("Invalid demo funding amount.");
  const address = await signer.getAddress();
  const { asset } = contracts(signer);
  try {
    const tx = await withTimeout(asset.mint(address, amount), 30_000, "Wallet did not respond to the demo funding request. Open MetaMask and check for a pending confirmation.");
    return await withTimeout(tx.wait(), 120_000, "Demo funding transaction is still pending on Sepolia. Check MetaMask activity or Etherscan before retrying.");
  } catch (error) { actionError("VEIL_DEMO_FUNDING_FAILED:", error); }
}

export async function ensurePoolOperator(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { asset: readAsset } = readContracts();
  const alreadyOperator = await withTimeout(
    readAsset.isOperator(address, VEIL_CONTRACTS.pool),
    15_000,
    "Sepolia did not respond while checking VEIL pool authorization.",
  );
  if (alreadyOperator) return false;

  const until = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7);
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
    actionError("VEIL_OPERATOR_AUTH_FAILED:", error);
  }
  return true;
}

export async function sealDeposit(
  signer: JsonRpcSigner,
  amount: bigint,
  onStep?: (message: string) => void,
) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

  onStep?.("Checking VEIL pool authorization…");
  const operatorAdded = await ensurePoolOperator(signer);
  onStep?.(
    operatorAdded
      ? "Pool authorization confirmed. Initializing FHE…"
      : "Pool already authorized. Initializing FHE…",
  );

  const address = await signer.getAddress();
  let encrypted;
  try {
    const fhe = await relayer();
    onStep?.("FHE ready. Encrypting deposit locally…");
    encrypted = await withTimeout(
      fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt(),
      60_000,
      "FHE encryption timed out. Check network connectivity and retry.",
    );
  } catch (error) {
    actionError("VEIL_ENCRYPTION_FAILED:", error);
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
    actionError("VEIL_DEPOSIT_FAILED:", error);
  }
}

export async function withdrawPrivate(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const address = await signer.getAddress();
  let encrypted;
  try {
    const fhe = await relayer();
    encrypted = await withTimeout(fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt(), 60_000, "FHE encryption timed out. Check network connectivity and retry.");
  } catch (error) { actionError("VEIL_ENCRYPTION_FAILED:", error); }
  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(pool.withdraw(encrypted.handles[0], encrypted.inputProof), 30_000, "Wallet did not respond to the withdrawal request.");
    return await withTimeout(tx.wait(), 120_000, "Withdrawal is still pending on Sepolia. Check your wallet activity before retrying.");
  } catch (error) { actionError("VEIL_WITHDRAW_FAILED:", error); }
}

export async function renewDrawSeat(signer: JsonRpcSigner) {
  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(pool.renewDrawSeat(), 30_000, "Wallet did not respond to the draw-seat renewal request.");
    return await withTimeout(tx.wait(), 120_000, "Draw-seat renewal is still pending on Sepolia. Check wallet activity before retrying.");
  } catch (error) { actionError("VEIL_SEAT_RENEWAL_FAILED:", error); }
}

async function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {
  const fhe = await relayer();
  const address = await signer.getAddress();
  const keypair = fhe.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [contractAddress];
  const eip712 = fhe.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signer.signTypedData(eip712.domain, { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] }, eip712.message);
  const result = await withTimeout(fhe.userDecrypt([{ handle, contractAddress }], keypair.privateKey, keypair.publicKey, signature.replace("0x", ""), contractAddresses, address, startTimestamp, durationDays), 60_000, "Private decryption timed out. Check network connectivity and retry.");
  const handleKey = handle as `0x${string}`;
  return BigInt(result[handleKey] as bigint);
}

export async function revealPrivateBalance(signer: JsonRpcSigner) {
  const { pool } = contracts(signer);
  const handle = (await pool.encryptedBalanceOf()) as string;
  return userDecryptHandle(signer, handle, VEIL_CONTRACTS.pool);
}

export async function revealPrize(signer: JsonRpcSigner, roundId: bigint) {
  const { prizeVault } = contracts(signer);
  const handle = (await prizeVault.encryptedPrizeOf(roundId)) as string;
  return userDecryptHandle(signer, handle, VEIL_CONTRACTS.prizeVault);
}

async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {
  if (latestRound === 0n) return [];
  const { pool, prizeVault } = readContracts();
  const ids = Array.from({ length: Number(latestRound) }, (_, index) => BigInt(index + 1)).reverse();
  const rounds = await Promise.all(ids.map(async (id) => {
    try {
      const draw = await pool.getDrawInfo(id);
      const state = Number(draw.state);
      if (state !== 3 && state !== 4) return null;
      const cancelled = state === 4;
      const winner = cancelled ? "0x0000000000000000000000000000000000000000" : (await pool.getWinner(id)) as string;
      const prize = cancelled ? null : await prizeVault.prizeStatus(id);
      return {
        id,
        snapshotBlock: BigInt(draw.snapshotBlock),
        participantCount: Number(draw.participantCount),
        state,
        cancelled,
        winner,
        funded: prize ? Boolean(prize.funded) : false,
        winnerAuthorized: prize ? Boolean(prize.winnerAuthorized) : false,
        claimed: prize ? Boolean(prize.claimed) : false,
      } satisfies VerifiedRound;
    } catch {
      return null;
    }
  }));
  return rounds.filter((round): round is VerifiedRound => round !== null);
}
export async function readDashboard(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { pool, prizeVault } = readContracts();
  const [joined, seated, seatExpiresAt, playerCount, nextRoundId] = await Promise.all([
    pool.joined(address),
    pool.seated(address),
    pool.seatExpiresAt(address),
    pool.playerCount(),
    pool.nextRoundId(),
  ]);
  const latestRound = nextRoundId > 1n ? nextRoundId - 1n : 0n;
  const [prize, history] = await Promise.all([
    latestRound > 0n ? prizeVault.prizeStatus(latestRound).catch(() => null) : Promise.resolve(null),
    readVerifiedRounds(latestRound),
  ]);
  return {
    joined: Boolean(joined),
    seated: Boolean(seated),
    seatExpiresAt: BigInt(seatExpiresAt),
    playerCount: Number(playerCount),
    nextRoundId: BigInt(nextRoundId),
    latestRound,
    prize,
    history,
  };
}
