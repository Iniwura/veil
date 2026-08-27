import type { DrawAction } from "../lib/drawAdvance";
import { DrawLifecycleRail } from "./DrawLifecycleRail";

export function DrawAdvancePanel({
  action,
  connected,
  wrongNetwork,
  busy,
  onAdvance,
  onConnect,
  onSwitchNetwork,
  terminalState,
}: {
  action?: DrawAction;
  connected: boolean;
  wrongNetwork: boolean;
  busy: string;
  onAdvance: (action: DrawAction) => void;
  onConnect: () => void;
  onSwitchNetwork: () => void;
  terminalState?: "SKIPPED" | "CANCELLED" | "COMPLETE";
}) {
  const actionable = Boolean(action?.actionable);
  const showButton = actionable && Boolean(action);
  const busyAdvancing = busy === "advance-draw";
  const buttonLabel = !connected
    ? wrongNetwork
      ? "SWITCH TO SEPOLIA"
      : "CONNECT TO ADVANCE"
    : busyAdvancing
      ? "ADVANCING…"
      : `ADVANCE: ${action?.title ?? "DRAW"}`;

  return (
    <section
      className={`draw-advance-panel draw-advance-panel--${action?.kind.toLowerCase() ?? "loading"}`}
      aria-live="polite"
      data-tour="draw-advance"
    >
      <div className="draw-advance-heading">
        <span className="eyebrow">{action?.kind === "WAIT" ? "NEXT STEP" : "NEXT PERMISSIONLESS STEP"}</span>
        <strong>{action?.title ?? "LOADING DRAW STATE"}</strong>
      </div>
      <p className="draw-advance-description">
        {action?.description ?? "Reading the public lifecycle state from the V2 contracts."}
      </p>
      {showButton && (
        <button
          className="button-primary draw-advance-button"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            if (!action) return;
            if (wrongNetwork) onSwitchNetwork();
            else if (!connected) onConnect();
            else onAdvance(action);
          }}
          aria-label={buttonLabel}
        >
          {buttonLabel}
        </button>
      )}
      {action?.kind === "BLOCKED" && (
        <p className="draw-advance-warning">PUBLIC STATE NEEDS REVIEW · NO RECOVERY TRANSACTION</p>
      )}
      <DrawLifecycleRail action={action} terminalState={terminalState} />
      <p className="draw-advance-note">
        Permissionless · any Sepolia wallet can execute · private balances and weights remain encrypted.
      </p>
    </section>
  );
}
