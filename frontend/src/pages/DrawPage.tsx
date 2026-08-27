import { DrawAdvancePanel } from "../components/DrawAdvancePanel";
import {
  CryptographicChamber,
  type CryptographicChamberPhase,
  type CryptographicChamberState,
} from "../components/CryptographicChamber";
import { RoundHistory } from "../components/RoundHistory";
import { VeilReveal } from "../components/VeilReveal";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import type { DrawAction } from "../lib/drawAdvance";
import { drawStateLabel, explorerAddress, formatDate, shortAddress } from "../lib/format";

function chamberPhaseForAction(
  action: DrawAction | undefined,
  state: CryptographicChamberState,
): CryptographicChamberPhase {
  if (!action) {
    if (state === "INSUFFICIENT") return "SKIP";
    if (state === "OVERDUE") return "BACKLOG";
    if (state === "READY") return "SNAPSHOT";
    return "SEALED";
  }
  if (action.kind === "SKIP") return "SKIP";
  if (action.kind === "BLOCKED") return "BACKLOG";
  if (action.kind === "PROCESS_PRIZE" && action.stage === "COMPLETE") return "COMPLETE";
  if (action.stage === "SNAPSHOT") return "SNAPSHOT";
  if (action.stage === "BLIND_DRAW") return "BLIND_DRAW";
  if (action.stage === "VERIFY") return "VERIFY";
  if (action.stage === "DELIVER") return "DELIVER";
  return "SEALED";
}

