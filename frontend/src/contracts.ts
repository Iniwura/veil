const PENDING_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZAMA_SEPOLIA_CUSDC_MOCK = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";

export const UNVEIL_NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

/**
 * The three protocol addresses intentionally default to the zero address until
 * the current UNVEIL build is freshly deployed. This prevents the rewritten
 * frontend from silently calling the superseded VEIL deployment with an
 * incompatible ABI.
 *
 * A local/Vercel preview can point at a fresh deployment through Vite env vars;
 * after final Sepolia validation we also commit the canonical addresses here.
 */
export const UNVEIL_CONTRACTS = {
  asset: import.meta.env.VITE_UNVEIL_ASSET_ADDRESS || ZAMA_SEPOLIA_CUSDC_MOCK,
  pool: import.meta.env.VITE_UNVEIL_POOL_ADDRESS || PENDING_ADDRESS,
  yieldSource: import.meta.env.VITE_UNVEIL_YIELD_SOURCE_ADDRESS || PENDING_ADDRESS,
  prizeVault: import.meta.env.VITE_UNVEIL_PRIZE_VAULT_ADDRESS || PENDING_ADDRESS,
} as const;

export const UNVEIL_DEPLOYMENT_READY =
  UNVEIL_CONTRACTS.pool !== PENDING_ADDRESS &&
  UNVEIL_CONTRACTS.yieldSource !== PENDING_ADDRESS &&
  UNVEIL_CONTRACTS.prizeVault !== PENDING_ADDRESS;

// Backwards-compatible internal aliases while the source tree is migrated from
// the original VEIL prototype naming. Product copy should use UNVEIL.
export const VEIL_NETWORK = UNVEIL_NETWORK;
export const VEIL_CONTRACTS = UNVEIL_CONTRACTS;

export const DEMO_ONLY = true;
