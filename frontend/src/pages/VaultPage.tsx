import { useEffect, useMemo, useState } from "react";
import { VeilReveal } from "../components/VeilReveal";
import type { UnveilController } from "../hooks/useUnveil";

function MotionDebugVault() {
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

export function VaultPage({ unveil }: { unveil: UnveilController }) {
  const showMotionDebug = new URLSearchParams(window.location.search).get("motionDebug") === "1";
  const roundIds = useMemo(() => unveil.history.map((round) => round.id), [unveil.history]);
  const [roundId, setRoundId] = useState("");
  const selectedRoundId = roundIds.some((id) => id.toString() === roundId) ? roundId : (roundIds[0]?.toString() ?? "");
  useEffect(() => {
    if (selectedRoundId !== roundId) setRoundId(selectedRoundId);
  }, [roundId, selectedRoundId]);
  const revealed = Boolean(unveil.vault);
  return (
    <div className="page-stack route-enter">
      <header className="page-heading page-heading--split">
        <div>
          <span className="eyebrow">MY VAULT</span>
          <h1>
            ENCRYPTED TO EVERYONE.
            <br />
            UNVEILED ONLY TO YOU.
          </h1>
        </div>
        <span className={`vault-seal ${revealed ? "open" : ""}`}>
          {revealed ? "LOCAL VIEW UNVEILED" : "FHE SEALED"}
        </span>
      </header>
      <section className={`vault-surface ${revealed ? "vault-surface--revealed" : ""}`}>
        {unveil.busy === "reveal-vault" && (
          <div className="vault-reveal-progress" role="status" aria-label="Private vault reveal in progress">
            <i className="active">01 · WALLET AUTHORIZATION</i>
            <i>02 · DECRYPTING AUTHORIZED CIPHERTEXTS</i>
            <i>03 · LOCAL REVEAL</i>
          </div>
        )}
        <div className="vault-grid">
          <VeilReveal
            label="Your private balance"
            value={unveil.vault?.activePrincipal}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="TEST confidential principal"
            unit=" TEST UNITS"
            stagger={0}
          />
          <VeilReveal
            label="Reserved withdrawal"
            value={unveil.vault?.reservedPrincipal}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="Accepted principal awaiting settlement"
            unit=" TEST UNITS"
            stagger={1}
          />
          <VeilReveal
            label="Private strategy shares"
            value={unveil.vault?.strategySharePrizeBalance}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="TEST/DEMO confidential shares"
            unit=" TEST SHARE UNITS"
            stagger={2}
          />
          <div className="private-stat private-stat--odds">
            <span>Your odds</span>
            <strong>NOT AVAILABLE</strong>
            <small>Aggregate round weight is not wallet-decryptable in V2.</small>
          </div>
        </div>
        <div className="vault-actions">
          <button
            className="button-primary"
            disabled={Boolean(unveil.busy)}
            onClick={revealed ? unveil.hideVault : unveil.revealVaultStats}
          >
            {unveil.busy === "reveal-vault"
              ? "AWAITING WALLET SIGNATURE…"
              : revealed
                ? "VEIL MY STATS"
                : "UNVEIL MY PRIVATE STATS"}
          </button>
          <p>
            Veiling clears these values from local presentation only. It does not change ciphertext ACLs or blockchain
            state.
          </p>
          {revealed && <strong className="vault-local-note">UNVEILED ONLY TO THIS WALLET</strong>}
        </div>
      </section>
      <section className="weight-reveal">
        <div>
          <span className="eyebrow">HISTORICAL WEIGHT</span>
          <h2>UNVEIL ONE ROUND.</h2>
          <p>If this wallet was included, it can decrypt only its own immutable snapshot weight.</p>
        </div>
        <div className="weight-control">
          <label htmlFor="round-select">ROUND</label>
          <select id="round-select" value={selectedRoundId} onChange={(event) => setRoundId(event.target.value)}>
            {roundIds.length ? (
              roundIds.map((id) => (
                <option key={id.toString()} value={id.toString()}>
                  {id.toString()}
                </option>
              ))
            ) : (
              <option value="">NO SETTLED ROUND</option>
            )}
          </select>
          <button
            className="button-secondary"
            disabled={Boolean(unveil.busy) || !selectedRoundId}
            onClick={() => selectedRoundId && unveil.revealRound(BigInt(selectedRoundId))}
          >
            {unveil.busy === "reveal-weight" ? "DECRYPTING…" : "UNVEIL MY DRAW WEIGHT"}
          </button>
          {unveil.roundWeight && (
            <button className="button-quiet" onClick={unveil.hideRoundWeight}>
              VEIL WEIGHT
            </button>
          )}
        </div>
        <VeilReveal
          compact
          label={unveil.roundWeight ? "My weight" : "My encrypted weight"}
          value={unveil.roundWeight?.value}
          revealed={Boolean(unveil.roundWeight)}
          busy={unveil.busy === "reveal-weight"}
          detail={
            selectedRoundId ? `Immutable snapshot · Round ${selectedRoundId.padStart(2, "0")}` : "No round selected"
          }
          unit=" TEST UNITS"
        />
      </section>
      <section className="odds-explanation">
        <span>WHY NO EXACT ODDS?</span>
        <p>
          Exact odds require the encrypted aggregate round weight, which V2 does not grant participants permission to
          decrypt. Public participant count is not a mathematically valid denominator for a weighted draw.
        </p>
      </section>
      {showMotionDebug && <MotionDebugVault />}
    </div>
  );
}
