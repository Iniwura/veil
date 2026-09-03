const TRANSIENT_DECRYPT_ERRORS = ["gao decoding failure", "error reconstructing all blocks"] as const;

export const MAX_DECRYPT_ATTEMPTS = 5;
export const DECRYPT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 2_000;

type UnknownRecord = Record<string, unknown>;

export type DecryptRetryOptions = {
  maxAttempts?: number;
  delayMs?: number;
  log?: (message: string) => void;
};

function errorText(error: unknown, seen = new Set<object>()): string {
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "";
  if (typeof error !== "object") return String(error);
  if (seen.has(error)) return "";

  seen.add(error);
  const record = error as UnknownRecord;
  const parts: string[] = [];
  for (const key of ["name", "message", "reason", "shortMessage", "details", "stack"]) {
    const value = record[key];
    if (typeof value === "string") parts.push(value);
  }
  for (const key of ["cause", "error", "info"]) {
    if (record[key] !== undefined) parts.push(errorText(record[key], seen));
  }
  try {
    parts.push(JSON.stringify(error));
  } catch {
    // Some SDK errors contain circular metadata; their message is sufficient.
  }
  return parts.join(" ");
}

export function isTransientZamaDecryptError(error: unknown): boolean {
  const normalized = errorText(error).toLowerCase();
  return TRANSIENT_DECRYPT_ERRORS.some((marker) => normalized.includes(marker));
}

function boundedAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_DECRYPT_ATTEMPTS;
  return Math.min(MAX_DECRYPT_ATTEMPTS, Math.max(1, Math.floor(value)));
}

function boundedDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DECRYPT_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.floor(value)));
}

export async function withZamaDecryptRetry<T>(
  operation: () => Promise<T>,
  options: DecryptRetryOptions = {},
): Promise<T> {
  const maxAttempts = boundedAttempts(options.maxAttempts);
  const delayMs = boundedDelay(options.delayMs);
  const log = options.log ?? (() => undefined);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientZamaDecryptError(error) || attempt >= maxAttempts) throw error;

      log(`transient Zama decrypt failure; retry ${attempt + 1}/${maxAttempts}`);
      if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Decrypt retry loop exhausted without a result");
}
