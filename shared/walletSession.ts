export type WalletButtonAction = "connect" | "switch-network" | "open-menu";

export function walletButtonAction({
  connected,
  wrongNetwork,
}: {
  connected: boolean;
  wrongNetwork: boolean;
}): WalletButtonAction {
  if (wrongNetwork) return "switch-network";
  if (connected) return "open-menu";
  return "connect";
}

export type WalletSessionEpoch = {
  walletEpoch: number;
  connectAttempt: number;
};

export function advanceWalletSessionEpoch(
  current: WalletSessionEpoch,
  invalidateConnectAttempt = true,
): WalletSessionEpoch {
  return {
    walletEpoch: current.walletEpoch + 1,
    connectAttempt: current.connectAttempt + (invalidateConnectAttempt ? 1 : 0),
  };
}

export function isCurrentWalletOperation(current: WalletSessionEpoch, operation: WalletSessionEpoch): boolean {
  return current.walletEpoch === operation.walletEpoch && current.connectAttempt === operation.connectAttempt;
}
