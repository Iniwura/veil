import { useEffect, useState } from "react";
import { DrawAdvancePanel } from "../components/DrawAdvancePanel";
import {
  CryptographicChamber,
  type CryptographicChamberPhase,
  type CryptographicChamberState,
} from "../components/CryptographicChamber";
import { RoundHistory } from "../components/RoundHistory";
import { VeilReveal } from "../components/VeilReveal";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import type { DrawAction } from "../lib/drawAdvance";
import { productError } from "../lib/errors";
import { drawStateLabel, explorerAddress, formatDate, shortAddress } from "../lib/format";
import { revealPrizeV4 } from "../v4DrawClient";

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
  if (action.stage === "COMPLETE") return "COMPLETE";
  if (action.stage === "SNAPSHOT") return "SNAPSHOT";
  if (action.stage === "BLIND_DRAW") return "BLIND_DRAW";
  if (action.stage === "VERIFY") return "VERIFY";
  if (action.stage === "DELIVER") return "DELIVER";
  return "SEALED";
}

export function DrawPage({ unveil }: { unveil: UnveilV4Controller }) {
  const schedule = unveil.schedule;
  const currentSeatCount = unveil.dashboard?.playerCount ?? unveil.publicProtocol?.playerCount;
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
    unveil.drawAction?.stage === "COMPLETE"
      ? unveil.history.find((round) => round.id === unveil.drawAction?.roundId)?.status
      : undefined;
  const terminalState =
    terminalRoundStatus === "CANCELLED" || terminalRoundStatus === "SKIPPED"
      ? terminalRoundStatus
      : terminalRoundStatus
        ? "COMPLETE"
        : undefined;
  const [revealedPrize, setRevealedPrize] = useState<{ roundId: bigint; prizeIndex: number; value: bigint }>();
  const [prizeBusy, setPrizeBusy] = useState("");
  const [prizeError, setPrizeError] = useState("");

  useEffect(() => {
    setRevealedPrize(undefined);
    setPrizeBusy("");
    setPrizeError("");
  }, [unveil.address]);

  const myDeliveredPrizeSlots = unveil.myDeliveredPrizes.flatMap((round) =>
    round.prizes
      .filter(
        (prize) =>
          prize.delivered &&
          prize.winner.toLowerCase() === unveil.address.toLowerCase(),
      )
      .map((prize) => ({ round, prize })),
  );

  async function togglePrizeReveal(roundId: bigint, prizeIndex: number) {
    const alreadyRevealed = revealedPrize?.roundId === roundId && revealedPrize.prizeIndex === prizeIndex;
    if (alreadyRevealed) {
      setRevealedPrize(undefined);
      return;
    }
    if (!unveil.signer) {
      setPrizeError("Connect the winning Sepolia wallet before unveiling this prize slot.");
      return;
    }
    const key = `${roundId}-${prizeIndex}`;
    try {
      setPrizeError("");
      setPrizeBusy(key);
      const value = await revealPrizeV4(unveil.signer, roundId, prizeIndex);
      setRevealedPrize({ roundId, prizeIndex, value });
    } catch (cause) {
      setPrizeError(productError(cause));
    } finally {
      setPrizeBusy("");
    }
  }

  return (
    <div className="page-stack route-enter">
      <header className="draw-page-intro">
        <div className="draw-page-intro-heading">
          <span className="eyebrow">PUBLIC SETTLEMENT · V4</span>
          <strong>{schedule?.currentRoundId.toString().padStart(2, "0") ?? "—"}</strong>
        </div>
        <p data-native-cursor>
          Timing, shard checkpoints, selected shards, and winners are public. Balances, mature ticket weights, and prize
          amounts stay encrypted until an authorized wallet unveils them.
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
            <button
              className="action-notice-dismiss"
              type="button"
              onClick={unveil.clearError}
              aria-label="Dismiss draw error"
            >
              ×
            </button>
          )}
        </div>
      )}

      <section className="draw-focus draw-focus--field" data-tour="draw-current">
        <CryptographicChamber
          roundId={schedule?.currentRoundId}
          participantCount={currentSeatCount}
          participantLabel="CURRENT SEATS"
          state={fieldState}
          phase={chamberPhase}
        />
        <div className="draw-focus-copy">
          <div className="draw-current-summary">
            <span className="eyebrow">
              CURRENT ROUND · {schedule?.currentRoundId.toString().padStart(2, "0") ?? "—"}
            </span>
            <strong>{drawStateLabel(schedule)}</strong>
          </div>
          <div className="draw-mini-metrics">
            <span>OPENS {formatDate(schedule?.opensAt)}</span>
            <span>CLOSES {formatDate(schedule?.closesAt)}</span>
            <span>{schedule?.unsettledRounds.toString() ?? "—"} UNSETTLED</span>
          </div>
          <p className="draw-note">
            V4 supports 24 public shards × 24 seats. A closed round is checkpointed one shard per transaction, then each
            of the three prize slots independently selects an encrypted shard and an encrypted saver inside it.
          </p>
          <p className="draw-note">
            New savings become prize-eligible after one complete draw period. The same saver may win more than one prize
            slot.
          </p>
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
          <a
            className="text-link"
            data-cursor="verify"
            href={explorerAddress(UNVEIL_CONTRACTS.pool)}
            target="_blank"
            rel="noreferrer"
          >
            VERIFY V4 POOL ↗
          </a>
        </header>

        <div className="settlement-grid">
          <section className="draw-result-card" data-tour="draw-result">
            <div>
              <span className="eyebrow">LATEST RESULT</span>
              <h2>{result ? `ROUND ${result.id.toString().padStart(2, "0")}` : "NO SETTLED RESULT"}</h2>
              <p>
                {result?.status === "FINALIZED"
                  ? "Three independently verified two-stage prize slots finalized."
                  : result?.status === "CANCELLED"
                    ? "All three KMS-verified winner outputs were zero. No prize was delivered."
                    : result?.status === "SKIPPED"
                      ? "The completed sharded checkpoint contained fewer than two mature seats."
                      : "The latest finalized, cancelled, or skipped V4 round will appear here."}
              </p>
              {result?.status === "FINALIZED" && (
                <div className="draw-mini-metrics">
                  {result.prizes.map((prize) => (
                    <span key={`${result.id}-${prize.index}`}>
                      P{prize.index + 1} · S{prize.shard} · {shortAddress(prize.winner)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="draw-result-state">
              <span>STATE</span>
              <strong>{result?.status ?? "—"}</strong>
              {result?.status === "FINALIZED" && result.prizes.length > 0 && (
                <a href={explorerAddress(result.prizes[0].winner)} target="_blank" rel="noreferrer" data-cursor="verify">
                  VERIFY WINNERS ↗
                </a>
              )}
            </div>
          </section>

          <section className="draw-prize" data-tour="draw-prize">
            <div className="home-section-head">
              <div>
                <span className="eyebrow">MY PRIZE SLOTS</span>
                <h2>Confidential delivery.</h2>
              </div>
              <span className="draw-prize-note">NO CLAIM TRANSACTION</span>
            </div>
            <p className="draw-prize-intro" data-native-cursor>
              A finalized V4 round has three independently selected prize slots. Delivered TEST strategy shares are
              already in each winner wallet; only that wallet can unveil each slot amount.
            </p>
            {prizeError && (
              <div className="action-notice action-notice--error" role="alert">
                <span>PRIZE UNVEIL ERROR</span>
                <p>{prizeError}</p>
                <button
                  className="action-notice-dismiss"
                  type="button"
                  onClick={() => setPrizeError("")}
                  aria-label="Dismiss prize unveil error"
                >
                  ×
                </button>
              </div>
            )}
            {!unveil.connected ? (
              <div className="empty-state">
                <span>{unveil.wrongNetwork ? "WRONG NETWORK" : "WALLET DISCONNECTED"}</span>
                <p>
                  {unveil.wrongNetwork
                    ? "Switch to Sepolia to inspect wallet-dependent V4 prizes."
                    : "Connect a winner wallet to find its recent delivered prize slots."}
                </p>
              </div>
            ) : myDeliveredPrizeSlots.length === 0 ? (
              <div className="empty-state">
                <span>NO DELIVERED PRIZE SLOT IN RECENT HISTORY</span>
                <p>This wallet is not a delivered winner of any loaded V4 prize slot.</p>
              </div>
            ) : (
              <div className="prize-list">
                {myDeliveredPrizeSlots.map(({ round, prize }) => {
                  const key = `${round.id}-${prize.index}`;
                  const revealed = revealedPrize?.roundId === round.id && revealedPrize.prizeIndex === prize.index;
                  const revealing = prizeBusy === key;
                  return (
                    <article className={revealed ? "revealed" : ""} key={key}>
                      <div>
                        <span>ROUND</span>
                        <strong>{round.id.toString().padStart(2, "0")}</strong>
                      </div>
                      <div>
                        <span>PRIZE SLOT</span>
                        <strong>
                          {prize.index + 1} · SHARD {prize.shard}
                        </strong>
                      </div>
                      <VeilReveal
                        compact
                        label="Confidential strategy shares"
                        value={revealed ? revealedPrize.value : undefined}
                        revealed={revealed}
                        busy={revealing}
                        revealedLabel="UNVEILED TO WINNER"
                        detail="Already delivered · no claim"
                        unit=" TEST SHARE UNITS"
                      />
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={Boolean(prizeBusy)}
                        onClick={() => void togglePrizeReveal(round.id, prize.index)}
                      >
                        {revealing ? "UNVEILING…" : revealed ? "VEIL PRIZE" : `UNVEIL PRIZE ${prize.index + 1}`}
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
