import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  type BrowserProvider as EthersBrowserProvider,
  type Eip1193Provider,
  type JsonRpcSigner,
} from "ethers";
import { createInstance, initSDK, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import { VEIL_CONTRACTS, VEIL_NETWORK } from "./contracts";

type EthereumProvider = Eip1193Provider & {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const TFHE_WASM_URL = "/tfhe_bg.wasm";
const KMS_WASM_URL = "/kms_lib_bg.wasm";
const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL, VEIL_NETWORK.chainId, { staticNetwork: true });

const POOL_ABI = [
  "function joined(address) view returns (bool)",
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

let relayerPromise: ReturnType<typeof createInstance> | null = null;
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
  if (!sdkPromise) {
    sdkPromise = initSDK({
      tfheParams: TFHE_WASM_URL,
      kmsParams: KMS_WASM_URL,
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
    relayerPromise = createInstance({ ...SepoliaConfig, network: SEPOLIA_RPC_URL }).catch((error) => {
      relayerPromise = null;
      throw error;
    });
  }
  return relayerPromise;
}

function injectedProvider() {
  const root = window.ethereum;
  if (!root) {
    throw new Error("No injected wallet found. Install MetaMask to use the live Sepolia demo.");
  }

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
  await withTimeout(
    ethereum.request({ method: "eth_requestAccounts" }),
    30_000,
    "Wallet did not respond to the connection request.",
  );
  await ensureSepolia(ethereum);
  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export async function ensureSepolia(ethereum = injectedProvider()) {
  const chainIdHex = `0x${VEIL_NETWORK.chainId.toString(16)}`;
  const current = await ethereum.request({ method: "eth_chainId" });
  if (current === chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
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
  if (switched !== chainIdHex) {
    throw new Error("VEIL requires Sepolia. Switch your wallet to Sepolia and retry.");
  }

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
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) {
    throw new Error("Invalid demo funding amount.");
  }
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
    actionError("VEIL_DEMO_FUNDING_FAILED:", error);
  }
}

export async function ensurePoolOperator(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { asset: readAsset } = readContracts();
  if (await readAsset.isOperator(address, VEIL_CONTRACTS.pool)) return false;

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

export async function sealDeposit(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  await ensurePoolOperator(signer);
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
    actionError("VEIL_ENCRYPTION_FAILED:", error);
  }

  const { pool } = contracts(signer);
  try {
    const tx = await withTimeout(
      pool.deposit(encrypted.handles[0], encrypted.inputProof),
      30_000,
      "Wallet did not respond to the encrypted deposit request.",
    );
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
    encrypted = await withTimeout(
      fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt(),
      60_000,
      "FHE encryption timed out. Check network connectivity and retry.",
    );
  } catch (error) {
    actionError("VEIL_ENCRYPTION_FAILED:", error);
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
    actionError("VEIL_WITHDRAW_FAILED:", error);
  }
}

async function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {
  const fhe = await relayer();
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
    "Private decryption timed out. Check network connectivity and retry.",
  );
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

export async function readDashboard(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { pool, prizeVault } = readContracts();
  const [joined, playerCount, nextRoundId] = await Promise.all([
    pool.joined(address),
    pool.playerCount(),
    pool.nextRoundId(),
  ]);
  const latestRound = nextRoundId > 1n ? nextRoundId - 1n : 0n;
  const prize = latestRound > 0n ? await prizeVault.prizeStatus(latestRound) : null;
  return {
    joined: Boolean(joined),
    playerCount: Number(playerCount),
    nextRoundId: BigInt(nextRoundId),
    latestRound,
    prize,
  };
}
