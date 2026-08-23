import fs from "node:fs";

const clientPath = "frontend/src/veilClient.ts";
let client = fs.readFileSync(clientPath, "utf8");

function replaceFunction(source, label, signature, replacement) {
  const regex = new RegExp(`${signature}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
  if (!regex.test(source)) throw new Error(`Upgrade failed: ${label} function not found`);
  return source.replace(regex, replacement);
}

if (!client.includes("Zama FHE SDK initialization timed out")) {
  client = replaceFunction(
    client,
    "initializeSdk",
    "async function initializeSdk\\(\\)",
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
}`,
  );
}

if (!client.includes("relayerRouteVersion: 2")) {
  client = replaceFunction(
    client,
    "relayer",
    "async function relayer\\(\\)",
    `async function relayer() {
  if (!relayerPromise) {
    await initializeSdk();

    // Match Zama's official ERC-7984 browser configuration.
    const relayerUrl = SepoliaConfig.relayerUrl.endsWith("/v2")
      ? SepoliaConfig.relayerUrl
      : SepoliaConfig.relayerUrl + "/v2";

    relayerPromise = withTimeout(
      createInstance({
        ...SepoliaConfig,
        relayerUrl,
        relayerRouteVersion: 2,
        network: SEPOLIA_RPC_URL,
      }),
      45_000,
      "Zama relayer initialization timed out. Check relayer connectivity and retry.",
    ).catch((error) => {
      relayerPromise = null;
      throw error;
    });
  }
  return relayerPromise;
}`,
  );
}

if (!client.includes("Sepolia did not respond while checking VEIL pool authorization")) {
  client = replaceFunction(
    client,
    "ensurePoolOperator",
    "export async function ensurePoolOperator\\(signer: JsonRpcSigner\\)",
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
}

fs.writeFileSync(clientPath, client);

const checks = {
  sdkTimeout: client.includes("Zama FHE SDK initialization timed out"),
  v2Url: client.includes('SepoliaConfig.relayerUrl + "/v2"'),
  v2Route: client.includes("relayerRouteVersion: 2"),
  operatorTimeout: client.includes("Sepolia did not respond while checking VEIL pool authorization"),
};

if (Object.values(checks).some((value) => !value)) {
  throw new Error(`Upgrade verification failed: ${JSON.stringify(checks)}`);
}

console.log("Zama browser FHE upgrade applied and verified:", checks);
