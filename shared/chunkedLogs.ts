/**
 * Query an inclusive block range in bounded chunks.
 *
 * Sepolia's public RPC endpoints used by the app accept only small
 * eth_getLogs ranges, so callers must keep every request within this limit.
 */
export const DEFAULT_LOG_CHUNK_SIZE = 10;

export async function queryLogsInChunks<T>(
  query: (fromBlock: number, toBlock: number) => Promise<T[]>,
  fromBlock: number,
  latestBlock: number,
  chunkSize = DEFAULT_LOG_CHUNK_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
    throw new Error("fromBlock must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
    throw new Error("latestBlock must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > DEFAULT_LOG_CHUNK_SIZE) {
    throw new Error(`chunkSize must be between 1 and ${DEFAULT_LOG_CHUNK_SIZE}`);
  }
  if (fromBlock > latestBlock) return [];

  const events: T[] = [];
  for (let chunkFrom = fromBlock; chunkFrom <= latestBlock; ) {
    const chunkTo = Math.min(latestBlock, chunkFrom + chunkSize - 1);
    events.push(...(await query(chunkFrom, chunkTo)));
    if (chunkTo === latestBlock) break;
    chunkFrom = chunkTo + 1;
  }
  return events;
}
