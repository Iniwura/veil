import type { UnveilController } from "../hooks/useUnveil";
import { shortAddress } from "../lib/format";

export function PrizesPage({ unveil }: { unveil: UnveilController }) {
  const round = unveil.latestFinalized;
  const status = !round ? "NO PRIZE" : round.processedPrize ? "DELIVERED" : "PROCESSING";
  return (
    <div className="page-stack route-enter">
      <header className="page-heading">
        <span className="eyebrow">PRIZES</span>
        <h1>
          DELIVERED.
          <br />
          STILL CONFIDENTIAL.
        </h1>
        <p>V2 prizes transfer automatically during processing. There is no authorize, claim, or claimable state.</p>
      </header>
      <section className={`prize-hero ${unveil.connectedWinner ? "prize-hero--winner" : ""}`}>
        <div>
          <span className="eyebrow">LATEST FINALIZED ROUND</span>
          <strong className="prize-round">{round ? `ROUND ${round.id}` : "—"}</strong>
          <h2>{status}</h2>
          <p>{round?.winner ? `Finalized winner ${shortAddress(round.winner)}` : "No finalized winner is loaded."}</p>
        </div>
        <div className="prize-private">
          <span>CONFIDENTIAL TEST STRATEGY SHARES</span>
          <strong>{unveil.prize ? unveil.prize.value.toString() : "••••••"}</strong>
          <small>
            {unveil.prize
              ? "UNVEILED LOCALLY"
              : unveil.connectedWinner && round?.processedPrize
                ? "WINNER AUTHORIZED TO REVEAL"
                : "WINNER ONLY"}
          </small>
        </div>
      </section>
      {unveil.connectedWinner && round?.processedPrize ? (
        <div className="prize-actions">
          <button
            className="button-primary"
            disabled={Boolean(unveil.busy)}
            onClick={unveil.prize ? unveil.hidePrize : unveil.revealLatestPrize}
          >
            {unveil.busy === "reveal-prize"
              ? "AWAITING WINNER SIGNATURE…"
              : unveil.prize
                ? "VEIL MY PRIZE"
                : "REVEAL MY PRIZE"}
          </button>
          <p>These are TEST/DEMO confidential strategy-share units—not csteakcUSDC or production market yield.</p>
        </div>
      ) : (
        <div className="notice">
          <strong>{round?.processedPrize ? "CONNECTED WALLET IS NOT THE WINNER" : status}</strong>
          <p>
            {round?.processedPrize
              ? "Only the finalized winner can decrypt the delivered amount."
              : "Prize processing advances in finalized-round order."}
          </p>
        </div>
      )}
      <section className="explain-grid">
        <article>
          <span>AUTOMATIC DELIVERY</span>
          <h3>NO CLAIM TRANSACTION.</h3>
          <p>The strategy manager sends safe encrypted surplus through the prize vault directly to the winner.</p>
        </article>
        <article>
          <span>WINNER-ONLY ACL</span>
          <h3>PUBLIC WINNER. PRIVATE AMOUNT.</h3>
          <p>The winner address is verifiable while the delivered strategy-share amount remains confidential.</p>
        </article>
      </section>
    </div>
  );
}
