import fs from "node:fs";

const clientPath = "frontend/src/veilClient.ts";
let client = fs.readFileSync(clientPath, "utf8");

const typeImport =
  'import type { FhevmInstance, FhevmInstanceConfig } from "@zama-fhe/relayer-sdk/bundle";\n';

if (!client.includes(typeImport.trim())) {
  const contractsImport = 'import { VEIL_CONTRACTS, VEIL_NETWORK } from "./contracts";\n';
  if (!client.includes(contractsImport)) {
    throw new Error("Type fix failed: contracts import insertion point not found");
  }
  client = client.replace(contractsImport, contractsImport + typeImport);
}

const oldSdkType = /type ZamaRelayerSDK = \{[\s\S]*?\n\};/;
if (!oldSdkType.test(client)) {
  throw new Error("Type fix failed: ZamaRelayerSDK type block not found");
}
client = client.replace(
  oldSdkType,
  `type ZamaRelayerSDK = {
  initSDK: (options?: Record<string, unknown>) => Promise<boolean>;
  createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;
  SepoliaConfig: FhevmInstanceConfig & { relayerUrl: string };
  __initialized__?: boolean;
};`,
);

client = client.replace(
  "let relayerPromise: Promise<any> | null = null;",
  "let relayerPromise: Promise<FhevmInstance> | null = null;",
);

fs.writeFileSync(clientPath, client);

const checks = {
  typeOnlyImport: client.includes('import type { FhevmInstance, FhevmInstanceConfig } from "@zama-fhe/relayer-sdk/bundle";'),
  typedCreateInstance: client.includes("createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;"),
  typedRelayerPromise: client.includes("let relayerPromise: Promise<FhevmInstance> | null = null;"),
  cdnRuntime: client.includes("window.relayerSDK"),
  noWebRuntimeImport: !client.includes('from "@zama-fhe/relayer-sdk/web"'),
};

if (Object.values(checks).some((value) => !value)) {
  throw new Error(`Type fix verification failed: ${JSON.stringify(checks)}`);
}

console.log("Zama CDN runtime types fixed and verified:", checks);
