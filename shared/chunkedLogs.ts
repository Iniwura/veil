/**
 * Query an inclusive block range in bounded chunks.
 *
 * Start with a large range for hosted keeper efficiency, then automatically
 * split a rejected range until the RPC accepts it. This keeps compatibility
 * with stricter public RPCs without forcing every scan into 10-block calls.
 */
export const DEFAULT_LOG_CHUNK_SIZE = 1000;
const MIN_LOG_CHUNK_SIZE = 10;

async function queryAdaptive<T>(
  query: (fromBlock: number, toBlock: number) => Promise<T[]>,
  fromBlock: number,
  toBlock: number,
): Promise<T[]> {
  try {
    return await query(fromBlock, toBlock);
  } catch (error) {
    const span = toBlock - fromBlock + 1;
    if (span <= MIN_LOG_CHUNK_SIZE) throw error;

    const midpoint = Math.floor((fromBlock + toBlock) / 2);
    const left = await queryAdaptive(query, fromBlock, midpoint);
    const right = await queryAdaptive(query, midpoint + 1, toBlock);
    return [...left, ...right];
  }
}

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
    events.push(...(await queryAdaptive(query, chunkFrom, chunkTo)));
    if (chunkTo === latestBlock) break;
    chunkFrom = chunkTo + 1;
  }
  return events;
}
