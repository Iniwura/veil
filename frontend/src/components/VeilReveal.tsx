import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "../hooks/useMotion";

export type VeilRevealState = "SEALED" | "AWAITING_SIGNATURE" | "DECRYPTING" | "REVEALED" | "VEILING";

const STATE_LABELS: Record<VeilRevealState, string> = {
  SEALED: "FHE SEALED",
  AWAITING_SIGNATURE: "REQUESTING WALLET SIGNATURE",
  DECRYPTING: "USER DECRYPT IN PROGRESS",
  REVEALED: "UNVEILED LOCALLY",
  VEILING: "VEILING LOCAL DISPLAY",
};

export function VeilReveal({
  label,
  value,
  revealed,
  busy = false,
  detail,
  unit,
  revealedLabel,
  stagger = 0,
  compact = false,
}: {
  label: string;
  value?: bigint | string;
  revealed: boolean;
  busy?: boolean;
  detail?: string;
  unit?: string;
  revealedLabel?: string;
  stagger?: number;
  compact?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const wasRevealed = useRef(revealed);
  const [busyState, setBusyState] = useState<"AWAITING_SIGNATURE" | "DECRYPTING">("AWAITING_SIGNATURE");
  const [veiling, setVeiling] = useState(false);

  useEffect(() => {
    if (!busy) {
      setBusyState("AWAITING_SIGNATURE");
      return;
    }
    if (reducedMotion) {
      setBusyState("DECRYPTING");
      return;
    }
    setBusyState("AWAITING_SIGNATURE");
    const timer = window.setTimeout(() => setBusyState("DECRYPTING"), 900);
    return () => window.clearTimeout(timer);
  }, [busy, reducedMotion]);

  useEffect(() => {
    if (wasRevealed.current && !revealed) {
      setVeiling(true);
      const timer = window.setTimeout(() => setVeiling(false), reducedMotion ? 0 : 260);
      wasRevealed.current = revealed;
      return () => window.clearTimeout(timer);
    }
    wasRevealed.current = revealed;
  }, [reducedMotion, revealed]);

  const state: VeilRevealState = revealed ? "REVEALED" : busy ? busyState : veiling ? "VEILING" : "SEALED";
  const stateLabel = state === "REVEALED" && revealedLabel ? revealedLabel : STATE_LABELS[state];

  return (
    <div
      className={`veil-reveal veil-reveal--${state.toLowerCase()} ${compact ? "veil-reveal--compact" : ""}`}
      data-reveal-state={state}
      style={{ "--reveal-index": stagger } as CSSProperties}
    >
      <span className="veil-reveal-label">{label}</span>
      <div className="veil-reveal-value" aria-live="polite" aria-atomic="true">
        {state === "REVEALED" ? (
          <strong>
            {value?.toString() ?? "0"}
            {unit && <small>{unit}</small>}
          </strong>
        ) : (
          <strong className="veil-reveal-sealed" aria-label="Encrypted value sealed">
            <span aria-hidden="true">████████</span>
          </strong>
        )}
        <i className="veil-reveal-texture" aria-hidden="true" />
        {(state === "AWAITING_SIGNATURE" || state === "DECRYPTING") && (
          <i className="veil-reveal-scan" aria-hidden="true" />
        )}
      </div>
      <span className="veil-reveal-state">{stateLabel}</span>
      {detail && <small className="veil-reveal-detail">{detail}</small>}
    </div>
  );
}
