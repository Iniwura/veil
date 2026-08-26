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
    return "TEST TOKEN mint, approval, or confidential wrapping failed.";
  if (message.startsWith("UNVEIL_OPERATOR_AUTH_FAILED:"))
    return "Pool authorization failed. Approve the confidential principal operator request.";
  if (message.startsWith("UNVEIL_ENCRYPTION_FAILED:"))
    return "Encryption failed. Reconnect the wallet and the Zama relayer, then retry.";
  if (message.startsWith("UNVEIL_DEPOSIT_FAILED:")) return "The V2 pool rejected this encrypted deposit.";
  if (message.startsWith("UNVEIL_WITHDRAW_FAILED:")) return "The V2 pool rejected this withdrawal request.";
  if (message.startsWith("UNVEIL_PRIZE_WINNER_ONLY:"))
    return "Only the finalized winner can unveil this delivered prize.";
  if (message.startsWith("UNVEIL_ROUND_WEIGHT_UNAVAILABLE:"))
    return "Your wallet was not included in that historical round.";
  if (message.startsWith("UNVEIL_MANAGER_REQUEST_UNAVAILABLE:"))
    return "The strategy manager cannot provide this withdrawal request yet.";
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
