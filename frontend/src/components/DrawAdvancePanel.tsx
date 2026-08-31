import type { DrawAction } from "../lib/drawAdvance";
import type { DrawLifecycleTerminalState } from "../lib/drawLifecycle";
import { DrawLifecycleRail } from "./DrawLifecycleRail";

export function DrawAdvancePanel({
  action,
  connected,
  wrongNetwork,
  busy,
  onAdvance: _onAdvance,
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
  terminalState?: DrawLifecycleTerminalState;
}) {
  const actionable = Boolean(action?.actionable);
  const showConnectionButton = actionable && Boolean(action) && !connected;
  const keeperSettling = actionable && Boolean(action) && connected;
  const buttonLabel = wrongNetwork ? "SWITCH TO SEPOLIA" : "CONNECT TO VIEW";
  const stepLabel = action?.kind === "WAIT" ? "NEXT STEP" : "NEXT PERMISSIONLESS STEP";
  const stepRound = action ? ` · ROUND ${action.roundId.toString().padStart(2, "0")}` : "";

  return (
    <section
      className={`draw-advance-panel draw-advance-panel--${action?.kind.toLowerCase() ?? "loading"}`}
      aria-live="polite"
      data-tour="draw-advance"
    >
      <div className="draw-advance-heading">
        <span className="eyebrow">
          {stepLabel}
          {stepRound}
        </span>
        <strong>{action?.title ?? "LOADING DRAW STATE"}</strong>
      </div>
      <DrawLifecycleRail action={action} terminalState={terminalState} />
      <p className="draw-advance-description">
        {action?.description ?? "Reading the public sharded lifecycle from the live V4 contracts."}
      </p>
      {showConnectionButton && (
        <button
          className="button-primary draw-advance-button"
          data-cursor="enter"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            if (!action) return;
            if (wrongNetwork) onSwitchNetwork();
            else if (!connected) onConnect();
            else onConnect();
          }}
          aria-label={buttonLabel}
        >
          {buttonLabel}
        </button>
      )}
      {keeperSettling && (
        <p className="draw-advance-keeper-state" role="status">
          KEEPER SETTLING · DRAW SETTLING · NO SAVER WALLET ACTION
        </p>
      )}
      {action?.kind === "BLOCKED" && (
        <p className="draw-advance-warning">PUBLIC STATE NEEDS REVIEW · NO RECOVERY TRANSACTION</p>
      )}
      <p className="draw-advance-note">
        Permissionless keeper flow · snapshot batches are greedily sized below both published HCU limits.
      </p>
    </section>
  );
}
