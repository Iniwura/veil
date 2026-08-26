import { DrawCountdown } from "../components/DrawCountdown";
import { VeilReveal } from "../components/VeilReveal";
import { RoundHistory } from "../components/RoundHistory";
import { RouteLink } from "../components/RouteLink";
import type { UnveilController } from "../hooks/useUnveil";
import { drawStateLabel, formatDate } from "../lib/format";

export function HomePage({ unveil }: { unveil: UnveilController }) {
  const data = unveil.dashboard;
  const schedule = unveil.schedule;
  const privateState = unveil.busy === "reveal-vault" ? "UNVEILING" : unveil.vault ? "UNVEILED TO YOU" : "SEALED";
  const seatState = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : !unveil.connected
      ? "CONNECT WALLET"
      : data?.seated
        ? "ACTIVE"
        : data?.joined
          ? "EXPIRED"
          : "NOT JOINED";

  return (
    <div className="page-stack route-enter">
      <section className="home-hero">
        <div>
          <span className="eyebrow">PRIVATE PRIZE SAVINGS</span>
          <h1>
            SAVE PRIVATELY.
            <br />
            DRAW PUBLICLY.
          </h1>
          <p>One quiet place to save, follow the draw, and unveil only what belongs to your wallet.</p>
        </div>
        <div className="home-hero-actions">
          <RouteLink className="button-primary" to="/app/save">
            SAVE PRIVATELY <span>↗</span>
          </RouteLink>
          <RouteLink className="text-link" to="/app/draw">
            SEE THE DRAW →
          </RouteLink>
        </div>
      </section>

      <section className="home-draw-card">
        <div className="home-section-head">
          <div>
            <span className="eyebrow">CURRENT DRAW</span>
            <h2>ROUND {schedule?.currentRoundId.toString().padStart(2, "0") ?? "—"}</h2>
          </div>
          <DrawCountdown
            closesAt={schedule?.closesAt}
            timeReady={schedule?.timeReady}
            ready={schedule?.ready}
            insufficientParticipants={schedule?.insufficientParticipants}
          />
        </div>
        <div className="home-draw-metrics">
          <div>
            <span>STATE</span>
            <strong>{drawStateLabel(schedule)}</strong>
          </div>
          <div>
            <span>PARTICIPANTS</span>
            <strong>{data?.playerCount ?? unveil.publicProtocol?.playerCount ?? "—"}</strong>
          </div>
          <div>
            <span>SEAT</span>
            <strong>{seatState}</strong>
          </div>
          <div>
            <span>CLOSES</span>
            <strong>{formatDate(schedule?.closesAt)}</strong>
          </div>
        </div>
        {!unveil.connected ? (
          <button className="button-primary" onClick={unveil.wrongNetwork ? unveil.switchToSepolia : unveil.connect}>
            {unveil.wrongNetwork ? "SWITCH TO SEPOLIA" : "CONNECT WALLET"}
          </button>
        ) : data?.joined && !data.seated ? (
          <button className="button-secondary" onClick={unveil.renewSeat} disabled={Boolean(unveil.busy)}>
            RENEW DRAW SEAT
          </button>
        ) : (
          <RouteLink className="text-link" to="/app/draw">
            OPEN DRAW DETAILS →
          </RouteLink>
        )}
      </section>

      <section className="home-private-grid">
        <article className="private-panel" data-tour="private-position">
          <div className="home-section-head">
            <div>
              <span className="eyebrow">MY PRIVATE POSITION</span>
              <h2>{privateState}</h2>
            </div>
            <RouteLink className="text-link" to="/app/save">
              OPEN SAVE →
            </RouteLink>
          </div>
          <div className="private-stat-grid">
            <VeilReveal
              compact
              label="Active principal"
              value={unveil.vault?.activePrincipal}
              revealed={Boolean(unveil.vault)}
              busy={unveil.busy === "reveal-vault"}
              unit=" TEST"
            />
            <VeilReveal
              compact
              label="Reserved withdrawal"
              value={unveil.vault?.reservedPrincipal}
              revealed={Boolean(unveil.vault)}
              busy={unveil.busy === "reveal-vault"}
              unit=" TEST"
            />
            <VeilReveal
              compact
              label="Strategy shares"
              value={unveil.vault?.strategySharePrizeBalance}
              revealed={Boolean(unveil.vault)}
              busy={unveil.busy === "reveal-vault"}
              unit=" SHARE UNITS"
            />
          </div>
          <button
            className="button-secondary"
            data-tour="private-reveal"
            disabled={Boolean(unveil.busy)}
            onClick={unveil.vault ? unveil.hideVault : unveil.revealVaultStats}
          >
            {unveil.busy === "reveal-vault"
              ? "UNVEILING…"
              : unveil.vault
                ? "VEIL PRIVATE POSITION"
                : "UNVEIL PRIVATE POSITION"}
          </button>
        </article>
        <article className="status-panel home-result-preview">
          <span className="eyebrow">LATEST RESULT</span>
          <h2>
            {!unveil.latestFinalized
              ? "NO RESULT YET"
              : unveil.latestFinalized.status === "FINALIZED"
                ? `ROUND ${unveil.latestFinalized.id}`
                : unveil.latestFinalized.status}
          </h2>
          <p>
            {!unveil.latestFinalized
              ? "Verified results will appear here after the first settled round."
              : unveil.latestFinalized.winner
                ? "A public winner is verified. Any delivered prize remains confidential."
                : "The lifecycle is verified without a public winner or prize amount."}
          </p>
          <RouteLink className="text-link" to="/app/draw">
            VIEW RESULT + PRIZES →
          </RouteLink>
        </article>
      </section>

      <section className="home-history">
        <div className="home-section-head">
          <div>
            <span className="eyebrow">VERIFIED HISTORY</span>
            <h2>RECENT DRAWS.</h2>
          </div>
          <RouteLink className="text-link" to="/app/draw">
            VIEW ALL →
          </RouteLink>
        </div>
        <RoundHistory rounds={unveil.history} compact />
      </section>
    </div>
  );
}
