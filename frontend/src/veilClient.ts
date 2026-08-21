import {
  BrowserProvider,
  Contract,
  type BrowserProvider as EthersBrowserProvider,
  type Eip1193Provider,
  type JsonRpcSigner,
} from "ethers";
import { createInstance, initSDK, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import { VEIL_CONTRACTS, VEIL_NETWORK } from "./contracts";

type EthereumProvider = Eip1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

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

async function relayer() {
  if (!relayerPromise) {
    await initSDK();
    relayerPromise = createInstance({ ...SepoliaConfig, network: injectedProvider() });
  }
  return relayerPromise;
}

function injectedProvider() {
  if (!window.ethereum) {
    throw new Error("No injected wallet found. Install MetaMask or Rabby to use the live Sepolia demo.");
  }
  return window.ethereum;
}

function rpcErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return Number((error as { code?: unknown }).code);
}

export async function connectWallet() {
  const ethereum = injectedProvider();
  await ethereum.request({ method: "eth_requestAccounts" });
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
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }

  const switched = await ethereum.request({ method: "eth_chainId" });
  if (switched !== chainIdHex) {
    throw new Error("VEIL requires Sepolia. Switch your wallet to Sepolia and retry.");
  }

  // Recreate the relayer against the wallet's new network context.
  relayerPromise = null;
}

export function contracts(signer: JsonRpcSigner) {
  return {
    pool: new Contract(VEIL_CONTRACTS.pool, POOL_ABI, signer),
    asset: new Contract(VEIL_CONTRACTS.asset, ASSET_ABI, signer),
    prizeVault: new Contract(VEIL_CONTRACTS.prizeVault, PRIZE_ABI, signer),
  };
}

export async function ensurePoolOperator(signer: JsonRpcSigner) {
  const address = await signer.getAddress();
  const { asset } = contracts(signer);
  if (await asset.isOperator(address, VEIL_CONTRACTS.pool)) return false;
  const until = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7);
  const tx = await asset.setOperator(VEIL_CONTRACTS.pool, until);
  await tx.wait();
  return true;
}

export async function sealDeposit(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  await ensurePoolOperator(signer);
  const address = await signer.getAddress();
  const fhe = await relayer();
  const encrypted = await fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt();
  const { pool } = contracts(signer);
  const tx = await pool.deposit(encrypted.handles[0], encrypted.inputProof);
  return tx.wait();
}

export async function withdrawPrivate(signer: JsonRpcSigner, amount: bigint) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const address = await signer.getAddress();
  const fhe = await relayer();
  const encrypted = await fhe.createEncryptedInput(VEIL_CONTRACTS.pool, address).add64(amount).encrypt();
  const { pool } = contracts(signer);
  const tx = await pool.withdraw(encrypted.handles[0], encrypted.inputProof);
  return tx.wait();
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
  const result = await fhe.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    address,
    startTimestamp,
    durationDays,
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
  const { pool, prizeVault } = contracts(signer);
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
