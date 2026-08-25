import { RoundHistory } from "../components/RoundHistory";
import type { UnveilController } from "../hooks/useUnveil";

export function HistoryPage({ unveil }: { unveil: UnveilController }) {
  return (
    <div className="page-stack route-enter">
      <header className="page-heading">
        <span className="eyebrow">ONCHAIN VERIFIED</span>
        <h1>DRAW HISTORY.</h1>
        <p>
          Finalized winners, KMS-proven zero-weight cancellations, and insufficient-participant skipped rounds remain
          conceptually distinct.
        </p>
      </header>
      <RoundHistory rounds={unveil.history} />
    </div>
  );
}
