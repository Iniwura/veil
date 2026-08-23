import fs from "node:fs";

const clientPath = "frontend/src/veilClient.ts";
let client = fs.readFileSync(clientPath, "utf8");

const oldNeedle = "network: SEPOLIA_RPC_URL,";
const newNeedle = "network: injectedProvider(),";

if (!client.includes(newNeedle)) {
  if (!client.includes(oldNeedle)) {
    throw new Error("Upgrade failed: expected FHE network configuration not found");
  }
  client = client.replace(oldNeedle, newNeedle);
}

// Reconnects should never reuse an FHE instance created for a prior wallet/provider session.
const connectNeedle = "await ensureSepolia(ethereum);\n  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);";
const connectReplacement = "await ensureSepolia(ethereum);\n  relayerPromise = null;\n  const provider: EthersBrowserProvider = new BrowserProvider(ethereum);";
if (!client.includes("await ensureSepolia(ethereum);\n  relayerPromise = null;")) {
  if (!client.includes(connectNeedle)) {
    throw new Error("Upgrade failed: connectWallet insertion point not found");
  }
  client = client.replace(connectNeedle, connectReplacement);
}

fs.writeFileSync(clientPath, client);

const checks = {
  walletProvider: client.includes("network: injectedProvider(),"),
  resetOnConnect: client.includes("await ensureSepolia(ethereum);\n  relayerPromise = null;"),
  v2Route: client.includes("relayerRouteVersion: 2"),
};

if (Object.values(checks).some((value) => !value)) {
  throw new Error(`Upgrade verification failed: ${JSON.stringify(checks)}`);
}

console.log("Zama wallet-provider FHE upgrade applied and verified:", checks);
