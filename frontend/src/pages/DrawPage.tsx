import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DrawAdvancePanel } from "../components/DrawAdvancePanel";
import { RoundHistory } from "../components/RoundHistory";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import { productError } from "../lib/errors";
import { drawStateLabel, explorerAddress, shortAddress } from "../lib/format";
import { revealPrizeV4 } from "../v4DrawClient";
import { clearPrizeValues, prizeRevealKey, revealPrizeValue, veilPrizeValue } from "../../../shared/prizeRevealState";
import { DASHBOARD_SEALED_SEGMENTS } from "../../../shared/homePresentation";
import { drawRoundCountdownSeconds, drawRoundProgressPercent, formatDrawCountdown } from "../../../shared/drawProgress";
import "./drawPage.css";

const ROTOR_SECTORS = Array.from({ length: 24 }, (_, index) => index);
const ROTOR_SPOKES = [0, 60, 120, 180, 240, 300];

function roundLabel(roundId?: bigint) {
  return roundId === undefined ? "—" : roundId.toString().padStart(2, "0");
}

function DrawShardRotor({ stage, selectedShard }: { stage: string; selectedShard?: number }) {
  const hasSelectedShard = selectedShard !== undefined && selectedShard >= 0 && selectedShard < ROTOR_SECTORS.length;
  return (
    <div className={`draw-shard-rotor draw-shard-rotor--${stage.toLowerCase()}`} aria-hidden="true">
      <svg viewBox="0 0 600 600" focusable="false">
        <g className="draw-shard-rotor__assembly" fill="none" stroke="currentColor">
          <circle className="draw-shard-rotor__outer" cx="300" cy="300" r="252" strokeWidth="1" />
          <circle className="draw-shard-rotor__middle" cx="300" cy="300" r="238" strokeWidth="1" />
          <circle className="draw-shard-rotor__inner" cx="300" cy="300" r="172" strokeWidth="1" />
          <circle className="draw-shard-rotor__hub" cx="300" cy="300" r="42" strokeWidth="1.1" />
          <circle className="draw-shard-rotor__hub-core" cx="300" cy="300" r="20" strokeWidth="1" />
          <g className="draw-shard-rotor__spokes" strokeWidth="1.2">
            {ROTOR_SPOKES.map((spoke) => (
              <path key={spoke} d="M300 128v44" transform={`rotate(${spoke} 300 300)`} />
            ))}
          </g>
          <g className="draw-shard-rotor__sectors" strokeWidth="1">
            {ROTOR_SECTORS.map((sector) => (
              <path
                key={sector}
                className={
                  hasSelectedShard && sector === selectedShard ? "draw-shard-rotor__sector--selected" : undefined
                }
                d="M300 48v74"
                transform={`rotate(${sector * 15} 300 300)`}
              />
            ))}
          </g>
          <path className="draw-shard-rotor__pointer" d="M300 22v30" strokeWidth="2" />
          <path className="draw-shard-rotor__seam" d="M300 42v84" strokeWidth="1.6" />
          <path d="M300 282v36M282 300h36" strokeWidth="1" opacity="0.72" />
        </g>
      </svg>
    </div>
  );
}

function SealedPrizeValue({ value, revealed, busy }: { value?: bigint; revealed: boolean; busy: boolean }) {
  if (revealed) {
    return (
      <strong className="draw-prize-value-revealed">
        {value?.toString() ?? "0"}
        <small>VAULT SHARE UNITS</small>
      </strong>
    );
  }
  return (
    <span className={`draw-prize-value-sealed ${busy ? "is-busy" : ""}`} aria-label="Encrypted prize value sealed">
      {DASHBOARD_SEALED_SEGMENTS.map((width, index) => (
        <i aria-hidden="true" key={index} style={{ "--segment-width": `${width}px` } as CSSProperties} />
      ))}
    </span>
  );
}

type DeliveredPrizeSlot = {
  round: UnveilV4Controller["myDeliveredPrizes"][number];
  prize: UnveilV4Controller["myDeliveredPrizes"][number]["prizes"][number];
};

