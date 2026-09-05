/**
 * Wait for a transaction without ever timing out the wallet submission.
 *
 * A signer call can resolve after an arbitrary amount of time (and may even
 * already have been broadcast while the wallet promise is still pending).
 * Therefore the submission promise is deliberately awaited as-is. Receipt
 * waiting also remains live; the optional timer only reports a pending state
 * and never rejects or releases the caller's in-flight action.
 */
export type SubmittedTransactionLike<Receipt> = {
  readonly hash: string;
  wait: () => Promise<Receipt | null>;
};

export type SafeTransactionResult<Receipt> = {
  hash: string;
  receipt: Receipt | null;
  pendingNoticeShown: boolean;
};

export const DEFAULT_RECEIPT_PENDING_NOTICE_MS = 120_000;

export async function waitForSubmittedTransaction<Receipt, Transaction extends SubmittedTransactionLike<Receipt>>(
  submission: Promise<Transaction> | Transaction,
  onPending?: (hash: string) => void,
  pendingNoticeMs = DEFAULT_RECEIPT_PENDING_NOTICE_MS,
): Promise<SafeTransactionResult<Receipt>> {
  // Never put a local timeout around this await. The wallet may still submit
  // the transaction after a provider/UI timeout, so rejecting here would make
  // a retry appear safe when it is not.
  const transaction = await submission;
  let pendingNoticeShown = false;
  const reportPending = onPending ?? ((hash: string) => console.info(`[UNVEIL] SUBMITTED/PENDING · ${hash}`));
  const timer = setTimeout(() => {
    pendingNoticeShown = true;
    reportPending(transaction.hash);
  }, pendingNoticeMs);

  try {
    const receipt = await transaction.wait();
    return { hash: transaction.hash, receipt, pendingNoticeShown };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
