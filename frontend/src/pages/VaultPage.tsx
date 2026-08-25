import { useMemo, useState } from "react";
import { PrivateStat } from "../components/PrivateStat";
import type { UnveilController } from "../hooks/useUnveil";

export function VaultPage({ unveil }: { unveil: UnveilController }) {
  const roundIds = useMemo(() => unveil.history.map((round) => round.id), [unveil.history]);
  const [roundId, setRoundId] = useState(() => roundIds[0]?.toString() ?? "1");
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
        <div className="vault-grid">
          <PrivateStat
            label="Your private balance"
            value={unveil.vault?.activePrincipal}
            revealed={revealed}
            detail="TEST confidential principal"
          />
          <PrivateStat
            label="Reserved withdrawal"
            value={unveil.vault?.reservedPrincipal}
            revealed={revealed}
            detail="Accepted principal awaiting settlement"
          />
          <PrivateStat
            label="Private strategy shares"
            value={unveil.vault?.strategySharePrizeBalance}
            revealed={revealed}
            detail="TEST/DEMO confidential shares"
          />
          <PrivateStat
            label="Your draw weight"
            value={unveil.roundWeight?.value}
            revealed={Boolean(unveil.roundWeight)}
            detail={
              unveil.roundWeight ? `Historical Round ${unveil.roundWeight.roundId}` : "Choose a settled round below"
            }
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
          <select id="round-select" value={roundId} onChange={(event) => setRoundId(event.target.value)}>
            {roundIds.length ? (
              roundIds.map((id) => (
                <option key={id.toString()} value={id.toString()}>
                  {id.toString()}
                </option>
              ))
            ) : (
              <option value="1">1</option>
            )}
          </select>
          <button
            className="button-secondary"
            disabled={Boolean(unveil.busy)}
            onClick={() => unveil.revealRound(BigInt(roundId))}
          >
            {unveil.busy === "reveal-weight" ? "DECRYPTING…" : "UNVEIL MY DRAW WEIGHT"}
          </button>
          {unveil.roundWeight && (
            <button className="button-quiet" onClick={unveil.hideRoundWeight}>
              VEIL WEIGHT
            </button>
          )}
        </div>
      </section>
      <section className="odds-explanation">
        <span>WHY NO EXACT ODDS?</span>
        <p>
          Exact odds require the encrypted aggregate round weight, which V2 does not grant participants permission to
          decrypt. Public participant count is not a mathematically valid denominator for a weighted draw.
        </p>
      </section>
    </div>
  );
}
