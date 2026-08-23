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
  "relayer timeout",
  /async function relayer\(\) \{[\s\S]*?\n\}/,
  `async function relayer() {
  if (!relayerPromise) {
    await initializeSdk();
    relayerPromise = withTimeout(
      createInstance({ ...SepoliaConfig, network: SEPOLIA_RPC_URL }),
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
console.log("Patched deposit diagnostics: explicit phases + 45s Zama relayer initialization timeout.");
