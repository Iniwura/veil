type WalletPresentationInput = {
  busy: string;
  wrongNetwork: boolean;
  address?: string;
  walletState: string;
};

export function walletActionLabel({ busy, wrongNetwork, address, walletState }: WalletPresentationInput) {
  if (busy === "switch-network") return "SWITCHING…";
  if (wrongNetwork) return "SWITCH TO SEPOLIA";
  if (busy === "connect") return "CONNECTING…";
  if (address) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (walletState === "reconnect-required" || walletState === "account-changed") return "RECONNECT WALLET";
  return "CONNECT WALLET";
}
