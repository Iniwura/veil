import type { DrawAction } from "../lib/drawAdvance";

const LIFECYCLE_STEPS = [
  ["SNAPSHOT", "Freeze encrypted weights"],
  ["BLIND DRAW", "Select privately"],
  ["VERIFY", "Validate KMS proof"],
  ["DELIVER", "Send the prize"],
] as const;

function stepState(step: string, action?: DrawAction) {
  if (!action) return "";
  if (action.kind === "SKIP") return "";
  if (action.stage === step) return "active";
  const currentIndex = LIFECYCLE_STEPS.findIndex(([name]) => name === action.stage);
  const stepIndex = LIFECYCLE_STEPS.findIndex(([name]) => name === step);
  return currentIndex > stepIndex ? "complete" : "";
}

export function DrawAdvancePanel({
  action,
  connected,
  wrongNetwork,
  busy,
  onAdvance,
  onConnect,
  onSwitchNetwork,
}: {
  action?: DrawAction;
  connected: boolean;
  wrongNetwork: boolean;
  busy: string;
  onAdvance: (action: DrawAction) => void;
  onConnect: () => void;
  onSwitchNetwork: () => void;
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
      <div className="draw-lifecycle-mini" aria-label="Draw lifecycle">
        {LIFECYCLE_STEPS.map(([name, detail]) => (
          <div className={stepState(name, action)} key={name}>
            <span>{name}</span>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      {action?.kind === "SKIP" && (
        <div className="draw-skip-branch">
          <span>SKIP</span>
          <small>No encrypted winner is created</small>
        </div>
      )}
      <p className="draw-advance-note">
        Permissionless · any Sepolia wallet can execute · private balances and weights remain encrypted.
      </p>
    </section>
  );
}
