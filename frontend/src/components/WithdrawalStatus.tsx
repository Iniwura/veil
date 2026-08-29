import type { WithdrawalView } from "../veilClient";
import type { WithdrawalLifecycleAction } from "../../../shared/withdrawalLifecycle";

type WithdrawalStatusProps = {
  request?: WithdrawalView;
  connected?: boolean;
  address?: string;
  busy?: string;
  onAdvance?: (action: WithdrawalLifecycleAction) => void;
  onCancel?: (requestId: bigint) => void;
};

const LIFECYCLE_STEPS = ["REQUEST", "VERIFY", "LIQUIDITY", "SETTLE"] as const;

function activeLifecycleStep(action: WithdrawalLifecycleAction) {
  switch (action.kind) {
    case "CLASSIFY":
      return 1;
    case "FUND_LIQUIDITY":
    case "WAIT_BATCH_AGE":
    case "DISPATCH_BATCH":
    case "PROVE_BATCH":
    case "RESOLVE_BATCH":
      return 2;
    case "WAIT_FIFO_HEAD":
    case "SETTLE":
    case "FINALIZE":
    case "ADVANCE_CANCELED_HEAD":
    case "SETTLED":
    case "CANCELED":
      return 3;
    default:
      return 0;
  }
}

export function WithdrawalStatus({
  request,
  connected = false,
  address = "",
  busy = "",
  onAdvance,
  onCancel,
}: WithdrawalStatusProps) {
  if (!request) return <div className="status-empty">No withdrawal request in the recent queue window.</div>;
  const activeStep = activeLifecycleStep(request.action);
  const isOwner = connected && Boolean(address) && request.account.toLowerCase() === address.toLowerCase();
  const canCancel = isOwner && !request.settled && !request.canceled && !request.committed;
  const canAdvance = connected && request.action.actionable && Boolean(onAdvance);
  return (
    <div className="withdrawal-status">
      <div>
        <span>REQUEST</span>
        <strong>#{request.requestId.toString()}</strong>
      </div>
      <div>
        <span>STATE</span>
        <strong>{request.status}</strong>
      </div>
      <div>
        <span>STRATEGY COMMITMENT</span>
        <strong>{request.committed ? "COMMITTED" : "NOT COMMITTED"}</strong>
      </div>
      <p>
        The requested amount remains encrypted. Advance only the next permissionless protocol step shown below.
      </p>
      <section className="withdrawal-lifecycle" aria-label="Withdrawal lifecycle">
        <div className="withdrawal-lifecycle-heading">
          <span>WITHDRAWAL LIFECYCLE</span>
          <strong>{request.action.title}</strong>
        </div>
        <ol className="withdrawal-lifecycle-steps">
          {LIFECYCLE_STEPS.map((step, index) => (
            <li className={index <= activeStep ? "active" : ""} key={step}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="withdrawal-lifecycle-description">{request.action.description}</p>
        {canAdvance && onAdvance && (
          <button
            className="button-primary button-full withdrawal-lifecycle-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void onAdvance(request.action)}
          >
            {busy === "withdrawal-lifecycle" ? "ADVANCING WITHDRAWAL…" : request.action.title}
          </button>
        )}
        {canCancel && onCancel && (
          <button
            className="button-quiet withdrawal-cancel-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => onCancel(request.requestId)}
          >
            CANCEL REQUEST
          </button>
        )}
      </section>
    </div>
  );
}
