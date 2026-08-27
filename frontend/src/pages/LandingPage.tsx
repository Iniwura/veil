import { BrandMark } from "../components/BrandMark";
import { DemoBadge } from "../components/DemoBadge";
import { DrawCountdown } from "../components/DrawCountdown";
import { EncryptedPositionPreview } from "../components/EncryptedPositionPreview";
import { RouteLink } from "../components/RouteLink";
import { ThemeToggle } from "../components/ThemeToggle";
import { RoundHistory } from "../components/RoundHistory";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import type { ThemeController } from "../hooks/useTheme";
import { useRevealOnScroll } from "../hooks/useMotion";
import { drawStateLabel, explorerAddress, formatDate } from "../lib/format";

export function LandingPage({ unveil, theme }: { unveil: UnveilController; theme: ThemeController }) {
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
      <header className="landing-nav">
        <a className="wordmark" href="/" aria-label="UNVEIL home">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#product">Product</a>
          <a href="#privacy">Privacy</a>
          <a href="#live">Live</a>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="landing-nav-actions">
          <ThemeToggle {...theme} />
          <RouteLink className="button-primary button-small" to="/app">
            Launch app
          </RouteLink>
        </div>
      </header>

      <section className="landing-hero" id="product">
        <div className="hero-copy">
          <p className="eyebrow">PRIVATE PRIZE SAVINGS · ZAMA FHE</p>
          <h1>
            SAVE PRIVATELY.
            <br />
            <em>WIN VERIFIABLY.</em>
          </h1>
          <p className="hero-lede">
            Save into an encrypted position, participate in verifiable weighted draws, and receive confidential prizes
            without publishing your balance.
          </p>
          <div className="hero-actions">
            <RouteLink className="button-primary" to="/app">
              Launch app <span>↗</span>
            </RouteLink>
            <a className="button-text" href="#privacy">
              See how it works <span>↓</span>
            </a>
          </div>
          <p className="campaign">Nothing to see. Everything to verify.</p>
        </div>
        <EncryptedPositionPreview
          roundId={schedule?.currentRoundId}
          state={schedule ? drawStateLabel(schedule) : undefined}
          participants={publicParticipants}
          publicState={publicState}
        />
      </section>

      <section className="privacy-boundary" id="privacy" data-reveal>
        <div className="privacy-boundary-heading">
          <p className="eyebrow">PRIVACY BOUNDARY</p>
          <h2>What the protocol reveals.</h2>
          <p>Verification stays public while individual financial state stays encrypted.</p>
        </div>
        <div className="privacy-ledger">
          <div className="privacy-ledger-column">
            <span className="privacy-ledger-label">PUBLIC</span>
            <ul>
              <li>Round timing</li>
              <li>Participant addresses</li>
              <li>Draw lifecycle</li>
              <li>Finalized winner</li>
              <li>Proof and lifecycle events</li>
            </ul>
          </div>
          <div className="privacy-ledger-column privacy-ledger-column--private">
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
        <p className="privacy-boundary-note">
          UNVEIL does not provide address or transaction anonymity. Participant count is public, but it is not a
          denominator for exact weighted odds.
        </p>
      </section>

      <section className="live-proof-section" id="live" data-reveal>
        <div className="live-proof-head">
          <div>
            <p className="eyebrow">PUBLIC PROOF</p>
            <h2>Live on Sepolia.</h2>
            <p>Current public state, read directly from the deployed V2 contracts.</p>
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
        <a className="text-link" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          VERIFY V2 POOL ↗
        </a>
      </section>

      <section className="final-cta" data-reveal>
        <p className="eyebrow">TEST/DEMO · ZAMA FHE</p>
        <h2>Private savings. Public proof.</h2>
        <RouteLink className="button-primary" to="/app/save">
          Launch UNVEIL <span>↗</span>
        </RouteLink>
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