export function DrawPage({ unveil }: { unveil: UnveilController }) {
  const schedule = unveil.schedule;
  const participantCount = unveil.dashboard?.playerCount ?? unveil.publicProtocol?.playerCount;
  const fieldState: CryptographicChamberState = schedule?.insufficientParticipants
    ? "INSUFFICIENT"
    : schedule?.overdue
      ? "OVERDUE"
      : schedule?.ready || schedule?.timeReady
        ? "READY"
        : "OPEN";
  const chamberPhase = chamberPhaseForAction(unveil.drawAction, fieldState);
  const result = unveil.latestResult;
  const drawError = unveil.errorScope === "draw" ? unveil.error : "";
  const drawNotice = unveil.noticeScope === "draw" ? unveil.notice : "";
  const terminalRoundStatus =
    unveil.drawAction?.kind === "PROCESS_PRIZE" && unveil.drawAction.stage === "COMPLETE"
      ? unveil.history.find((round) => round.id === unveil.drawAction?.roundId)?.status
      : undefined;
  const terminalState =
    terminalRoundStatus === "CANCELLED" || terminalRoundStatus === "SKIPPED"
      ? terminalRoundStatus
      : terminalRoundStatus
        ? "COMPLETE"
        : undefined;

  return (
    <div className="page-stack route-enter">
      <header className="draw-page-intro">
        <span className="eyebrow">DRAW · CRYPTOGRAPHIC CHAMBER</span>
        <p>
          Timing and winners are public. Balances, weights, and prizes stay encrypted until your wallet unveils them.
        </p>
      </header>

      {(drawError || drawNotice) && (
        <div
          className={`action-notice ${drawError ? "action-notice--error" : ""}`}
          role={drawError ? "alert" : "status"}
        >
          <span>{drawError ? "DRAW ERROR" : "DRAW UPDATE"}</span>
          <p>{drawError || drawNotice}</p>
          {drawError && (
            <button className="action-notice-dismiss" onClick={unveil.clearError} aria-label="Dismiss draw error">
              ×
            </button>
          )}
        </div>
      )}

      <section className="draw-focus draw-focus--field" data-tour="draw-current">
        <CryptographicChamber
          roundId={schedule?.currentRoundId}
          participantCount={participantCount}
          state={fieldState}
          phase={chamberPhase}
        />
        <div className="draw-focus-copy">
          <div className="draw-current-summary">
            <span className="eyebrow">CURRENT ROUND · {schedule?.currentRoundId.toString() ?? "—"}</span>
            <strong>{drawStateLabel(schedule)}</strong>
          </div>
          <div className="draw-mini-metrics">
            <span>OPENS {formatDate(schedule?.opensAt)}</span>
            <span>CLOSES {formatDate(schedule?.closesAt)}</span>
            <span>{schedule?.unsettledRounds.toString() ?? "—"} UNSETTLED</span>
          </div>
          {schedule?.insufficientParticipants && (
            <p className="draw-note">This round can be marked SKIPPED. No draw or encrypted winner exists for it.</p>
          )}
          <DrawAdvancePanel
            action={unveil.drawAction}
            connected={unveil.connected}
            wrongNetwork={unveil.wrongNetwork}
            busy={unveil.busy}
            onAdvance={unveil.advanceDraw}
            onConnect={unveil.connect}
            onSwitchNetwork={unveil.switchToSepolia}
            terminalState={terminalState}
          />
        </div>
      </section>

      <section className="settlement-surface">
        <header className="settlement-heading">
          <div>
            <span className="eyebrow">SETTLEMENT + HISTORY</span>
            <h2>Recent verified activity.</h2>
          </div>
          <a className="text-link" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
            VERIFY V2 POOL ↗
          </a>
        </header>

        <div className="settlement-grid">
          <section className="draw-result-card" data-tour="draw-result">
            <div>
              <span className="eyebrow">LATEST RESULT</span>
              <h2>{result ? `ROUND ${result.id}` : "NO SETTLED RESULT"}</h2>
              <p>
                {result?.winner
                  ? `Verified winner ${shortAddress(result.winner)}.`
                  : result?.status === "CANCELLED"
                    ? "KMS-proven zero-weight draw. No prize was delivered."
                    : result?.status === "SKIPPED"
                      ? "Skipped at the scheduled close because fewer than two seats were eligible."
                      : "The latest finalized, cancelled, or skipped round will appear here."}
              </p>
            </div>
            <div className="draw-result-state">
              <span>STATE</span>
              <strong>{result?.status ?? "—"}</strong>
              {result?.winner && (
                <a href={explorerAddress(result.winner)} target="_blank" rel="noreferrer">
                  VERIFY WINNER ↗
                </a>
              )}
            </div>
          </section>

          <section className="draw-prize" data-tour="draw-prize">
            <div className="home-section-head">
              <div>
                <span className="eyebrow">MY PRIZE</span>
                <h2>Confidential delivery.</h2>
              </div>
              <span className="draw-prize-note">NO CLAIM TRANSACTION</span>
            </div>
            <p className="draw-prize-intro">
              Processed winners receive confidential TEST strategy shares directly. Only the winning wallet can unveil
              the delivered amount.
            </p>
            {!unveil.connected ? (
              <div className="empty-state">
                <span>WALLET DISCONNECTED</span>
                <p>Connect the winner wallet to find its recent delivered prizes.</p>
              </div>
            ) : unveil.myDeliveredPrizes.length === 0 ? (
              <div className="empty-state">
                <span>NO DELIVERED PRIZE IN RECENT HISTORY</span>
                <p>This wallet is not the processed winner of a loaded finalized round.</p>
              </div>
            ) : (
              <div className="prize-list">
                {unveil.myDeliveredPrizes.map((deliveredRound) => {
                  const revealed = unveil.prize?.roundId === deliveredRound.id;
                  const revealing = unveil.busy === `reveal-prize-${deliveredRound.id}`;
                  return (
                    <article className={revealed ? "revealed" : ""} key={deliveredRound.id.toString()}>
                      <div>
                        <span>ROUND</span>
                        <strong>{deliveredRound.id.toString().padStart(2, "0")}</strong>
                      </div>
                      <div>
                        <span>STATUS</span>
                        <strong>DELIVERED</strong>
                      </div>
                      <VeilReveal
                        compact
                        label="Confidential strategy shares"
                        value={revealed ? unveil.prize?.value : undefined}
                        revealed={revealed}
                        busy={revealing}
                        revealedLabel="UNVEILED TO WINNER"
                        detail="Already delivered · no claim"
                        unit=" TEST SHARE UNITS"
                      />
                      <button
                        className="button-secondary"
                        disabled={Boolean(unveil.busy)}
                        onClick={() => (revealed ? unveil.hidePrize() : unveil.revealPrizeForRound(deliveredRound.id))}
                      >
                        {revealing ? "UNVEILING…" : revealed ? "VEIL PRIZE" : "UNVEIL PRIZE"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className="draw-history-section">
          <div className="home-section-head">
            <div>
              <span className="eyebrow">PAST DRAWS</span>
              <h3>Verified onchain.</h3>
            </div>
          </div>
          <RoundHistory rounds={unveil.history} showExplorerLink={false} />
        </section>
      </section>
    </div>
  );
}
