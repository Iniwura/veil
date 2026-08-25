import type { WithdrawalView } from "../veilClient";

export function WithdrawalStatus({ request }: { request?: WithdrawalView }) {
  if (!request) return <div className="status-empty">No withdrawal request in the recent queue window.</div>;
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
        The requested amount remains encrypted. Queued requests wait for permissionless strategy liquidity settlement.
      </p>
    </div>
  );
}
