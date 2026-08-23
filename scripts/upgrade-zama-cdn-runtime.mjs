import fs from "node:fs";

const clientPath = "frontend/src/veilClient.ts";
const indexPath = "frontend/index.html";
let client = fs.readFileSync(clientPath, "utf8");
let index = fs.readFileSync(indexPath, "utf8");

const CDN_URL = "https://cdn.zama.org/relayer-sdk-js/0.4.1/relayer-sdk-js.umd.cjs";

function replaceFunction(source, label, signature, replacement) {
  const regex = new RegExp(`${signature}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
  if (!regex.test(source)) throw new Error(`Upgrade failed: ${label} function not found`);
  return source.replace(regex, replacement);
}

// Zama's official browser examples load the Relayer SDK as a UMD browser bundle.
if (!index.includes(CDN_URL)) {
  const mainScript = '    <script type="module" src="/src/main.tsx"></script>';
  if (!index.includes(mainScript)) throw new Error("Upgrade failed: frontend module script not found");
  index = index.replace(
    mainScript,
    `    <script src="${CDN_URL}" type="text/javascript"></script>\n${mainScript}`,
  );
}

// Stop bundling/bootstrapping the Relayer SDK WASM through Vite. The browser CDN owns it.
client = client.replace(
  'import { createInstance, initSDK, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";\n',
  "",
);

if (!client.includes("type ZamaRelayerSDK")) {
  const insertionPoint = "type EthereumProvider = Eip1193Provider & {";
  if (!client.includes(insertionPoint)) throw new Error("Upgrade failed: EthereumProvider type not found");
  client = client.replace(
    insertionPoint,
    `type ZamaRelayerSDK = {\n  initSDK: (options?: Record<string, unknown>) => Promise<boolean>;\n  createInstance: (config: Record<string, unknown>) => Promise<any>;\n  SepoliaConfig: Record<string, any> & { relayerUrl: string };\n  __initialized__?: boolean;\n};\n\n${insertionPoint}`,
  );
}

if (!client.includes("relayerSDK?: ZamaRelayerSDK;")) {
  const windowNeedle = "  interface Window {\n    ethereum?: EthereumProvider;";
  if (!client.includes(windowNeedle)) throw new Error("Upgrade failed: Window interface not found");
  client = client.replace(
    windowNeedle,
    "  interface Window {\n    ethereum?: EthereumProvider;\n    relayerSDK?: ZamaRelayerSDK;",
  );
}

client = client.replace(
  "let relayerPromise: ReturnType<typeof createInstance> | null = null;",
  "let relayerPromise: Promise<any> | null = null;",
);

client = replaceFunction(
  client,
  "initializeSdk",
  "async function initializeSdk\\(\\)",
  `async function initializeSdk() {
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
}`,
);

client = replaceFunction(
  client,
  "relayer",
  "async function relayer\\(\\)",
  `async function relayer() {
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
}`,
);

fs.writeFileSync(clientPath, client);
fs.writeFileSync(indexPath, index);

const checks = {
  cdnRuntime: index.includes(CDN_URL),
  globalSdk: client.includes("window.relayerSDK"),
  noDirectWebImport: !client.includes('@zama-fhe/relayer-sdk/web'),
  v2Route: client.includes("relayerRouteVersion: 2"),
  walletProvider: client.includes("network: injectedProvider(),"),
  noInitTimeout: !client.includes("Zama FHE SDK initialization timed out"),
};

if (Object.values(checks).some((value) => !value)) {
  throw new Error(`Upgrade verification failed: ${JSON.stringify(checks)}`);
}

console.log("Zama official browser runtime upgrade applied and verified:", checks);
