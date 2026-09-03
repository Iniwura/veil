import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "../hooks/useMotion";

export type CryptographicChamberState = "OPEN" | "READY" | "INSUFFICIENT" | "OVERDUE";
export type CryptographicChamberPhase =
  | "SEALED"
  | "SNAPSHOT"
  | "BLIND_DRAW"
  | "VERIFY"
  | "DELIVER"
  | "SKIP"
  | "BACKLOG"
  | "COMPLETE";

type PublicMarker = {
  distance: number;
};

const MAX_PUBLIC_MARKERS = 32;

function buildPublicMarkers(count: number): PublicMarker[] {
  const visibleCount = Math.min(Math.max(count, 0), MAX_PUBLIC_MARKERS);
  return Array.from({ length: visibleCount }, (_, index) => ({
    distance: index / Math.max(visibleCount - 1, 1),
  }));
}

function phaseForState(state: CryptographicChamberState): CryptographicChamberPhase {
  if (state === "INSUFFICIENT") return "SKIP";
  if (state === "OVERDUE") return "BACKLOG";
  if (state === "READY") return "SNAPSHOT";
  return "SEALED";
}

function phaseLabel(phase: CryptographicChamberPhase) {
  if (phase === "BLIND_DRAW") return "BLIND DRAW";
  if (phase === "BACKLOG") return "KEEPER SETTLING";
  return phase;
}

function phaseDescription(phase: CryptographicChamberPhase) {
  if (phase === "SNAPSHOT") return "The snapshot locks without exposing private ticket weights.";
  if (phase === "BLIND_DRAW") return "The draw accelerates behind the sealed material.";
  if (phase === "VERIFY") return "Verification crosses the seam without opening the veil.";
  if (phase === "DELIVER") return "One settlement path exits; the financial interior stays sealed.";
  if (phase === "SKIP") return "Insufficient participation; no encrypted winner exists.";
  if (phase === "BACKLOG") return "Earlier lifecycle work remains queued; encryption stays intact.";
  if (phase === "COMPLETE") return "Round settled with no prize due; the lifecycle can advance.";
  return "Markers represent public seats, never private ticket weight.";
}

export function CryptographicChamber({
  roundId,
  participantCount,
  participantLabel = "CURRENT SEATS",
  state,
  phase,
  compact = false,
}: {
  roundId?: bigint;
  participantCount?: number;
  participantLabel?: string;
  state: CryptographicChamberState;
  phase?: CryptographicChamberPhase;
  compact?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const reducedMotion = usePrefersReducedMotion();
  const activePhase = phase ?? phaseForState(state);
  const participants = buildPublicMarkers(participantCount ?? 0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleVisibility = () => setVisible(!document.hidden);
    const intersectionObserver = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    intersectionObserver.observe(stage);
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    return () => {
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activePhase]);

  const displayPhase = phaseLabel(activePhase);
  const description = phaseDescription(activePhase);

  return (
    <section
      className={`cryptographic-chamber cryptographic-chamber--${state.toLowerCase()} cryptographic-chamber--phase-${activePhase.toLowerCase().replace("_", "-")} ${compact ? "cryptographic-chamber--compact" : ""}`}
      data-chamber-state={state}
      data-chamber-phase={activePhase}
      data-chamber-visible={visible}
      data-cursor="sealed"
      aria-label={`Live cryptographic chamber. ${displayPhase}.`}
    >
      <div className="chamber-header">
        <div>
          <span className="chamber-kicker">DRAW / SETTLEMENT</span>
          <strong>VERIFIABLE SETTLEMENT</strong>
        </div>
        <div className="chamber-public-meta">
          <span>ROUND {roundId?.toString().padStart(2, "0") ?? "—"}</span>
          <span>{state}</span>
          <span>
            {participantCount ?? "—"} {participantLabel}
          </span>
        </div>
      </div>
      <div className="chamber-stage" ref={stageRef} data-chamber-stage aria-hidden="true">
        <div className="chamber-field">
          <div className="chamber-ribbons">
            {Array.from({ length: 7 }, (_, index) => (
              <i key={index} style={{ "--ribbon-index": index } as CSSProperties} />
            ))}
          </div>
          <div className="chamber-material">
            <span className="chamber-material-core" />
            <i className="chamber-seam" />
            <i className="chamber-proof-line" />
            <i className="chamber-delivery-trace" />
            <i className="chamber-terminal-mark" />
          </div>
          <div className="chamber-markers">
            {participants.map((participant, index) => (
              <i
                key={index}
                style={{ "--marker-position": `${participant.distance * 100}%` } as CSSProperties}
              />
            ))}
          </div>
          <div className="chamber-phase-stamp">
            <span>{displayPhase}</span>
            <small>{reducedMotion ? "MOTION REDUCED" : "SEALED PUBLIC SURFACE"}</small>
          </div>
        </div>
      </div>
      <div className="chamber-footer">
        <span className="chamber-state-indicator">{displayPhase}</span>
        <p>{description}</p>
      </div>
    </section>
  );
}
