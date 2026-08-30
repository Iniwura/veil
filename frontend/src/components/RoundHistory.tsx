import { useState } from "react";
import type { CSSProperties } from "react";
import { UNVEIL_CONTRACTS } from "../contracts";
import { explorerAddress, shortAddress } from "../lib/format";
import type { VerifiedRoundV4 } from "../v4DrawClient";

function prizeLabel(round: VerifiedRoundV4) {
  if (round.status === "CANCELLED") return "NO PRIZE · ROUND CANCELLED";
  if (round.status === "SKIPPED") return "NO PRIZE · ROUND SKIPPED";
  const delivered = round.prizes.filter((prize) => prize.delivered).length;
  return delivered === round.prizes.length ? "3 / 3 DELIVERED" : `${delivered} / 3 DELIVERED`;
}

function finalizedWinnerLinks(round: VerifiedRoundV4) {
  return round.prizes.map((prize, index) => (
    <span key={`${round.id}-${prize.index}`}>
      {index > 0 ? " · " : ""}
      {prize.winner ? (
        <a href={explorerAddress(prize.winner)} target="_blank" rel="noreferrer" data-cursor="verify">
          P{prize.index + 1} · S{prize.shard} · {shortAddress(prize.winner)} ↗
        </a>
      ) : (
        <>P{prize.index + 1} · ZERO</>
      )}
    </span>
  ));
}

export function RoundHistory({
  rounds,
  compact = false,
  showExplorerLink = !compact,
}: {
  rounds: VerifiedRoundV4[];
  compact?: boolean;
  showExplorerLink?: boolean;
}) {
  const [replay, setReplay] = useState<{ id: bigint; token: number }>();
  if (rounds.length === 0) {
    return (
      <div className="empty-state">
        <span>NO SETTLED ROUNDS LOADED</span>
        <p>Verified V4 results will appear after a round is finalized, cancelled, or skipped.</p>
      </div>
    );
  }
  const visible = compact ? rounds.slice(0, 3) : rounds;
  return (
    <div className={`round-history ${compact ? "round-history--compact" : "round-history--full"}`}>
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
            <span>{round.status === "FINALIZED" ? "3 PRIZE SLOTS" : "RESULT"}</span>
            {round.status === "FINALIZED" ? (
              <strong>{finalizedWinnerLinks(round)}</strong>
            ) : (
              <strong>{round.status === "CANCELLED" ? "KMS-PROVEN ZERO ×3" : "INSUFFICIENT MATURE SEATS"}</strong>
            )}
          </div>
          <div>
            <span>ROUND PARTICIPANTS</span>
            <strong>{round.participantCount}</strong>
          </div>
          <div>
            <span>SNAPSHOT BLOCK</span>
            <strong>{round.snapshotBlock.toString()}</strong>
          </div>
          <div>
            <span>PRIZES</span>
            <strong>{prizeLabel(round)}</strong>
            <button
              className="verification-replay-button"
              type="button"
              data-cursor="verify"
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
                {round.status === "SKIPPED" ? "VERIFIED V4 LIFECYCLE" : "VISUAL REPLAY OF VERIFIED V4 ONCHAIN RESULT"}
              </span>
              <div className="verification-steps" aria-label={`${round.status} V4 round verification path`}>
                {(round.status === "SKIPPED"
                  ? ["SHARDED SNAPSHOT", "<2 MATURE SEATS", "SKIPPED"]
                  : round.status === "CANCELLED"
                    ? ["SHARDED SNAPSHOT", "SHARD + MEMBER DRAWS", "KMS ZERO ×3", "CANCELLED"]
                    : [
                        "SHARDED SNAPSHOT",
                        "SHARD DRAW ×3",
                        "KMS SHARD PROOFS",
                        "MEMBER DRAW ×3",
                        "KMS WINNER PROOFS",
                        "FINALIZED",
                        round.processedPrize ? "3 PRIZES DELIVERED" : "PRIZE DELIVERY IN PROGRESS",
                      ]
                ).map((step, index) => (
                  <i style={{ "--proof-index": index } as CSSProperties} key={step}>
                    {step}
                  </i>
                ))}
              </div>
              <strong className="verification-outcome">
                {round.status === "SKIPPED" ? (
                  "NO DRAW EXECUTED · FEWER THAN TWO MATURE SEATS"
                ) : round.status === "CANCELLED" ? (
                  "THREE KMS-PROVEN ZERO WINNERS · ROUND CANCELLED"
                ) : (
                  <>THREE INDEPENDENT V4 PRIZE SLOTS · {finalizedWinnerLinks(round)}</>
                )}
              </strong>
              <small>SNAPSHOT BLOCK {round.snapshotBlock.toString()}</small>
            </div>
          )}
        </article>
      ))}
      {showExplorerLink && (
        <a
          className="text-link"
          href={explorerAddress(UNVEIL_CONTRACTS.pool)}
          target="_blank"
          rel="noreferrer"
          data-cursor="verify"
        >
          VERIFY ALL V4 POOL STATE ON ETHERSCAN ↗
        </a>
      )}
    </div>
  );
}
