import { useState } from "react";
import { VeilReveal } from "../components/VeilReveal";

export default function MotionDebugVault() {
  const [state, setState] = useState<"sealed" | "busy" | "revealed">("sealed");
  const revealed = state === "revealed";
  const busy = state === "busy";

  return (
    <section className="motion-debug" aria-label="Development-only private reveal motion harness">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LOCAL MOTION HARNESS · NO PROTOCOL DATA</span>
          <h2>PRIVATE REVEAL STATES.</h2>
        </div>
        <div className="motion-debug-controls">
          <button className="button-secondary" onClick={() => setState("sealed")}>
            SEALED
          </button>
          <button className="button-secondary" onClick={() => setState("busy")}>
            IN PROGRESS
          </button>
          <button className="button-secondary" onClick={() => setState("revealed")}>
            REVEALED
          </button>
        </div>
      </div>
      <div className="motion-debug-grid">
        <VeilReveal label="Harness principal" value={12n} revealed={revealed} busy={busy} unit=" TEST UNITS" />
        <VeilReveal label="Harness reserved" value={3n} revealed={revealed} busy={busy} unit=" TEST UNITS" />
        <VeilReveal label="Harness shares" value={37n} revealed={revealed} busy={busy} unit=" TEST SHARE UNITS" />
      </div>
      <p>These local constants exist only in the development motion gallery and never enter the product controller.</p>
    </section>
  );
}
