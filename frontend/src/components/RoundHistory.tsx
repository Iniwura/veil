import { UNVEIL_CONTRACTS } from "../contracts";
import { explorerAddress, shortAddress } from "../lib/format";
import type { VerifiedRound } from "../veilClient";

function prizeLabel(round: VerifiedRound) {
  if (round.status === "CANCELLED") return "NO PRIZE · ROUND CANCELLED";
  if (round.status === "SKIPPED") return "NO PRIZE · ROUND SKIPPED";
  return round.processedPrize ? "DELIVERED" : "PROCESSING";
}

export function RoundHistory({ rounds, compact = false }: { rounds: VerifiedRound[]; compact?: boolean }) {
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
          </div>
        </article>
      ))}
      {!compact && (
        <a className="text-link" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          VERIFY ALL POOL STATE ON ETHERSCAN ↗
        </a>
      )}
    </div>
  );
}
