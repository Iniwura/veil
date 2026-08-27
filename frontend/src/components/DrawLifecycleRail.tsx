import type { DrawAction } from "../lib/drawAdvance";
import { deriveLifecyclePresentation, type DrawLifecycleTerminalState } from "../lib/drawLifecycle";

export function DrawLifecycleRail({
  action,
  terminalState,
}: {
  action?: DrawAction;
  terminalState?: DrawLifecycleTerminalState;
}) {
  const presentation = deriveLifecyclePresentation(action, terminalState);
  return (
    <div className="draw-lifecycle-rail" aria-label="Public draw lifecycle">
      <div className="draw-lifecycle-track">
        {presentation.steps.map(({ id, detail, state }) => {
          return (
            <div className={`draw-lifecycle-step draw-lifecycle-step--${state}`} key={id}>
              <span className="draw-lifecycle-mark" aria-hidden="true" />
              <div>
                <strong>{id}</strong>
                {state === "active" && <small>{detail}</small>}
              </div>
            </div>
          );
        })}
      </div>
      {presentation.branch && (
        <div
          className={`draw-lifecycle-branch draw-lifecycle-branch--${presentation.branch.kind.toLowerCase()}`}
          role="status"
        >
          <strong>{presentation.branch.title}</strong>
          <span>{presentation.branch.detail}</span>
          {presentation.branch.kind === "READY_TO_SKIP" && (
            <small>NO BLIND DRAW OR ENCRYPTED WINNER WILL BE CREATED</small>
          )}
        </div>
      )}
    </div>
  );
}
