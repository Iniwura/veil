import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MyVault } from "../veilClient";
import { usePrefersReducedMotion } from "../hooks/useMotion";
import { RouteLink } from "./RouteLink";
import { DASHBOARD_SEALED_SEGMENTS } from "../../../shared/homePresentation";

type DashboardRevealState = "SEALED" | "AUTHORIZING" | "DECRYPTING" | "REVEALED" | "VEILING";

const STATE_LABELS: Record<DashboardRevealState, string> = {
  SEALED: "FHE SEALED",
  AUTHORIZING: "AUTHORIZING LOCALLY",
  DECRYPTING: "DECRYPTING LOCALLY",
  REVEALED: "UNVEILED LOCALLY",
  VEILING: "VEILING LOCAL DISPLAY",
};

const BALANCES: Array<{
  key: keyof MyVault;
  label: string;
  unit: string;
}> = [
  { key: "availablePrincipal", label: "AVAILABLE TO SAVE", unit: "cUSDC" },
  { key: "activePrincipal", label: "SAVED IN UNVEIL", unit: "cUSDC" },
  { key: "reservedPrincipal", label: "PENDING WITHDRAWAL", unit: "cUSDC" },
  { key: "strategySharePrizeBalance", label: "PRIZE BALANCE", unit: "VAULT SHARE UNITS" },
];

function formatBalance(value: bigint | undefined, unit: string) {
  return (
    <>
      <strong>{value?.toString() ?? "0"}</strong>
      <small>{unit}</small>
    </>
  );
}

export function DashboardPrivatePosition({
  vault,
  busy,
  onReveal,
  onHide,
}: {
  vault?: MyVault;
  busy: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const wasRevealed = useRef(Boolean(vault));
  const [busyState, setBusyState] = useState<"AUTHORIZING" | "DECRYPTING">("AUTHORIZING");
  const [veiling, setVeiling] = useState(false);

  useEffect(() => {
    if (!busy) {
      setBusyState("AUTHORIZING");
      return;
    }
    if (reducedMotion) {
      setBusyState("DECRYPTING");
      return;
    }
    setBusyState("AUTHORIZING");
    const timer = window.setTimeout(() => setBusyState("DECRYPTING"), 850);
    return () => window.clearTimeout(timer);
  }, [busy, reducedMotion]);

  useEffect(() => {
    if (wasRevealed.current && !vault) {
      setVeiling(true);
      const timer = window.setTimeout(() => setVeiling(false), reducedMotion ? 0 : 320);
      wasRevealed.current = Boolean(vault);
      return () => window.clearTimeout(timer);
    }
    wasRevealed.current = Boolean(vault);
  }, [reducedMotion, vault]);

  const state: DashboardRevealState = vault ? "REVEALED" : busy ? busyState : veiling ? "VEILING" : "SEALED";

  return (
    <section
      className={`home-private-position home-private-position--${state.toLowerCase()}`}
      data-dashboard-reveal-state={state}
      data-tour="private-position"
    >
      <div className="home-private-position-head">
        <div>
          <h2>PRIVATE POSITION</h2>
          <span className="home-private-position-state">{STATE_LABELS[state]}</span>
        </div>
        <RouteLink className="text-link" to="/app/save" dataCursor="enter">
          OPEN SAVE →
        </RouteLink>
      </div>
      <div className="home-private-position-grid" aria-label="Private wallet balances">
        {BALANCES.map(({ key, label, unit }) => (
          <div className="home-private-balance" key={key}>
            <span>{label}</span>
            <div className="home-private-balance-value" aria-live="polite" aria-atomic="true">
              {state === "REVEALED" ? (
                formatBalance(vault?.[key], unit)
              ) : (
                <span className="home-private-segments" aria-label="Encrypted value sealed">
                  {DASHBOARD_SEALED_SEGMENTS.map((width, index) => (
                    <i aria-hidden="true" key={index} style={{ "--segment-width": `${width}px` } as CSSProperties} />
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="home-private-position-actions">
        <span>
          {state === "REVEALED"
            ? "Plaintext remains local to this browser session."
            : "Your balances are encrypted until you authorize a local reveal."}
        </span>
        <button
          className="button-secondary home-reveal-cta"
          type="button"
          data-cursor="sealed"
          disabled={busy}
          onClick={vault ? onHide : onReveal}
        >
          {busy ? "UNVEILING…" : vault ? "VEIL MY BALANCES →" : "UNVEIL MY BALANCES →"}
        </button>
      </div>
    </section>
  );
}
