import fs from "node:fs";

const clientPath = "frontend/src/veilClient.ts";
const appPath = "frontend/src/App.tsx";
let client = fs.readFileSync(clientPath, "utf8");
let app = fs.readFileSync(appPath, "utf8");

function replaceRegex(source, label, regex, replacement) {
  if (!regex.test(source)) throw new Error(`Patch failed: ${label} pattern not found`);
  return source.replace(regex, replacement);
}

client = replaceRegex(
  client,
  "FHE SDK and v2 relayer initialization",
  /async function initializeSdk\(\) \{[\s\S]*?\n\}\n\nasync function relayer\(\) \{[\s\S]*?\n\}/,
  `async function initializeSdk() {
  if (!sdkPromise) {
    sdkPromise = withTimeout(
      initSDK({ tfheParams: TFHE_WASM_URL, kmsParams: KMS_WASM_URL }),
      30_000,
      "Zama FHE SDK initialization timed out. Check network connectivity and retry.",
    ).catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

async function relayer() {
  if (!relayerPromise) {
    await initializeSdk();

    // Zama's official ERC-7984 frontend uses the v2 relayer route explicitly.
    const relayerUrl = SepoliaConfig.relayerUrl.endsWith("/v2")
      ? SepoliaConfig.relayerUrl
      : \`${SepoliaConfig.relayerUrl}/v2\`;
    const config = {
      ...SepoliaConfig,
      relayerUrl,
      relayerRouteVersion: 2 as const,
      network: SEPOLIA_RPC_URL,
    };

    relayerPromise = withTimeout(
      createInstance(config),
      45_000,
      "Zama relayer initialization timed out. Check relayer connectivity and retry.",
    ).catch((error) => {
      // Never preserve a failed/stalled browser instance across retries.
      relayerPromise = null;
      throw error;
    });
  }
  return relayerPromise;
}`,
);

client = replaceRegex(
  client,
  "operator read timeout",
  /export async function ensurePoolOperator\(signer: JsonRpcSigner\) \{[\s\S]*?\n\}/,
  `export async function ensurePoolOperator(signer: JsonRpcSigner) {
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
}`,
);

client = replaceRegex(
  client,
  "deposit function",
  /export async function sealDeposit\(signer: JsonRpcSigner, amount: bigint\) \{[\s\S]*?\n\}/,
  `export async function sealDeposit(
  signer: JsonRpcSigner,
  amount: bigint,
  onStep?: (message: string) => void,
) {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

  onStep?.("Checking VEIL pool authorization…");
  const operatorAdded = await ensurePoolOperator(signer);
  onStep?.(
    operatorAdded
      ? "Pool authorization confirmed. Initializing Zama FHE…"
      : "Pool already authorized. Initializing Zama FHE…",
  );

  const address = await signer.getAddress();
  let encrypted;
  try {
    const fhe = await relayer();
    onStep?.("Zama FHE ready. Encrypting deposit locally…");
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
}`,
);

app = replaceRegex(
  app,
  "deposit call progress",
  /if \(panel === "deposit"\) await sealDeposit\(signer, value\);/,
  `if (panel === "deposit") await sealDeposit(signer, value, setNotice);`,
);

fs.writeFileSync(clientPath, client);
fs.writeFileSync(appPath, app);
console.log("Patched browser FHE flow: Zama v2 relayer + bounded initialization + explicit deposit phases.");
