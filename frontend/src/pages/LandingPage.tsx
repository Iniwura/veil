import { BrandMark } from "../components/BrandMark";
import { DemoBadge } from "../components/DemoBadge";
import { DrawCountdown } from "../components/DrawCountdown";
import { EncryptedMatterArtwork } from "../components/EncryptedMatterArtwork";
import { EncryptedPositionPreview } from "../components/EncryptedPositionPreview";
import { RouteLink } from "../components/RouteLink";
import { RoundHistory } from "../components/RoundHistory";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import { useRevealOnScroll } from "../hooks/useMotion";
import { LandingProgress } from "../components/LandingProgress";
import { ProtocolTicker } from "../components/ProtocolTicker";
import { drawStateLabel, explorerAddress, formatDate } from "../lib/format";

export function LandingPage({ unveil }: { unveil: UnveilController }) {
  useRevealOnScroll();
  const schedule = unveil.schedule;
  const publicParticipants = unveil.dashboard?.playerCount ?? unveil.publicProtocol?.playerCount;
  const publicState = unveil.publicError
    ? unveil.publicProtocol
      ? "STALE"
      : "UNAVAILABLE"
    : schedule
      ? "LIVE"
      : "LOADING";
  return (
    <main className="landing-page">
      <LandingProgress />
      <header className="landing-nav">
        <RouteLink className="wordmark" to="/" dataCursor="enter">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </RouteLink>
        <nav aria-label="Landing navigation">
          <a href="#product">Product</a>
          <a href="#privacy-intro" data-cursor="verify">
            Privacy
          </a>
          <a href="#live">Live</a>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="landing-nav-actions">
          <span className="landing-nav-status">
            <i /> SEPOLIA LIVE
          </span>
          <RouteLink className="button-primary button-small" to="/app" dataCursor="enter">
            Launch app
          </RouteLink>
        </div>
      </header>

      <section className="landing-hero" id="product">
        <div className="hero-annotation hero-annotation--top" aria-hidden="true">
          <span>ENCRYPTED PRINCIPAL</span>
          <span>PUBLIC PROOF</span>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">PRIVATE PRIZE SAVINGS · ZAMA FHE</p>
          <h1 className="hero-title" aria-label="SAVE PRIVATELY. WIN VERIFIABLY.">
            <span className="hero-word hero-word--save" aria-hidden="true">
              SAVE
            </span>
            <span className="hero-word hero-word--privately" aria-hidden="true">
              PRIVATELY.
            </span>
            <span className="hero-word hero-word--win" aria-hidden="true">
              WIN
            </span>
            <span className="hero-word hero-word--verifiably" aria-hidden="true">
              VERIFIABLY.
            </span>
          </h1>
          <p className="hero-lede" data-native-cursor>
            Save into an encrypted position. Stay eligible for verifiable prize draws without publishing your balance.
          </p>
          <div className="hero-actions">
            <RouteLink className="button-primary" to="/app" dataCursor="enter">
              Launch app <span>↗</span>
            </RouteLink>
            <a className="button-text" href="#privacy-intro" data-cursor="verify">
              See how it works <span>↓</span>
            </a>
          </div>
          <p className="campaign">Nothing to see. Everything to verify.</p>
        </div>
        <div className="hero-art-direction">
          <EncryptedPositionPreview
            roundId={schedule?.currentRoundId}
            state={schedule ? drawStateLabel(schedule) : undefined}
            participants={publicParticipants}
            publicState={publicState}
          />
          <div className="hero-art-caption" aria-hidden="true">
            <span>02 / PRIVATE POSITION</span>
            <span>SEALED BY DESIGN</span>
          </div>
        </div>
        <div className="hero-annotation hero-annotation--bottom" aria-hidden="true">
          <span>FHE / 01</span>
          <span>VERIFICATION BOUNDARY</span>
        </div>
        <div className="hero-proof-details" aria-hidden="true">
          <span>FHE</span>
          <span>SEALED</span>
          <span>PROOF</span>
        </div>
      </section>

      <ProtocolTicker />

      <section className="privacy-boundary" id="privacy" data-reveal>
        <span id="privacy-intro" className="privacy-intro-anchor" aria-hidden="true" />
        <div className="privacy-story">
          <div className="privacy-matter" aria-hidden="true">
            <EncryptedMatterArtwork idPrefix="privacy-matter" variant="privacy" />
          </div>
          <div className="privacy-boundary-heading">
            <p className="eyebrow">PRIVACY BOUNDARY</p>
            <h2>What the protocol reveals.</h2>
            <p data-native-cursor>Verification stays public while individual financial state stays encrypted.</p>
          </div>
          <div className="privacy-ledger">
            <div className="privacy-ledger-column" data-cursor="verify">
              <span className="privacy-ledger-label">PUBLIC</span>
              <ul>
                <li>Round timing</li>
                <li>Participant addresses</li>
                <li>Draw lifecycle</li>
                <li>Finalized winner</li>
                <li>Proof and lifecycle events</li>
              </ul>
            </div>
            <div className="privacy-ledger-column privacy-ledger-column--private" data-cursor="sealed">
              <span className="privacy-ledger-label">PRIVATE</span>
              <ul>
                <li>Deposit amount</li>
                <li>Active principal</li>
                <li>Withdrawal amount</li>
                <li>Draw weight</li>
                <li>Prize amount</li>
              </ul>
            </div>
          </div>
          <p className="privacy-boundary-note" data-native-cursor>
            UNVEIL does not provide address or transaction anonymity. Participant count is public, but it is not a
            denominator for exact weighted odds.
          </p>
          <div className="privacy-editorial" aria-hidden="true">
            <span>THE PROOF</span>
            <strong>REMAINS.</strong>
            <span>THE POSITION</span>
            <strong>DOESN&apos;T.</strong>
          </div>
        </div>
      </section>

      <section className="live-proof-section" id="live" data-reveal>
        <div className="live-status-band" aria-label="Current public Sepolia status">
          <span>
            <i /> {schedule ? "SEPOLIA LIVE" : `SEPOLIA ${publicState}`}
          </span>
          <span>ROUND {schedule?.currentRoundId?.toString().padStart(2, "0") ?? "—"}</span>
          <span>PARTICIPANTS {publicParticipants ?? "—"}</span>
          <span>FINALIZATION {schedule?.ready ? "READY" : "PENDING"}</span>
        </div>
        <div className="live-proof-head">
          <div className="live-proof-intro">
            <p className="eyebrow">PUBLIC PROOF</p>
            <h2>Live on Sepolia.</h2>
            <p data-native-cursor>Current public state, read directly from the deployed V2 contracts.</p>
          </div>
          <div className="live-round-anchor" aria-hidden="true">
            <span>ROUND</span>
            <strong>{schedule?.currentRoundId?.toString().padStart(2, "0") ?? "—"}</strong>
          </div>
          <DrawCountdown
            closesAt={schedule?.closesAt}
            timeReady={schedule?.timeReady}
            ready={schedule?.ready}
            insufficientParticipants={schedule?.insufficientParticipants}
          />
        </div>
        <div className="live-metrics">
          <div>
            <span>STATE</span>
            <strong>{drawStateLabel(schedule)}</strong>
          </div>
          <div>
            <span>PARTICIPANTS</span>
            <strong>{unveil.publicProtocol?.playerCount ?? "—"}</strong>
          </div>
          <div>
            <span>SCHEDULED CLOSE</span>
            <strong>{formatDate(schedule?.closesAt)}</strong>
          </div>
          <div>
            <span>UNSETTLED</span>
            <strong>{schedule?.unsettledRounds.toString() ?? "—"}</strong>
          </div>
        </div>
        <RoundHistory rounds={unveil.history} compact />
        <a
          className="text-link"
          data-cursor="verify"
          href={explorerAddress(UNVEIL_CONTRACTS.pool)}
          target="_blank"
          rel="noreferrer"
        >
          VERIFY V2 POOL ↗
        </a>
      </section>

      <section className="final-cta" data-reveal>
        <div className="final-cta-copy">
          <p className="eyebrow">TEST/DEMO · ZAMA FHE</p>
          <h2>
            <span>Private savings.</span>
            <strong>Public proof.</strong>
          </h2>
          <p>SAVE WITHOUT SHOWING YOUR BALANCE.</p>
          <RouteLink className="button-primary" to="/app" dataCursor="enter">
            Launch UNVEIL <span>↗</span>
          </RouteLink>
        </div>
        <div className="final-cta-matter" aria-hidden="true">
          <EncryptedMatterArtwork idPrefix="final-matter" variant="cta" />
        </div>
      </section>
      <footer className="landing-footer">
        <div className="wordmark">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </div>
        <p>Private prize savings powered by Zama FHE.</p>
        <DemoBadge />
        <div>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
            Sepolia
          </a>
        </div>
      </footer>
    </main>
  );
}
