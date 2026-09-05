/** Ethereum Sepolia (EIP-155). */
export const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Read-only browser endpoints.  These are deliberately separate from the
 * connected-wallet provider used for writes.
 *
 * Public 1RPC documents this URL as Ethereum Sepolia (chain 11155111).
 */
export const SEPOLIA_READ_RPC_URLS = Object.freeze([
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://public.1rpc.io/sepolia",
] as const);

export type ReadEndpoint<T> = {
  checkChainId: () => Promise<number | bigint | string>;
  read: () => Promise<T>;
};

/**
 * Try read endpoints one at a time, starting with the last known-good one.
 * An endpoint is never used until its chain id has been checked.  This keeps
 * a stale/wrong-network public endpoint from being accepted as a fallback and
 * avoids the request fan-out of ethers' quorum FallbackProvider.
 */
export async function readWithSepoliaFallback<T>(
  endpoints: readonly ReadEndpoint<T>[],
  preferredIndex = 0,
  expectedChainId = SEPOLIA_CHAIN_ID,
): Promise<{ value: T; index: number }> {
  if (!endpoints.length) throw new Error("No Sepolia read endpoints configured.");
  const start = ((preferredIndex % endpoints.length) + endpoints.length) % endpoints.length;
  let lastError: unknown;
  for (let offset = 0; offset < endpoints.length; offset += 1) {
    const index = (start + offset) % endpoints.length;
    const endpoint = endpoints[index];
    try {
      const chainId = BigInt(await endpoint.checkChainId());
      if (chainId !== BigInt(expectedChainId)) {
        throw new Error(`Sepolia read endpoint returned chain ${chainId.toString()}.`);
      }
      return { value: await endpoint.read(), index };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Sepolia read endpoints failed.");
}
