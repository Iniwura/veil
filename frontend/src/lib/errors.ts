export function productError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : "";
  if (message.toLowerCase().includes("wallet account changed"))
    return "Wallet account changed. Reconnect to load the current account.";
  if (code === 4001 || message.toLowerCase().includes("user rejected")) return "Request cancelled in your wallet.";
  if (message.toLowerCase().includes("insufficient funds")) return "Not enough Sepolia ETH to pay network gas.";
  if (message.startsWith("UNVEIL_TEST_FUNDING_FAILED:"))
    return "Demo cUSDC mint, approval, or confidential wrapping failed.";
  if (message.startsWith("UNVEIL_OPERATOR_AUTH_FAILED:"))
    return "Pool authorization failed. Approve the confidential principal operator request.";
  if (message.startsWith("UNVEIL_ENCRYPTION_FAILED:"))
    return "Encryption failed. Reconnect the wallet and the Zama relayer, then retry.";
  if (message.startsWith("UNVEIL_DEPOSIT_FAILED:")) return "The pool rejected this encrypted deposit.";
  if (message.startsWith("UNVEIL_WITHDRAW_FAILED:")) return "The pool rejected this withdrawal request.";
  if (message.startsWith("UNVEIL_PRIZE_WINNER_ONLY:"))
    return "Only the finalized winner can unveil this delivered prize.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_ROUTE_INVALID:"))
    return "Prize balance redemption route is unavailable for this V4 deployment.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_START_FAILED:"))
    return "Confidential prize redemption could not start. Check the wallet and try again.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_LIFECYCLE_FAILED:"))
    return "The prize redemption route could not advance. Check the wallet and retry the available step.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_STATE_CHANGED:"))
    return "The prize redemption state changed before submission. Review the latest batch state.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_NOT_ACTIONABLE:"))
    return "That prize redemption step is not available yet.";
  if (message.startsWith("UNVEIL_PRIZE_REDEMPTION_STATE_UNEXPECTED:"))
    return "The prize redemption batch state needs review before it can continue.";
  if (message.startsWith("UNVEIL_ROUND_WEIGHT_UNAVAILABLE:"))
    return "Round data unavailable. This wallet was not included in that historical round.";
  if (message.startsWith("UNVEIL_MANAGER_REQUEST_UNAVAILABLE:"))
    return "The strategy manager cannot provide this withdrawal request yet.";
  if (message.startsWith("UNVEIL_WITHDRAWAL_KMS_UNAVAILABLE:"))
    return "Zama/KMS proof is unavailable. The withdrawal remains encrypted; retry when verification is available.";
  if (message.startsWith("UNVEIL_WITHDRAWAL_STATE_CHANGED:"))
    return "Withdrawal state changed before submission. The latest state has been loaded; review the next step.";
  if (message.startsWith("UNVEIL_WITHDRAWAL_NOT_ACTIONABLE:"))
    return "That withdrawal step is no longer available. Review the latest public request state.";
  if (message.startsWith("UNVEIL_WITHDRAWAL_LIFECYCLE_FAILED:"))
    return "The permissionless withdrawal step could not be completed. Check the wallet and retry.";
  if (message.includes("UNVEIL_DRAW_STATE_CHANGED:"))
    return "Protocol state changed before submission. The latest state has been loaded; review the next step.";
  if (message.startsWith("UNVEIL_DRAW_NOT_ACTIONABLE:"))
    return "That draw step is no longer available. Review the latest public state.";
  if (message.startsWith("UNVEIL_DRAW_ADVANCE_FAILED:"))
    return "The permissionless draw step could not be completed. Check the wallet and retry.";
  if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("did not respond"))
    return "The wallet, relayer, or Sepolia request timed out. Check pending wallet activity.";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("sepolia"))
    return "UNVEIL requires Sepolia. Switch networks and reconnect.";
  if (message.includes("CALL_EXCEPTION") || message.includes("missing revert data"))
    return "This action is not available for the connected wallet right now.";
  return "UNVEIL could not complete that action. Try again after checking the wallet and network.";
}

export { historicalRoundNotIncludedMessage, isHistoricalRoundNotIncluded } from "../../../shared/frontendPresentation";
