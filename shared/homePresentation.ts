export type HomeActionKind =
  | "CONNECT"
  | "SWITCH_NETWORK"
  | "UNVEIL"
  | "SAVE"
  | "VIEW_DRAW"
  | "VIEW_PRIZE"
  | "CONTINUE_WITHDRAWAL"
  | "REDEEM_PRIZE"
  | "WAIT";

export type HomeAction = {
  kind: HomeActionKind;
  label: string;
  description: string;
  passive: boolean;
  href?: "/app/save" | "/app/draw";
};

export type HomeActionInput = {
  connected: boolean;
  wrongNetwork: boolean;
  accountReady: boolean;
  vaultRevealed: boolean;
  busy?: string;
  pendingSeatAttestation: boolean;
  joined: boolean;
  seated: boolean;
  connectedWinner: boolean;
  withdrawalActionable: boolean;
  redemptionActionable: boolean;
  keeperSettling: boolean;
};

export type HomePersonalSignal = {
  kind: "WINNER" | "WITHDRAWAL" | "ATTESTATION" | "SEAT";
  label: string;
  detail?: string;
  href?: "/app/save" | "/app/draw";
  actionLabel?: string;
};

export type HomeWinnerSignal = {
  roundId: bigint;
  prizeIndex: number;
};

const KEEPER_DRAW_ACTIONS = new Set([
  "SNAPSHOT",
  "SKIP",
  "BLIND_DRAW",
  "FINALIZE_WINNER",
  "PROCESS_PRIZE",
  "BEGIN_SNAPSHOT",
  "SNAPSHOT_SHARD",
  "COMPLETE_SNAPSHOT",
  "DRAW_SHARD",
  "FINALIZE_SHARD",
  "DRAW_MEMBER",
  "FINALIZE_MEMBER",
  "FUND_PRIZE",
  "DELIVER_PRIZE",
  "ADVANCE_NO_PRIZE",
]);

export function isKeeperSettlementAction(kind?: string) {
  return Boolean(kind && KEEPER_DRAW_ACTIONS.has(kind));
}

export function deriveHomeNextAction(input: HomeActionInput): HomeAction {
  if (input.wrongNetwork) {
    return {
      kind: "SWITCH_NETWORK",
      label: "SWITCH NETWORK",
      description: "Switch the connected wallet to Sepolia before using private account actions.",
      passive: false,
    };
  }
  if (!input.connected) {
    return {
      kind: "CONNECT",
      label: "CONNECT WALLET",
      description: "Connect a Sepolia wallet to inspect your private position and saver state.",
      passive: false,
    };
  }
  if (!input.accountReady) {
    return {
      kind: "WAIT",
      label: "LOADING ACCOUNT",
      description: "Reading this wallet's public account state.",
      passive: true,
    };
  }
  if (input.busy === "reveal-vault") {
    return {
      kind: "WAIT",
      label: "UNVEILING POSITION",
      description: "Your private values are resolving locally. Keep this window open.",
      passive: true,
    };
  }
  if (input.withdrawalActionable) {
    return {
      kind: "CONTINUE_WITHDRAWAL",
      label: "CONTINUE WITHDRAWAL",
      description: "A real withdrawal lifecycle step is ready for this wallet.",
      passive: false,
      href: "/app/save",
    };
  }
  if (input.redemptionActionable) {
    return {
      kind: "REDEEM_PRIZE",
      label: "REDEEM PRIZE",
      description: "A confidential prize redemption step is ready for this wallet.",
      passive: false,
      href: "/app/save",
    };
  }
  if (input.connectedWinner) {
    return {
      kind: "VIEW_PRIZE",
      label: "VIEW PRIZE",
      description: "A verified result includes this wallet. Prize amounts remain sealed until local reveal.",
      passive: false,
      href: "/app/draw",
    };
  }
  if (!input.vaultRevealed) {
    return {
      kind: "UNVEIL",
      label: "UNVEIL MY BALANCES",
      description: "Reveal your four private balances locally for this browser session.",
      passive: false,
    };
  }
  if (input.pendingSeatAttestation) {
    return {
      kind: "WAIT",
      label: "KMS ATTESTATION PENDING",
      description: "A permissionless keeper will complete the positive-balance seat attestation.",
      passive: true,
    };
  }
  if (input.keeperSettling) {
    return {
      kind: "WAIT",
      label: "KEEPER SETTLING",
      description: "The permissionless keeper is advancing the public draw. No saver wallet action is required.",
      passive: true,
    };
  }
  if (!input.joined || !input.seated) {
    return {
      kind: "SAVE",
      label: "SAVE PRIVATELY",
      description: "Move confidential cUSDC into your private UNVEIL position.",
      passive: false,
      href: "/app/save",
    };
  }
  if (input.seated) {
    return {
      kind: "VIEW_DRAW",
      label: "VIEW DRAW",
      description: "Inspect the current public round and verified draw history.",
      passive: false,
      href: "/app/draw",
    };
  }
  return {
    kind: "WAIT",
    label: "NO ACTION REQUIRED",
    description: "Your public account state is current.",
    passive: true,
  };
}

export function deriveHomePersonalSignal(input: {
  winner?: HomeWinnerSignal;
  withdrawalActionable: boolean;
  pendingSeatAttestation: boolean;
  seated: boolean;
}): HomePersonalSignal | undefined {
  if (input.winner) {
    return {
      kind: "WINNER",
      label: `YOU WON · ROUND ${input.winner.roundId.toString()} · PRIZE ${input.winner.prizeIndex + 1}`,
      href: "/app/draw",
      actionLabel: "VIEW →",
    };
  }
  if (input.withdrawalActionable) {
    return {
      kind: "WITHDRAWAL",
      label: "WITHDRAWAL READY",
      href: "/app/save",
      actionLabel: "CONTINUE →",
    };
  }
  if (input.pendingSeatAttestation) {
    return { kind: "ATTESTATION", label: "KMS ATTESTATION PENDING" };
  }
  if (input.seated) {
    return { kind: "SEAT", label: "SEAT ACTIVE" };
  }
  return undefined;
}

export const HOME_PROTOCOL_CAPACITY_LABEL = "576 MAX";
export const DASHBOARD_SEALED_SEGMENTS = [74, 42, 88, 56, 68, 36, 92, 50] as const;