function PrizeVaultDialog({
  open,
  slots,
  revealedPrizes,
  prizeBusy,
  prizeError,
  onClose,
  onToggle,
  onDismissError,
}: {
  open: boolean;
  slots: DeliveredPrizeSlot[];
  revealedPrizes: Record<string, bigint>;
  prizeBusy: string;
  prizeError: string;
  onClose: () => void;
  onToggle: (roundId: bigint, prizeIndex: number) => Promise<void>;
  onDismissError: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(Boolean(prizeBusy));
  closeRef.current = onClose;
  busyRef.current = Boolean(prizeBusy);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const focusFrame = window.setTimeout(() => focusable()[0]?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="draw-prize-vault-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !prizeBusy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="draw-prize-vault-dialog"
        id="draw-prize-vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draw-prize-vault-title"
        aria-describedby="draw-prize-vault-subtitle"
      >
        <div className="draw-prize-vault-dialog__heading">
          <div>
            <span className="eyebrow">PRIVATE WINNINGS</span>
            <h2 id="draw-prize-vault-title">YOUR PRIZE VAULT</h2>
            <div className="draw-prize-vault-dialog__count">
              <strong>{slots.length.toString().padStart(2, "0")}</strong>
              <span>DELIVERED PRIZES</span>
            </div>
            <p id="draw-prize-vault-subtitle">Amounts stay sealed until this wallet unveils them.</p>
          </div>
          <button
            className="draw-prize-vault-dialog__close"
            type="button"
            onClick={onClose}
            disabled={Boolean(prizeBusy)}
            aria-label="Close prize vault"
            data-cursor={prizeBusy ? undefined : "enter"}
          >
            CLOSE ×
          </button>
        </div>
        {prizeError && (
          <div className="action-notice draw-prize-notice action-notice--error" role="alert">
            <span>PRIZE UNVEIL ERROR</span>
            <p>{prizeError}</p>
            <button
              className="action-notice-dismiss"
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss prize unveil error"
              data-cursor="enter"
            >
              ×
            </button>
          </div>
        )}
        <div className="draw-prize-list">
          {slots.map(({ round, prize }) => {
            const key = prizeRevealKey(round.id, prize.index);
            const revealed = revealedPrizes[key] !== undefined;
            const revealing = prizeBusy === key;
            return (
              <article className={`draw-prize-row ${revealed ? "revealed" : ""}`} key={key}>
                <div className="draw-prize-round">
                  <span>ROUND</span>
                  <strong>{roundLabel(round.id)}</strong>
                </div>
                <div className="draw-prize-slot">
                  <span>PRIZE SLOT / SHARD</span>
                  <strong>
                    {prize.index + 1} · SHARD {prize.shard}
                  </strong>
                </div>
                <div className="draw-prize-private">
                  <span>{revealing ? "UNVEILING…" : revealed ? "UNVEILED LOCALLY" : "FHE SEALED"}</span>
                  <SealedPrizeValue value={revealedPrizes[key]} revealed={revealed} busy={revealing} />
                </div>
                <button
                  className="draw-prize-action"
                  type="button"
                  disabled={Boolean(prizeBusy)}
                  data-cursor={prizeBusy ? undefined : "enter"}
                  onClick={() => void onToggle(round.id, prize.index)}
                >
                  {revealing ? "UNVEILING…" : revealed ? "VEIL →" : "UNVEIL →"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DrawPage({ unveil }: { unveil: UnveilV4Controller }) {
  const schedule = unveil.schedule;
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
  const rotorStage = unveil.drawAction?.stage ?? "WAIT";
  const [revealedPrizes, setRevealedPrizes] = useState<Record<string, bigint>>({});
  const [prizeBusy, setPrizeBusy] = useState("");
  const [prizeError, setPrizeError] = useState("");
  const [prizeVaultOpen, setPrizeVaultOpen] = useState(false);
  const [prizeVaultPulse, setPrizeVaultPulse] = useState(false);
  const seenPrizeCountRef = useRef(0);
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setRevealedPrizes(clearPrizeValues());
    setPrizeBusy("");
    setPrizeError("");
    setPrizeVaultOpen(false);
    seenPrizeCountRef.current = 0;
  }, [unveil.address]);

  const myDeliveredPrizeSlots = unveil.myDeliveredPrizes.flatMap((round) =>
    round.prizes
      .filter((prize) => prize.delivered && prize.winner.toLowerCase() === unveil.address.toLowerCase())
      .map((prize) => ({ round, prize })),
  );

  useEffect(() => {
    const count = myDeliveredPrizeSlots.length;
    if (count <= seenPrizeCountRef.current) return undefined;
    seenPrizeCountRef.current = count;
    setPrizeVaultPulse(true);
    const timer = window.setTimeout(() => setPrizeVaultPulse(false), 900);
    return () => window.clearTimeout(timer);
  }, [myDeliveredPrizeSlots.length]);

  const personalWinSignal = myDeliveredPrizeSlots.length
    ? {
        round: roundLabel(myDeliveredPrizeSlots[0].round.id),
        count: myDeliveredPrizeSlots.length,
      }
    : undefined;

  const roundProgress = schedule ? drawRoundProgressPercent(schedule.opensAt, schedule.closesAt, nowSeconds) : 0;
  const roundCountdown = schedule ? drawRoundCountdownSeconds(schedule.closesAt, nowSeconds) : 0;
  const roundClosed = schedule?.closesAt !== undefined && nowSeconds >= schedule.closesAt;

  async function togglePrizeReveal(roundId: bigint, prizeIndex: number) {
    const key = prizeRevealKey(roundId, prizeIndex);
    const alreadyRevealed = revealedPrizes[key] !== undefined;
    if (alreadyRevealed) {
      setRevealedPrizes((current) => veilPrizeValue(current, key) as Record<string, bigint>);
      return;
    }
    if (!unveil.signer) {
      setPrizeError("Connect the winning Sepolia wallet before unveiling this prize slot.");
      return;
    }
    try {
      setPrizeError("");
      setPrizeBusy(key);
      const value = await revealPrizeV4(unveil.signer, roundId, prizeIndex);
      setRevealedPrizes((current) => revealPrizeValue(current, key, value) as Record<string, bigint>);
    } catch (cause) {
      setPrizeError(productError(cause));
    } finally {
      setPrizeBusy("");
    }
  }

  return (
    <div className="page-stack route-enter draw-page draw-page--simplified">
      <header className="draw-simple-header">
        <div className="draw-simple-meta">
          <span>03 / DRAW</span>
          <span>PUBLIC DRAW</span>
        </div>
        <p data-native-cursor>
          Timing, shard checkpoints, and winners are public; balances and mature weights stay sealed.
        </p>
      </header>

      {(drawError || drawNotice) && (
        <div
          className={`action-notice draw-simple-notice ${drawError ? "action-notice--error" : ""}`}
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
              data-cursor="enter"
            >
              ×
            </button>
          )}
        </div>
      )}

      <section className="draw-current-composition" data-tour="draw-current">
        <DrawShardRotor stage={rotorStage} selectedShard={unveil.drawAction?.shardIndex} />
        <div className="draw-rotor-operation" role="status" aria-live="polite">
          <span>LIVE OPERATION</span>
          <strong>{unveil.drawAction?.title ?? drawStateLabel(schedule)}</strong>
          <small>{schedule?.overdue ? "KEEPER SETTLING" : drawStateLabel(schedule)}</small>
        </div>
        <div className="draw-current-content">
          <div className="draw-round-lockup">
            <span>ROUND</span>
            <strong>{roundLabel(schedule?.currentRoundId)}</strong>
          </div>
          <div className="draw-state-line">
            <span
              className={`draw-public-stage draw-public-stage--${drawStateLabel(schedule).toLowerCase().replaceAll(" ", "-")}`}
            >
              {drawStateLabel(schedule)}
            </span>
            {schedule?.overdue && <small>OVERDUE · SETTLEMENT BACKLOG</small>}
          </div>
          <div className="draw-round-progress">
            <div className="draw-round-progress__meta">
              <strong>{schedule ? `${roundProgress}% COMPLETE` : "ROUND PROGRESS —"}</strong>
              <span>
                {roundClosed ? "ROUND CLOSED" : schedule ? `${formatDrawCountdown(roundCountdown)} REMAINING` : "—"}
              </span>
            </div>
            <div
              className="draw-round-progress__track"
              role="progressbar"
              aria-label="Current round time progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={roundProgress}
            >
              <i style={{ width: `${roundProgress}%` }} />
            </div>
          </div>
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
          {(personalWinSignal || (unveil.connected && myDeliveredPrizeSlots.length > 0)) && (
            <div
              className={`draw-machine-reward ${personalWinSignal ? "has-win" : "vault-only"}`}
              data-tour="draw-prize"
            >
              {personalWinSignal && (
                <div className="draw-personal-win" role="status">
                  <div>
                    <strong>YOU WON</strong>
                    <span>
                      ROUND {personalWinSignal.round} · {personalWinSignal.count} DELIVERED PRIZE SLOT
                      {personalWinSignal.count === 1 ? "" : "S"}
                    </span>
                  </div>
                  <small>PRIZE VAULT READY</small>
                  <i aria-hidden="true">→ VAULT</i>
                </div>
              )}

              {unveil.connected && myDeliveredPrizeSlots.length > 0 && (
                <button
                  className={`draw-prize-vault ${prizeVaultPulse ? "is-pulsing" : ""}`}
                  type="button"
                  onClick={() => setPrizeVaultOpen(true)}
                  aria-haspopup="dialog"
                  aria-controls="draw-prize-vault-dialog"
                  data-cursor="enter"
                >
                  <span className="draw-prize-vault__present" aria-hidden="true">
                    <svg viewBox="0 0 64 72" focusable="false">
                      <rect className="draw-prize-vault__present-box" x="7" y="31" width="50" height="34" />
                      <path className="draw-prize-vault__present-lid" d="M5 25h54v11H5z" />
                      <path className="draw-prize-vault__present-ribbon" d="M32 25v40M7 47h50" />
                      <path
                        className="draw-prize-vault__present-bow"
                        d="M32 25c-8-11-18-9-18-3 0 5 9 7 18 3Zm0 0c8-11 18-9 18-3 0 5-9 7-18 3Z"
                      />
                    </svg>
                  </span>
                  <span className="draw-prize-vault__label">PRIZE VAULT</span>
                  <strong>{myDeliveredPrizeSlots.length.toString().padStart(2, "0")}</strong>
                  <small>DELIVERED</small>
                  <span className="draw-prize-vault__open">OPEN VAULT →</span>
                  <i aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="draw-works" aria-labelledby="draw-works-title">
        <header className="draw-works-heading">
          <span className="eyebrow">HOW THE DRAW WORKS</span>
          <h2 id="draw-works-title">PUBLIC PROOF, PRIVATE WEIGHT.</h2>
        </header>
        <div className="draw-works-grid">
          {[
            ["01", "SNAPSHOT", "Closed-round checkpoints mature encrypted saver weights by shard."],
            [
              "02",
              "DRAW + VERIFY",
              "Each prize slot independently selects a shard and saver through public settlement.",
            ],
            ["03", "DELIVER", "Winning VAULT SHARE UNITS are delivered confidentially to the winner wallet."],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <PrizeVaultDialog
        open={prizeVaultOpen}
        slots={myDeliveredPrizeSlots}
        revealedPrizes={revealedPrizes}
        prizeBusy={prizeBusy}
        prizeError={prizeError}
        onClose={() => setPrizeVaultOpen(false)}
        onToggle={togglePrizeReveal}
        onDismissError={() => setPrizeError("")}
      />

      <section className="draw-latest-result">
        <header className="draw-section-heading">
          <div>
            <span className="eyebrow">LATEST VERIFIED RESULT</span>
            <h2>{result ? `ROUND ${roundLabel(result.id)}` : "NO SETTLED RESULT"}</h2>
          </div>
          <span className={`draw-result-status draw-result-status--${result?.status?.toLowerCase() ?? "empty"}`}>
            {result?.status ?? "—"}
          </span>
        </header>
        <div className="draw-latest-body">
          <p>
            {result?.status === "FINALIZED"
              ? "Three independently verified prize slots finalized."
              : result?.status === "CANCELLED"
                ? "Three KMS-verified zero winners; no prize was delivered."
                : result?.status === "SKIPPED"
                  ? "Fewer than two mature seats; the draw was skipped."
                  : "The latest finalized, cancelled, or skipped round will appear here."}
          </p>
          {result?.status === "FINALIZED" && (
            <div className="draw-winner-list">
              {result.prizes.map((prize) => (
                <span key={`${result.id}-${prize.index}`}>
                  P{prize.index + 1} · S{prize.shard} · {shortAddress(prize.winner)}
                </span>
              ))}
            </div>
          )}
          {result?.status === "FINALIZED" && result.prizes.length > 0 && (
            <a
              className="draw-verify-action"
              href={explorerAddress(result.prizes[0].winner)}
              target="_blank"
              rel="noreferrer"
              data-cursor="enter"
            >
              VERIFY WINNERS →
            </a>
          )}
        </div>
      </section>

      <section className="draw-past-draws">
        <header className="draw-section-heading">
          <div>
            <span className="eyebrow">PAST DRAWS</span>
            <h2>Verified onchain.</h2>
          </div>
          <a
            className="draw-verify-action"
            href={explorerAddress(UNVEIL_CONTRACTS.pool)}
            target="_blank"
            rel="noreferrer"
            data-cursor="enter"
          >
            VERIFY POOL →
          </a>
        </header>
        <RoundHistory rounds={unveil.history} showExplorerLink={false} interactiveCursor="enter" />
      </section>
    </div>
  );
}
