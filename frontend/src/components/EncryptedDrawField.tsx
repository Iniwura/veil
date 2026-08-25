import type { CSSProperties } from "react";

export type EncryptedDrawFieldState = "OPEN" | "READY" | "INSUFFICIENT" | "OVERDUE";

export function EncryptedDrawField({
  roundId,
  participantCount,
  state,
  compact = false,
}: {
  roundId?: bigint;
  participantCount?: number;
  state: EncryptedDrawFieldState;
  compact?: boolean;
}) {
  const nodeCount = participantCount === undefined ? 0 : Math.min(Math.max(participantCount, 0), compact ? 8 : 12);
  const centerLabel =
    state === "INSUFFICIENT"
      ? "READY TO SKIP"
      : state === "READY"
        ? "DRAW READY"
        : state === "OVERDUE"
          ? "LIFECYCLE BACKLOG"
          : "FHE SEALED";

  return (
    <section
      className={`encrypted-draw-field encrypted-draw-field--${state.toLowerCase()} ${compact ? "encrypted-draw-field--compact" : ""}`}
      aria-label={`Round ${roundId?.toString() ?? "loading"} encrypted draw field. ${participantCount ?? "Unknown"} public participants. State ${state}.`}
    >
      <div className="encrypted-draw-meta">
        <span>ROUND {roundId?.toString().padStart(2, "0") ?? "—"}</span>
        <span>{participantCount ?? "—"} PUBLIC PARTICIPANTS</span>
      </div>
      <div className="encrypted-draw-stage" aria-hidden="true">
        <div className="encrypted-draw-rings motion-continuous" />
        <div className="encrypted-draw-nodes motion-continuous">
          {Array.from({ length: nodeCount }, (_, index) => (
            <i key={index} style={{ "--node-index": index, "--node-count": Math.max(nodeCount, 1) } as CSSProperties} />
          ))}
        </div>
        <div className="encrypted-draw-center">
          <span>ENCRYPTED TARGET</span>
          <strong>{centerLabel}</strong>
          <i />
        </div>
        <div className="encrypted-draw-verify" />
      </div>
      <p>VISUALIZES PUBLIC PARTICIPATION · NOT PRIVATE WEIGHT</p>
      {state === "OVERDUE" && <small>AN EARLIER LIFECYCLE STEP REMAINS UNSETTLED · ENCRYPTION IS INTACT</small>}
    </section>
  );
}
