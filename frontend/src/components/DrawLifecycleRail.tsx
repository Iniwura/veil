import type { DrawAction } from "../lib/drawAdvance";

const LIFECYCLE_STEPS = [
  ["OPEN", "Accepting positions"],
  ["SNAPSHOT", "Freeze encrypted weights"],
  ["BLIND DRAW", "Select privately"],
  ["VERIFY", "Validate KMS proof"],
  ["DELIVER", "Send the prize"],
] as const;

type TerminalState = "SKIPPED" | "CANCELLED" | "COMPLETE";

function activeIndex(action?: DrawAction) {
  if (!action || action.kind === "WAIT") return 0;
  if (action.kind === "SKIP") return 1;
  if (action.stage === "SNAPSHOT") return 1;
  if (action.stage === "BLIND_DRAW") return 2;
  if (action.stage === "VERIFY") return 3;
  if (action.stage === "DELIVER" || action.stage === "COMPLETE") return 4;
  return -1;
}

function terminalLabel(terminalState?: TerminalState) {
  if (terminalState === "SKIPPED") return "SKIPPED · FEWER THAN TWO ELIGIBLE SEATS";
  if (terminalState === "CANCELLED") return "CANCELLED · ZERO-WEIGHT DRAW";
  if (terminalState === "COMPLETE") return "COMPLETE · NO PRIZE DUE";
  return "";
}

export function DrawLifecycleRail({ action, terminalState }: { action?: DrawAction; terminalState?: TerminalState }) {
  const currentIndex = activeIndex(action);
  const terminal = terminalLabel(terminalState);
  return (
    <div className="draw-lifecycle-rail" aria-label="Public draw lifecycle">
      <div className="draw-lifecycle-track">
        {LIFECYCLE_STEPS.map(([name, detail], index) => {
          const state = index < currentIndex ? "complete" : index === currentIndex ? "active" : "future";
          return (
            <div className={`draw-lifecycle-step draw-lifecycle-step--${state}`} key={name}>
              <span className="draw-lifecycle-mark" aria-hidden="true" />
              <div>
                <strong>{name}</strong>
                {state === "active" && <small>{detail}</small>}
              </div>
            </div>
          );
        })}
      </div>
      {terminal && (
        <p className={`draw-lifecycle-terminal draw-lifecycle-terminal--${terminalState?.toLowerCase()}`}>{terminal}</p>
      )}
    </div>
  );
}
