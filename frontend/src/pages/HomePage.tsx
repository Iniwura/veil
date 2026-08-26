import { DrawCountdown } from "../components/DrawCountdown";
import { VeilReveal } from "../components/VeilReveal";
import { RoundHistory } from "../components/RoundHistory";
import { RouteLink } from "../components/RouteLink";
import type { UnveilController } from "../hooks/useUnveil";
import { drawStateLabel, explorerAddress, formatDate, shortAddress } from "../lib/format";

export function HomePage({ unveil }: { unveil: UnveilController }) {
  const data = unveil.dashboard;
  const schedule = unveil.schedule;
  const result = unveil.latestResult;
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

  const action = !unveil.connected
    ? { kind: "button" as const, label: unveil.wrongNetwork ? "SWITCH TO SEPOLIA" : "CONNECT WALLET" }
    : data?.joined && !data.seated
      ? { kind: "button" as const, label: "RENEW SEAT" }
      : data?.seated
        ? { kind: "link" as const, label: "VIEW DRAW" }
        : { kind: "link" as const, label: "SAVE PRIVATELY" };

  return (
    <div className="page-stack route-enter">
      <section className="home-command-row">
        <div>
          <span className="eyebrow">YOUR UNVEIL DASHBOARD</span>
          <h1>WELCOME BACK.</h1>
          <p>Private position, scheduled draw, and verified result in one place.</p>
        </div>
        <div className="home-command-actions">
          {action.kind === "link" ? (
            <RouteLink className="button-primary" to={action.label === "VIEW DRAW" ? "/app/draw" : "/app/save"}>
              {action.label} <span>↗</span>
            </RouteLink>
          ) : (
            <button
              className="button-primary"
              onClick={unveil.wrongNetwork ? unveil.switchToSepolia : data?.joined ? unveil.renewSeat : unveil.connect}
              disabled={Boolean(unveil.busy)}
            >
              {unveil.busy === "renew-seat" ? "RENEWING…" : action.label}
            </button>
          )}
          <RouteLink className="text-link" to="/app/draw">
            SEE DRAW STATUS →
          </RouteLink>
        </div>
      </section>

      <section className="home-dashboard-grid">
        <article className="home-draw-card">
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
              <span>ELIGIBILITY</span>
              <strong>{seatState}</strong>
            </div>
            <div>
              <span>CLOSES</span>
              <strong>{formatDate(schedule?.closesAt)}</strong>
            </div>
          </div>
          <RouteLink className="text-link" to="/app/draw">
            OPEN DRAW DETAILS →
          </RouteLink>
        </article>

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
      </section>

      <section className="home-result-card">
        <div className="home-section-head">
          <div>
            <span className="eyebrow">LATEST RESULT</span>
            <h2>{result ? `ROUND ${result.id}` : "NO RESULT YET"}</h2>
          </div>
          <RouteLink className="text-link" to="/app/draw">
            OPEN DRAW →
          </RouteLink>
        </div>
        {!result ? (
          <p>Verified results will appear here after the first settled round.</p>
        ) : result.status === "FINALIZED" ? (
          <div className="home-result-details">
            <div>
              <span>WINNER</span>
              {result.winner ? (
                <a href={explorerAddress(result.winner)} target="_blank" rel="noreferrer">
                  {shortAddress(result.winner)} ↗
                </a>
              ) : (
                <strong>WINNER VERIFIED</strong>
              )}
            </div>
            <div>
              <span>PROOF</span>
              <strong>KMS VERIFIED</strong>
            </div>
            <p>The winner is public; any delivered prize remains confidential to the winner wallet.</p>
          </div>
        ) : result.status === "CANCELLED" ? (
          <div className="home-result-details">
            <div>
              <span>OUTCOME</span>
              <strong>CANCELLED</strong>
            </div>
            <p>KMS-proven zero-weight draw. No winner or prize was delivered.</p>
          </div>
        ) : (
          <div className="home-result-details">
            <div>
              <span>OUTCOME</span>
              <strong>SKIPPED</strong>
            </div>
            <p>Insufficient participants at the scheduled close. No BlindDraw or encrypted winner exists.</p>
          </div>
        )}
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
