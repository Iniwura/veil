import { VeilReveal } from "../components/VeilReveal";
import type { UnveilController } from "../hooks/useUnveil";
import { shortAddress } from "../lib/format";

export function PrizesPage({ unveil }: { unveil: UnveilController }) {
  const round = unveil.latestFinalized;
  const status = !round ? "NO PRIZE" : round.processedPrize ? "DELIVERED" : "PROCESSING";
  const latestReveal = round && unveil.prize?.roundId === round.id ? unveil.prize : undefined;
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
        <div className="prize-delivery-flow">
          <div>
            <span>{round ? `ROUND ${round.id.toString().padStart(2, "0")}` : "ROUND —"}</span>
            <strong>{status}</strong>
          </div>
          <i aria-hidden="true">↓</i>
          <VeilReveal
            label="Confidential strategy shares"
            value={latestReveal?.value}
            revealed={Boolean(latestReveal)}
            busy={Boolean(round && unveil.busy === `reveal-prize-${round.id}`)}
            revealedLabel="UNVEILED TO WINNER"
            detail={
              latestReveal
                ? "Delivered before reveal · winner-local display"
                : unveil.connectedWinner && round?.processedPrize
                  ? "Delivered · winner authorized to reveal"
                  : "Delivered amount · winner only"
            }
            unit=" TEST SHARE UNITS"
          />
        </div>
      </section>
      <section className="my-prizes">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MY DELIVERED PRIZES</span>
            <h2>CHOOSE A ROUND TO UNVEIL.</h2>
          </div>
          <p>TEST/DEMO confidential strategy-share units—not csteakcUSDC or production market yield.</p>
        </div>
        {!unveil.connected ? (
          <div className="empty-state">
            <span>WALLET DISCONNECTED</span>
            <p>Connect the winner wallet to find its recent processed prize rounds.</p>
          </div>
        ) : unveil.myDeliveredPrizes.length === 0 ? (
          <div className="empty-state">
            <span>NO DELIVERED PRIZE IN RECENT HISTORY</span>
            <p>This wallet is not the processed winner of a finalized round in the loaded history window.</p>
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
                    {revealing ? "AWAITING WINNER SIGNATURE…" : revealed ? "VEIL PRIZE" : "UNVEIL PRIZE"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
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
