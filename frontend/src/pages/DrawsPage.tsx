import { DrawCountdown } from "../components/DrawCountdown";
import { EncryptedDrawField, type EncryptedDrawFieldState } from "../components/EncryptedDrawField";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import { drawStateLabel, explorerAddress, formatDate } from "../lib/format";

export function DrawsPage({ unveil }: { unveil: UnveilController }) {
  const schedule = unveil.schedule;
  const participantCount = unveil.dashboard?.playerCount ?? unveil.publicProtocol?.playerCount;
  const fieldState: EncryptedDrawFieldState = schedule?.insufficientParticipants
    ? "INSUFFICIENT"
    : schedule?.overdue
      ? "OVERDUE"
      : schedule?.ready || schedule?.timeReady
        ? "READY"
        : "OPEN";
  const steps = ["OPEN", "SNAPSHOT", "BLIND DRAW", "FINALIZE", "DELIVER"];
  return (
    <div className="page-stack route-enter">
      <header className="page-heading">
        <span className="eyebrow">AUTONOMOUS BLIND DRAW</span>
        <h1>
          PUBLIC SCHEDULE.
          <br />
          PRIVATE WEIGHTS.
        </h1>
        <p>The draw is weighted by encrypted balances. Participant count is public; individual weights are private.</p>
      </header>
      <section className="draw-focus draw-focus--field">
        <EncryptedDrawField roundId={schedule?.currentRoundId} participantCount={participantCount} state={fieldState} />
        <div className="draw-focus-copy">
          <span className="eyebrow">ROUND {schedule?.currentRoundId.toString() ?? "—"}</span>
          <DrawCountdown
            closesAt={schedule?.closesAt}
            timeReady={schedule?.timeReady}
            ready={schedule?.ready}
            insufficientParticipants={schedule?.insufficientParticipants}
          />
          <strong className="state-word">{drawStateLabel(schedule)}</strong>
        </div>
      </section>
      <section className="metric-row">
        <div>
          <span>OPENS</span>
          <strong>{formatDate(schedule?.opensAt)}</strong>
        </div>
        <div>
          <span>CLOSES</span>
          <strong>{formatDate(schedule?.closesAt)}</strong>
        </div>
        <div>
          <span>PARTICIPANTS</span>
          <strong>{participantCount ?? "—"}</strong>
        </div>
        <div>
          <span>UNSETTLED ROUNDS</span>
          <strong>{schedule?.unsettledRounds.toString() ?? "—"}</strong>
        </div>
        <div>
          <span>OVERDUE</span>
          <strong>{schedule?.overdue ? "YES" : "NO"}</strong>
        </div>
      </section>
      <section className="draw-lifecycle">
        {steps.map((step, index) => (
          <article
            className={(index === 0 && !schedule?.timeReady) || (index === 1 && schedule?.canAdvance) ? "active" : ""}
            key={step}
          >
            <span>0{index + 1}</span>
            <strong>{step}</strong>
            <i />
          </article>
        ))}
      </section>
      {schedule?.insufficientParticipants && (
        <div className="notice notice--warning">
          <strong>INSUFFICIENT PARTICIPANTS</strong>
          <p>
            The closed round can be permissionlessly marked SKIPPED. No BlindDraw or encrypted winner exists for it.
          </p>
        </div>
      )}
      <section className="explain-grid">
        <article>
          <span>WEIGHTED, NOT EQUAL</span>
          <h3>YOUR BALANCE IS YOUR ENCRYPTED WEIGHT.</h3>
          <p>UNVEIL never divides by public participant count to invent an odds percentage.</p>
        </article>
        <article>
          <span>VERIFIABLE OUTCOME</span>
          <h3>KMS PROOF BEFORE FINALIZATION.</h3>
          <p>The final winner is public only after the contract validates the decryption proof.</p>
        </article>
      </section>
      <div className="contract-links">
        <a href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          V2 POOL ↗
        </a>
        {unveil.latestFinalized?.winner && (
          <a href={explorerAddress(unveil.latestFinalized.winner)} target="_blank" rel="noreferrer">
            LATEST WINNER ↗
          </a>
        )}
      </div>
    </div>
  );
}
