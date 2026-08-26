import { DrawCountdown } from "../components/DrawCountdown";
import { CryptographicChamber, type CryptographicChamberState } from "../components/CryptographicChamber";
import { RoundHistory } from "../components/RoundHistory";
import { VeilReveal } from "../components/VeilReveal";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import { drawStateLabel, explorerAddress, formatDate, shortAddress } from "../lib/format";

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
  const result = unveil.latestResult;
  const latestReveal = result && unveil.prize?.roundId === result.id ? unveil.prize : undefined;
  const drawError = unveil.errorScope === "draw" ? unveil.error : "";
  const drawNotice = unveil.noticeScope === "draw" ? unveil.notice : "";

  return (
    <div className="page-stack route-enter">
      <header className="draw-page-intro">
        <span className="eyebrow">DRAW · CRYPTOGRAPHIC CHAMBER</span>
        <p>Timing and winners are public. Balances, weights, and prizes stay encrypted until your wallet unveils them.</p>
      </header>

      {(drawError || drawNotice) && (
        <div className={`action-notice ${drawError ? "action-notice--error" : ""}`} role={drawError ? "alert" : "status"}>
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
        <CryptographicChamber roundId={schedule?.currentRoundId} participantCount={participantCount} state={fieldState} />
        <div className="draw-focus-copy">
          <span className="eyebrow">CURRENT ROUND · {schedule?.currentRoundId.toString() ?? "—"}</span>
          <DrawCountdown
            closesAt={schedule?.closesAt}
            timeReady={schedule?.timeReady}
            ready={schedule?.ready}
            insufficientParticipants={schedule?.insufficientParticipants}
          />
          <strong className="state-word">{drawStateLabel(schedule)}</strong>
          <div className="draw-mini-metrics">
            <span>OPENS {formatDate(schedule?.opensAt)}</span>
            <span>CLOSES {formatDate(schedule?.closesAt)}</span>
            <span>{schedule?.unsettledRounds.toString() ?? "—"} UNSETTLED</span>
          </div>
          {schedule?.insufficientParticipants && (
            <p className="draw-note">This round can be marked SKIPPED. No draw or encrypted winner exists for it.</p>
          )}
        </div>
      </section>

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
            <h2>DELIVERED AUTOMATICALLY.</h2>
          </div>
          <span className="draw-prize-note">NO CLAIM TRANSACTION</span>
        </div>
        <p className="draw-prize-intro">
          Winners receive confidential TEST strategy shares directly. Only the winning wallet can unveil the delivered
          amount.
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

      <section className="draw-history-section">
        <div className="home-section-head">
          <div>
            <span className="eyebrow">PAST DRAWS</span>
            <h2>VERIFIED ONCHAIN.</h2>
          </div>
        </div>
        <RoundHistory rounds={unveil.history} />
      </section>

      <div className="contract-links">
        <a href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          VERIFY V2 POOL ↗
        </a>
      </div>
    </div>
  );
}
