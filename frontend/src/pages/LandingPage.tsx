import { useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { DemoBadge } from "../components/DemoBadge";
import { DrawCountdown } from "../components/DrawCountdown";
import { EncryptedDrawField, type EncryptedDrawFieldState } from "../components/EncryptedDrawField";
import { RouteLink } from "../components/RouteLink";
import { RoundHistory } from "../components/RoundHistory";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilController } from "../hooks/useUnveil";
import { useRevealOnScroll } from "../hooks/useMotion";
import { drawStateLabel, explorerAddress, formatDate } from "../lib/format";

const STORY = [
  ["PRIVATE DEPOSIT", "••••••", "Only the wallet can unveil the deposited amount."],
  ["ENCRYPTED DRAW WEIGHT", "████████", "FHE preserves weighted selection without plaintext balances."],
  ["BLIND DRAW", "VERIFIABLE", "The lifecycle and KMS-backed outcome remain publicly auditable."],
  ["CONFIDENTIAL PRIZE", "••••••", "Processed TEST strategy shares are visible only to the winner."],
] as const;

export function LandingPage({ unveil }: { unveil: UnveilController }) {
  useRevealOnScroll();
  const [storyStep, setStoryStep] = useState(0);
  const schedule = unveil.schedule;
  const drawFieldState: EncryptedDrawFieldState = schedule?.insufficientParticipants
    ? "INSUFFICIENT"
    : schedule?.overdue
      ? "OVERDUE"
      : schedule?.ready || schedule?.timeReady
        ? "READY"
        : "OPEN";
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="wordmark" href="/" aria-label="UNVEIL home">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="#security">Security</a>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">
            Docs
          </a>
        </nav>
        <RouteLink className="button-primary button-small" to="/app">
          Launch app
        </RouteLink>
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
            Your balance stays encrypted.
            <br />
            Your draw stays verifiable.
            <br />
            Your prize is unveiled only to you.
          </p>
          <div className="hero-actions">
            <RouteLink className="button-primary" to="/app">
              Launch app <span>↗</span>
            </RouteLink>
            <a className="button-text" href="#how">
              See how it works <span>↓</span>
            </a>
          </div>
          <p className="campaign">Nothing to see. Everything to verify.</p>
        </div>
        <div className="protocol-visual" id="how">
          <div className="protocol-visual-head">
            <span>PUBLIC LIFECYCLE</span>
            <span>PRIVATE VALUES</span>
          </div>
          <EncryptedDrawField
            compact
            roundId={schedule?.currentRoundId}
            participantCount={unveil.publicProtocol?.playerCount}
            state={drawFieldState}
          />
          <div className="protocol-selector" role="tablist" aria-label="Protocol story">
            {STORY.map((item, index) => (
              <button
                role="tab"
                aria-selected={storyStep === index}
                className={storyStep === index ? "active" : ""}
                onClick={() => setStoryStep(index)}
                key={item[0]}
              >
                <span>0{index + 1}</span>
                {item[0]}
              </button>
            ))}
          </div>
          <div className="protocol-focus protocol-focus--unveil" key={storyStep}>
            <span>0{storyStep + 1}</span>
            <div>
              <small>{STORY[storyStep][0]}</small>
              <strong>{STORY[storyStep][1]}</strong>
              <p>{STORY[storyStep][2]}</p>
            </div>
            <i>
              {storyStep === 0
                ? "WALLET ONLY"
                : storyStep === 1
                  ? "FHE SEALED"
                  : storyStep === 2
                    ? "PERMISSIONLESS"
                    : "WINNER ONLY"}
            </i>
          </div>
          <div className="protocol-wire" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>

      <div className="trust-strip" data-reveal>
        <span>ZAMA FHE</span>
        <span>SEPOLIA V2 LIVE</span>
        <span>AUTONOMOUS BLIND DRAW</span>
        <span>CONFIDENTIAL PRIZES</span>
        <DemoBadge />
      </div>

      <section className="editorial-section problem-section" id="privacy" data-reveal>
        <div>
          <p className="eyebrow">THE PRIVACY PROBLEM</p>
          <h2>SAVING SHOULDN'T PUBLISH YOUR FINANCIAL POSITION.</h2>
        </div>
        <div className="editorial-copy">
          <p>
            Transparent prize savings makes verification easy by exposing financial state. UNVEIL separates those
            concerns.
          </p>
          <p>
            Addresses and lifecycle metadata remain public. Individual deposits, balances, withdrawals, weights, and
            prizes remain encrypted.
          </p>
        </div>
      </section>

      <section className="numbered-process" data-reveal>
        {[
          ["01", "SAVE", "TEST token becomes confidential principal before an encrypted pool deposit."],
          ["02", "ENTER", "An active seat makes the encrypted balance eligible for the scheduled draw."],
          ["03", "DRAW", "Permissionless BlindDraw selects against immutable encrypted weights."],
          ["04", "VERIFY", "Zama/KMS proof validation makes the winner public without publishing weights."],
          ["05", "RECEIVE", "Processed TEST strategy-share prizes arrive automatically and stay confidential."],
        ].map(([number, title, copy]) => (
          <article key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="comparison-section" data-reveal>
        <div className="comparison-head">
          <p className="eyebrow">VISIBLE BY DESIGN</p>
          <h2>
            PUBLICLY VERIFIABLE.
            <br />
            PRIVATELY HIDDEN.
          </h2>
        </div>
        <div className="comparison-grid">
          <div>
            <span>PUBLIC</span>
            {["Round timing", "Participant addresses", "Draw state", "Final winner", "Proof and lifecycle"].map(
              (item) => (
                <p key={item}>
                  {item}
                  <i>VISIBLE</i>
                </p>
              ),
            )}
          </div>
          <div className="comparison-private">
            <span>PRIVATE</span>
            {["Deposit amount", "Current balance", "Withdrawal amount", "Draw weight", "Prize amount"].map((item) => (
              <p key={item}>
                {item}
                <i>ENCRYPTED</i>
              </p>
            ))}
          </div>
        </div>
        <p className="comparison-note">
          UNVEIL provides verifiability without making individual financial state public. It does not claim address or
          transaction anonymity.
        </p>
      </section>

      <section className="live-proof-section" data-reveal>
        <div className="live-proof-head">
          <div>
            <p className="eyebrow">CURRENT DRAW · LIVE SEPOLIA</p>
            <h2>ROUND {schedule?.currentRoundId.toString().padStart(2, "0") ?? "—"}</h2>
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

      <section className="security-section" id="security" data-reveal>
        <div>
          <p className="eyebrow">SECURITY + ARCHITECTURE</p>
          <h2>ENCRYPTION IS THE PRODUCT BOUNDARY.</h2>
        </div>
        <div className="security-grid">
          <article>
            <span>01</span>
            <h3>WALLET-SCOPED REVEAL</h3>
            <p>Your authorized ciphertexts are decrypted after a wallet signature. Values are never auto-revealed.</p>
          </article>
          <article>
            <span>02</span>
            <h3>FIXED SCHEDULE</h3>
            <p>Draw timing derives from the contract anchor. Delayed settlement cannot move future windows.</p>
          </article>
          <article>
            <span>03</span>
            <h3>PROOF-GATED WINNER</h3>
            <p>Finalization accepts only the valid public decryption proof for the encrypted winner.</p>
          </article>
          <article>
            <span>04</span>
            <h3>SEPARATE CUSTODY</h3>
            <p>Principal liability, strategy shares, withdrawal reservations, and prizes remain distinct.</p>
          </article>
        </div>
      </section>

      <section className="faq-section" data-reveal>
        <p className="eyebrow">FAQ</p>
        <h2>THE IMPORTANT DETAILS.</h2>
        <details>
          <summary>Can anyone see my balance?</summary>
          <p>
            No. Your active and reserved principal are encrypted and revealed only through your wallet-authorized
            decryption.
          </p>
        </details>
        <details>
          <summary>Can I calculate my exact odds?</summary>
          <p>
            No. V2 does not grant participants decryption permission for aggregate snapshot weight. Participant count is
            not a valid denominator for a weighted draw.
          </p>
        </details>
        <details>
          <summary>Do winners claim prizes?</summary>
          <p>
            No. V2 prize processing delivers confidential TEST strategy shares automatically. The winner only chooses
            whether to reveal the amount locally.
          </p>
        </details>
        <details>
          <summary>Is this production yield?</summary>
          <p>
            No. The Sepolia deployment is TEST/DEMO infrastructure using a simulated ERC4626 strategy—not USDC, cUSDC,
            csteakcUSDC, Steakhouse, Morpho, or production market yield.
          </p>
        </details>
      </section>

      <section className="final-cta" data-reveal>
        <BrandMark />
        <p className="eyebrow">ENCRYPTED TO EVERYONE. UNVEILED ONLY TO YOU.</p>
        <h2>
          START SAVING
          <br />
          WITHOUT SHOWING.
        </h2>
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
