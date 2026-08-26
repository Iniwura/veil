import { useState } from "react";
import type { CSSProperties } from "react";
import { UNVEIL_CONTRACTS } from "../contracts";
import { explorerAddress, shortAddress } from "../lib/format";
import type { VerifiedRound } from "../veilClient";

function prizeLabel(round: VerifiedRound) {
  if (round.status === "CANCELLED") return "NO PRIZE · ROUND CANCELLED";
  if (round.status === "SKIPPED") return "NO PRIZE · ROUND SKIPPED";
  return round.processedPrize ? "DELIVERED" : "PROCESSING";
}

export function RoundHistory({
  rounds,
  compact = false,
  showExplorerLink = !compact,
}: {
  rounds: VerifiedRound[];
  compact?: boolean;
  showExplorerLink?: boolean;
}) {
  const [replay, setReplay] = useState<{ id: bigint; token: number }>();
  if (rounds.length === 0) {
    return (
      <div className="empty-state">
        <span>NO SETTLED ROUNDS LOADED</span>
        <p>Verified results will appear after a round is finalized, cancelled, or skipped.</p>
      </div>
    );
  }
  const visible = compact ? rounds.slice(0, 3) : rounds;
  return (
    <div className="round-history">
      {visible.map((round) => (
        <article className="round-row" key={round.id.toString()}>
          <div className="round-row-number">
            <span>ROUND</span>
            <strong>{round.id.toString().padStart(2, "0")}</strong>
          </div>
          <div>
            <span>STATE</span>
            <strong data-state={round.status}>{round.status}</strong>
          </div>
          <div>
            <span>{round.status === "FINALIZED" ? "WINNER" : "RESULT"}</span>
            {round.winner ? (
              <a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">
                {shortAddress(round.winner)} ↗
              </a>
            ) : (
              <strong>{round.status === "CANCELLED" ? "KMS-PROVEN ZERO" : "INSUFFICIENT PARTICIPANTS"}</strong>
            )}
          </div>
          <div>
            <span>PARTICIPANTS</span>
            <strong>{round.participantCount}</strong>
          </div>
          <div>
            <span>SNAPSHOT BLOCK</span>
            <strong>{round.snapshotBlock.toString()}</strong>
          </div>
          <div>
            <span>PRIZE</span>
            <strong>{prizeLabel(round)}</strong>
            <button
              className="verification-replay-button"
              onClick={() => setReplay({ id: round.id, token: (replay?.token ?? 0) + 1 })}
            >
              {round.status === "SKIPPED" ? "VIEW VERIFIED SKIP" : "REPLAY VERIFICATION"}
            </button>
          </div>
          {replay?.id === round.id && (
            <div
              className={`verification-replay verification-replay--${round.status.toLowerCase()}`}
              key={`${round.id}-${replay.token}`}
            >
              <span>
                {round.status === "SKIPPED" ? "VERIFIED ONCHAIN LIFECYCLE" : "VISUAL REPLAY OF VERIFIED ONCHAIN RESULT"}
              </span>
              <div className="verification-steps" aria-label={`${round.status} round verification path`}>
                {(round.status === "SKIPPED"
                  ? ["SCHEDULE CLOSE", "INSUFFICIENT", "SKIPPED"]
                  : round.status === "CANCELLED"
                    ? ["SNAPSHOT", "BLIND DRAW", "KMS ZERO", "CANCELLED"]
                    : [
                        "SNAPSHOT",
                        "BLIND DRAW",
                        "KMS PROOF",
                        "FINALIZED",
                        round.processedPrize ? "PRIZE DELIVERED" : "PRIZE PROCESSING",
                      ]
                ).map((step, index) => (
                  <i style={{ "--proof-index": index } as CSSProperties} key={step}>
                    {step}
                  </i>
                ))}
              </div>
              <strong className="verification-outcome">
                {round.status === "SKIPPED" ? (
                  "NO DRAW EXECUTED · INSUFFICIENT PARTICIPANTS"
                ) : round.status === "CANCELLED" ? (
                  "KMS-PROVEN ZERO WINNER · ROUND CANCELLED"
                ) : (
                  <>
                    VERIFIED WINNER · <code>{round.winner}</code>
                  </>
                )}
              </strong>
              <small>SNAPSHOT BLOCK {round.snapshotBlock.toString()}</small>
            </div>
          )}
        </article>
      ))}
      {showExplorerLink && (
        <a className="text-link" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          VERIFY ALL POOL STATE ON ETHERSCAN ↗
        </a>
      )}
    </div>
  );
}
