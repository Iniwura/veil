import type { CSSProperties } from "react";
import { DashboardPrivatePosition } from "../components/DashboardPrivatePosition";
import { RouteLink } from "../components/RouteLink";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import {
  deriveHomeNextAction,
  deriveHomePersonalSignal,
  HOME_PROTOCOL_CAPACITY_LABEL,
  isKeeperSettlementAction,
} from "../../../shared/homePresentation";
import { drawStateLabel, explorerAddress, formatDate, shortAddress } from "../lib/format";
import "./homeDashboard.css";

const SHARD_MARKERS = Array.from({ length: 24 }, (_, index) => index);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function HomeHistoryLedger({ rounds }: { rounds: UnveilV4Controller["history"] }) {
  if (rounds.length === 0) {
    return (
      <div className="home-history-empty">
        <span>NO SETTLED ROUNDS LOADED</span>
        <p>Verified results will appear after a round is finalized, cancelled, or skipped.</p>
      </div>
    );
  }

  return (
    <div className="home-history-ledger" role="table" aria-label="Recent verified rounds">
      <div className="home-history-ledger-head" role="row">
        <span role="columnheader">ROUND</span>
        <span role="columnheader">STATE</span>
        <span role="columnheader">PRIZE 1</span>
        <span role="columnheader">PRIZE 2</span>
        <span role="columnheader">PRIZE 3</span>
      </div>
      {rounds.slice(0, 3).map((round) => (
        <div className="home-history-ledger-row" role="row" key={round.id.toString()}>
          <strong role="cell">{round.id.toString().padStart(2, "0")}</strong>
          <strong role="cell" data-state={round.status}>
            {round.status}
          </strong>
          {[0, 1, 2].map((slot) => {
            const prize = round.prizes[slot];
            const winner = prize?.winner;
            const hasWinner = Boolean(winner && winner.toLowerCase() !== ZERO_ADDRESS);
            return (
              <span role="cell" key={slot}>
                {round.status === "FINALIZED" && prize && hasWinner ? (
                  <a href={explorerAddress(winner)} target="_blank" rel="noreferrer">
                    S{prize.shard} · {shortAddress(winner)} ↗
                  </a>
                ) : round.status === "FINALIZED" ? (
                  "ZERO"
                ) : (
                  "NO DRAW"
                )}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function HomePage({ unveil }: { unveil: UnveilV4Controller }) {
  const data = unveil.dashboard;
  const schedule = unveil.schedule;
  const latestFinalized = unveil.latestFinalized;
  const drawAction = unveil.drawAction;
  const activeParticipants = data?.playerCount ?? unveil.publicProtocol?.playerCount;
  const winnerPrize = latestFinalized?.prizes.find(
    (prize) => Boolean(unveil.address) && prize.winner.toLowerCase() === unveil.address.toLowerCase(),
  );
  const winnerSignal =
    latestFinalized && winnerPrize ? { roundId: latestFinalized.id, prizeIndex: winnerPrize.index } : undefined;
  const withdrawalActionable = Boolean(data?.latestWithdrawal?.action?.actionable);
  const redemptionActionable = Boolean(unveil.prizeRedemption?.action?.actionable);
  const keeperSettling = isKeeperSettlementAction(drawAction?.kind);
  const action = deriveHomeNextAction({
    connected: unveil.connected,
    wrongNetwork: unveil.wrongNetwork,
    accountReady: Boolean(data),
    vaultRevealed: Boolean(unveil.vault),
    busy: unveil.busy,
    pendingSeatAttestation: Boolean(data?.pendingSeatAttestation),
    joined: Boolean(data?.joined),
    seated: Boolean(data?.seated),
    connectedWinner: Boolean(winnerSignal),
    withdrawalActionable,
    redemptionActionable,
    keeperSettling,
  });
  const signal = deriveHomePersonalSignal({
    winner: winnerSignal,
    withdrawalActionable,
    pendingSeatAttestation: Boolean(data?.pendingSeatAttestation),
    seated: Boolean(data?.seated),
  });
  const roundLabel = schedule?.currentRoundId.toString().padStart(2, "0") ?? "—";

  function renderAction() {
    if (action.passive) {
      return <strong className="home-action-passive">{action.label}</strong>;
    }
    if (action.kind === "CONNECT" || action.kind === "SWITCH_NETWORK") {
      return (
        <button
          className="button-primary home-action-cta"
          type="button"
          data-cursor="enter"
          onClick={action.kind === "SWITCH_NETWORK" ? unveil.switchToSepolia : unveil.connect}
          disabled={Boolean(unveil.busy)}
        >
          {action.label} <span>↗</span>
        </button>
      );
    }
    return action.href ? (
      <RouteLink className="button-primary home-action-cta" to={action.href} dataCursor="enter">
        {action.label} <span>↗</span>
      </RouteLink>
    ) : null;
  }

  return (
    <div className="home-dashboard-page route-enter">
      <section className="home-ledger-spine" aria-labelledby="home-round-heading">
        <div className="home-shard-architecture" aria-hidden="true">
          <div className="home-shard-architecture-ring home-shard-architecture-ring--outer" />
          <div className="home-shard-architecture-ring home-shard-architecture-ring--inner" />
          {SHARD_MARKERS.map((index) => (
            <i key={index} style={{ "--shard-index": index } as CSSProperties} />
          ))}
        </div>
        <div className="home-spine-copy">
          <span className="eyebrow">CURRENT DRAW</span>
          <div className="home-round-display" id="home-round-heading">
            <span>ROUND</span>
            <strong>{roundLabel}</strong>
          </div>
          <p>
            PUBLIC STATE · <strong>{drawStateLabel(schedule)}</strong>
          </p>
        </div>
        <div className="home-spine-meta">
          <div className="home-spine-next">
            <span className="eyebrow">NEXT PROTOCOL STEP</span>
            <strong>{drawAction?.title ?? "RESOLVING PUBLIC STATE"}</strong>
            <small>
              {keeperSettling
                ? "Permissionless keeper maintenance is in progress. No saver wallet action is required."
                : "Only public state is shown here; encrypted balances remain local."}
            </small>
          </div>
          <dl>
            <div>
              <dt>ACTIVE SAVERS</dt>
              <dd>{activeParticipants ?? "—"}</dd>
            </div>
            <div>
              <dt>PROTOCOL CAPACITY</dt>
              <dd>{HOME_PROTOCOL_CAPACITY_LABEL}</dd>
            </div>
            <div>
              <dt>CLOSES / SETTLES</dt>
              <dd>{formatDate(schedule?.closesAt)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={`home-dashboard-body${action.kind === "UNVEIL" ? " home-dashboard-body--private" : ""}`}>
        <div className="home-private-column">
          <DashboardPrivatePosition
            vault={unveil.vault}
            busy={unveil.busy === "reveal-vault"}
            onReveal={unveil.revealVaultStats}
            onHide={unveil.hideVault}
          />
          {signal && (
            <div className={`home-personal-signal home-personal-signal--${signal.kind.toLowerCase()}`}>
              <span className="eyebrow">PERSONAL SIGNAL</span>
              <div>
                <strong>{signal.label}</strong>
                {signal.href && signal.actionLabel && (
                  <RouteLink className="text-link" to={signal.href} dataCursor="enter">
                    {signal.actionLabel}
                  </RouteLink>
                )}
              </div>
            </div>
          )}
        </div>
        {action.kind !== "UNVEIL" && (
          <aside
            className={`home-action-rail home-action-rail--${action.passive ? "passive" : "actionable"}`}
            aria-label="Next useful action"
          >
            <div className="home-action-block">
              <span className="eyebrow">NEXT USEFUL ACTION</span>
              {renderAction()}
              <p>{action.description}</p>
            </div>
          </aside>
        )}
      </section>

      <section className="home-history" aria-labelledby="home-history-heading">
        <div className="home-history-head">
          <div>
            <span className="eyebrow">VERIFIED HISTORY</span>
            <h2 id="home-history-heading">Recent draws.</h2>
          </div>
          <RouteLink className="text-link" to="/app/draw" dataCursor="enter">
            VIEW ALL →
          </RouteLink>
        </div>
        <HomeHistoryLedger rounds={unveil.history} />
      </section>
    </div>
  );
}
