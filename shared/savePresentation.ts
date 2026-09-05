export type SaveActionKind =
  | "CONNECT"
  | "SWITCH_NETWORK"
  | "SAVE_PRIVATELY"
  | "SAVE_MORE"
  | "WITHDRAW"
  | "CONTINUE_WITHDRAWAL"
  | "CONTINUE_REDEMPTION"
  | "RECOVER_REDEMPTION";

export type SaveAction = { kind: SaveActionKind; label: string };

export type SaveSourceKind = "available" | "saved" | "prize";

export function saveSourceUnit(source: SaveSourceKind) {
  return source === "prize" ? "VAULT SHARE UNITS" : "cUSDC";
}

export function saveSourceSummary(source: SaveSourceKind, revealed: boolean, value?: bigint) {
  return revealed ? `${value?.toString() ?? "0"} ${saveSourceUnit(source)}` : "FHE SEALED";
}

/** A submitted transaction must never be offered a retry from a stale UI error. */
export function isRetryableSaveError(error: string, notice: string) {
  const combined = `${error} ${notice}`.toLowerCase();
  return Boolean(error) && !/(submitted|pending|confirmation)/.test(combined);
}

/** Select useful actions without treating a sealed confidential position as zero. */
export function deriveSaveActions({
  connected,
  wrongNetwork,
  accountReady,
  joined,
  vaultRevealed,
  activePrincipal = 0n,
  reservedPrincipal = 0n,
  prizeBalance = 0n,
  withdrawalActionable,
  hasWithdrawalState,
  redemptionActionable,
  recoveryPending,
}: {
  connected: boolean;
  wrongNetwork: boolean;
  accountReady: boolean;
  joined: boolean;
  vaultRevealed: boolean;
  activePrincipal?: bigint;
  reservedPrincipal?: bigint;
  prizeBalance?: bigint;
  withdrawalActionable: boolean;
  hasWithdrawalState: boolean;
  redemptionActionable: boolean;
  recoveryPending: boolean;
}): SaveAction[] {
  if (wrongNetwork) return [{ kind: "SWITCH_NETWORK", label: "SWITCH TO SEPOLIA →" }];
  if (!connected) return [{ kind: "CONNECT", label: "CONNECT WALLET →" }];
  if (!accountReady) return [];

  const contextual: SaveAction[] = [];
  if (withdrawalActionable) contextual.push({ kind: "CONTINUE_WITHDRAWAL", label: "CONTINUE WITHDRAWAL →" });
  if (recoveryPending) contextual.push({ kind: "RECOVER_REDEMPTION", label: "RECOVER REDEMPTION →" });
  if (redemptionActionable) contextual.push({ kind: "CONTINUE_REDEMPTION", label: "CONTINUE REDEMPTION →" });

  const meaningfulState =
    joined ||
    hasWithdrawalState ||
    recoveryPending ||
    redemptionActionable ||
    prizeBalance > 0n ||
    activePrincipal > 0n ||
    reservedPrincipal > 0n;
  const withdrawable = !vaultRevealed
    ? joined || hasWithdrawalState || recoveryPending || redemptionActionable
    : activePrincipal > 0n ||
      reservedPrincipal > 0n ||
      prizeBalance > 0n ||
      hasWithdrawalState ||
      recoveryPending ||
      redemptionActionable;

  if (!meaningfulState) return [{ kind: "SAVE_PRIVATELY", label: "SAVE PRIVATELY →" }];
  const actions: SaveAction[] = [...contextual, { kind: "SAVE_MORE", label: "SAVE MORE →" }];
  if (withdrawable) actions.push({ kind: "WITHDRAW", label: "WITHDRAW →" });
  return actions;
}
