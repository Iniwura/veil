import { DrawCountdown } from "../components/DrawCountdown";
import { VeilReveal } from "../components/VeilReveal";
import { RoundHistory } from "../components/RoundHistory";
import { RouteLink } from "../components/RouteLink";
import { WithdrawalStatus } from "../components/WithdrawalStatus";
import type { UnveilController } from "../hooks/useUnveil";
import { drawStateLabel, formatDate } from "../lib/format";

export function OverviewPage({ unveil }: { unveil: UnveilController }) {
  const data = unveil.dashboard;
  const schedule = unveil.schedule;
  return (
    <div className="page-stack route-enter">
      <section className="draw-command">
        <div className="draw-command-top">
          <div>
            <span className="eyebrow">NEXT DRAW</span>
            <h1>ROUND {schedule?.currentRoundId.toString().padStart(2, "0") ?? "—"}</h1>
          </div>
          <div>
            <span>CLOSES IN</span>
            <DrawCountdown
              closesAt={schedule?.closesAt}
              timeReady={schedule?.timeReady}
              ready={schedule?.ready}
              insufficientParticipants={schedule?.insufficientParticipants}
            />
          </div>
        </div>
        <div className="draw-command-grid">
          <div>
            <span>STATE</span>
            <strong>{drawStateLabel(schedule)}</strong>
          </div>
          <div>
            <span>YOUR SEAT</span>
            <strong>
              {unveil.wrongNetwork
                ? "WRONG NETWORK"
                : !unveil.connected
                  ? "CONNECT WALLET"
                  : data?.seated
                    ? "ACTIVE"
                    : data?.joined
                      ? "EXPIRED"
                      : "NOT JOINED"}
            </strong>
          </div>
          <div>
            <span>PARTICIPANTS</span>
            <strong>{data?.playerCount ?? unveil.publicProtocol?.playerCount ?? "—"}</strong>
          </div>
          <div>
            <span>SCHEDULED CLOSE</span>
            <strong>{formatDate(schedule?.closesAt)}</strong>
          </div>
        </div>
        {!unveil.connected ? (
          <button className="button-primary" onClick={unveil.wrongNetwork ? unveil.switchToSepolia : unveil.connect}>
            {unveil.wrongNetwork ? "Switch to Sepolia" : "Connect wallet"}
          </button>
        ) : data?.joined && !data.seated ? (
          <button className="button-secondary" onClick={unveil.renewSeat} disabled={Boolean(unveil.busy)}>
            Renew draw seat
          </button>
        ) : (
          <RouteLink className="text-link" to="/app/draws">
            OPEN DRAW DETAILS →
          </RouteLink>
        )}
      </section>

      <section className="overview-grid">
        <article className="private-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MY PRIVATE POSITION</span>
              <h2>SEALED BY DEFAULT.</h2>
            </div>
            <RouteLink className="text-link" to="/app/vault">
              OPEN MY VAULT →
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
              label="TEST strategy shares"
              value={unveil.vault?.strategySharePrizeBalance}
              revealed={Boolean(unveil.vault)}
              busy={unveil.busy === "reveal-vault"}
              unit=" SHARE UNITS"
            />
          </div>
          <button
            className="button-secondary"
            disabled={Boolean(unveil.busy)}
            onClick={unveil.vault ? unveil.hideVault : unveil.revealVaultStats}
          >
            {unveil.vault ? "VEIL MY STATS" : "UNVEIL MY PRIVATE STATS"}
          </button>
        </article>
        <article className="status-panel">
          <span className="eyebrow">WITHDRAWAL STATUS</span>
          <WithdrawalStatus request={data?.latestWithdrawal} />
          <RouteLink className="text-link" to="/app/save">
            MANAGE SAVINGS →
          </RouteLink>
        </article>
      </section>

      <section className="overview-grid overview-grid--lower">
        <article className="status-panel">
          <span className="eyebrow">PRIZE STATUS</span>
          <h2>
            {!unveil.latestFinalized
              ? "NO SETTLED PRIZE ROUND"
              : unveil.latestFinalized.processedPrize
                ? "DELIVERED"
                : "PROCESSING"}
          </h2>
          <p>
            {unveil.connectedWinner
              ? "This wallet is the finalized winner. You may unveil the delivered amount."
              : "Prize amounts remain encrypted and winner-only."}
          </p>
          <RouteLink className="text-link" to="/app/prizes">
            OPEN PRIZES →
          </RouteLink>
        </article>
        <article className="history-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">VERIFIED HISTORY</span>
              <h2>LATEST RESULTS.</h2>
            </div>
            <RouteLink className="text-link" to="/app/history">
              VIEW ALL →
            </RouteLink>
          </div>
          <RoundHistory rounds={unveil.history} compact />
        </article>
      </section>
    </div>
  );
}
