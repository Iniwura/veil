import { useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { DemoBadge } from "../components/DemoBadge";
import { DrawCountdown } from "../components/DrawCountdown";
import { LandingProgress } from "../components/LandingProgress";
import { ProtocolTicker } from "../components/ProtocolTicker";
import { RouteLink } from "../components/RouteLink";
import { RoundHistory } from "../components/RoundHistory";
import { UNVEIL_CONTRACTS } from "../contracts";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import { useRevealOnScroll } from "../hooks/useMotion";
import { drawStateLabel, explorerAddress, formatDate } from "../lib/format";

function LandingVaultVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`landing-vault-visual${compact ? " landing-vault-visual--compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 520 520" focusable="false">
        <g className="landing-vault-frame" fill="none">
          <rect x="34" y="34" width="452" height="452" />
          <rect x="52" y="52" width="416" height="416" />
          <rect x="70" y="70" width="380" height="380" />
          <path d="M70 168h112M338 168h112M70 352h112M338 352h112" />
          <path d="M52 128h18M52 128V96M468 392h-18M468 392v32" />
        </g>
        <rect className="landing-vault-inner-panel" x="88" y="88" width="344" height="344" fill="none" />
        <g className="landing-vault-hinges" fill="none">
          <rect x="20" y="188" width="18" height="62" />
          <circle cx="20" cy="219" r="7" />
          <rect x="20" y="270" width="18" height="62" />
          <circle cx="20" cy="301" r="7" />
        </g>
        <g className="safe-lock-position" transform="translate(260 260)" fill="none">
          <g className="safe-lock-rotor landing-vault-dial">
            <circle r="174" />
            <circle r="157" />
            <circle r="124" />
            <circle r="84" />
            <circle r="31" />
            <g className="landing-vault-ticks">
              {Array.from({ length: 12 }, (_, index) => (
                <path key={index} d="M0-164v15" transform={`rotate(${index * 30})`} />
              ))}
            </g>
            <g className="landing-vault-spokes">
              {Array.from({ length: 8 }, (_, index) => (
                <path key={index} d="M0-30L0-122" transform={`rotate(${index * 45})`} />
              ))}
            </g>
            <circle r="10" />
            <path d="M-9 0h18M0-9v18" />
          </g>
        </g>
        <path className="landing-vault-latch" d="M422 224h24v72h-24" fill="none" />
        <circle className="landing-vault-indicator" cx="416" cy="260" r="4" />
        <path className="landing-vault-seam" d="M260 86a174 174 0 0 1 150 86" />
      </svg>
    </div>
  );
}

function LandingRotorVisual() {
  return (
    <div className="landing-rotor-visual" aria-hidden="true">
      <svg viewBox="0 0 560 560" focusable="false">
        <circle className="landing-rotor-outer" cx="280" cy="280" r="240" />
        <circle className="landing-rotor-inner" cx="280" cy="280" r="192" />
        <g className="landing-rotor-sectors">
          {Array.from({ length: 24 }, (_, index) => (
            <path key={index} d="M280 40v82" transform={`rotate(${index * 15} 280 280)`} />
          ))}
        </g>
        <g className="landing-rotor-spokes">
          {Array.from({ length: 6 }, (_, index) => (
            <path key={index} d="M280 112v54" transform={`rotate(${index * 60} 280 280)`} />
          ))}
        </g>
        <circle className="landing-rotor-hub" cx="280" cy="280" r="48" />
        <circle className="landing-rotor-core" cx="280" cy="280" r="22" />
        <path className="landing-rotor-seam" d="M280 26v66" />
      </svg>
    </div>
  );
}

function LandingPresentVisual() {
  return (
    <div className="landing-present-visual" aria-hidden="true">
      <svg viewBox="0 0 420 360" focusable="false">
        <path className="landing-present-shadow" d="M86 122h248v176H86z" />
        <rect className="landing-present-box" x="72" y="104" width="276" height="192" />
        <path className="landing-present-lid" d="M60 82h300v54H60z" />
        <path className="landing-present-ribbon" d="M210 82v214M72 206h276" />
        <path className="landing-present-bow" d="M210 82c-44-56-93-42-93-13 0 28 47 35 93 13Zm0 0c44-56 93-42 93-13 0 28-47 35-93 13Z" />
        <path className="landing-present-seam" d="M74 104h272" />
        <path className="landing-present-interior" d="M76 136h268" />
      </svg>
    </div>
  );
}

export function LandingPage({ unveil }: { unveil: UnveilV4Controller }) {
  useRevealOnScroll();
  const [heroEngaged, setHeroEngaged] = useState(false);
  const schedule = unveil.schedule;
  const publicParticipants = unveil.dashboard?.playerCount ?? unveil.publicProtocol?.playerCount;
  const publicState = unveil.publicError
    ? unveil.publicProtocol
      ? "STALE"
      : "UNAVAILABLE"
    : schedule
      ? "LIVE"
      : "LOADING";
  const drawLabel = drawStateLabel(schedule);

  return (
    <main className="landing-page landing-page--product">
      <LandingProgress />
      <header className="landing-nav">
        <RouteLink className="wordmark" to="/" dataCursor="enter">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </RouteLink>
        <nav aria-label="Landing navigation">
          <a href="#product">Product</a>
          <a href="#privacy" data-cursor="verify">Privacy</a>
          <a href="#live">Live</a>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div className="landing-nav-actions">
          <span className="landing-nav-status"><i /> PROTOCOL LIVE · SEPOLIA</span>
          <RouteLink className="button-secondary button-small" to="/app" dataCursor="enter">START SAVING →</RouteLink>
        </div>
      </header>

      <section className={`landing-hero${heroEngaged ? " is-engaged" : ""}`} id="product">
        <div className="hero-copy">
          <p className="eyebrow">PRIVATE PRIZE SAVINGS</p>
          <h1 className="hero-title">
            <span>SAVE PRIVATELY.</span>
            <strong>WIN IN PUBLIC.</strong>
          </h1>
          <p className="hero-lede" data-native-cursor>
            Save cUSDC confidentially and participate in publicly verifiable prize draws without publishing your balance.
          </p>
          <div
            className="hero-actions"
            onMouseEnter={() => setHeroEngaged(true)}
            onMouseLeave={() => setHeroEngaged(false)}
            onFocus={() => setHeroEngaged(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeroEngaged(false);
            }}
          >
            <RouteLink className="button-primary" to="/app" dataCursor="enter">START SAVING →</RouteLink>
            <a className="button-text" href="#how" data-cursor="enter">SEE HOW IT WORKS →</a>
          </div>
          <p className="campaign">PRIVATE POSITION · PUBLIC PROOF</p>
        </div>
        <div className="landing-hero-visual" aria-hidden="true">
          <LandingVaultVisual compact />
          <div className="landing-hero-spec"><span>SAVE VAULT</span><strong>SEALED BY DEFAULT</strong></div>
        </div>
      </section>

      <ProtocolTicker />

      <section className="landing-story landing-story--save" id="save-story" data-reveal>
        <div className="landing-story-copy">
          <p className="eyebrow">01 / SAVE VAULT</p>
          <h2>YOUR SAVINGS<br />STAY PRIVATE.</h2>
          <p>Deposit cUSDC into a confidential position. Your balance and mature draw weight remain encrypted.</p>
          <RouteLink className="text-link" to="/app/save" dataCursor="enter">OPEN SAVE →</RouteLink>
        </div>
        <LandingVaultVisual />
        <div className="landing-story-annotation"><span>CONFIDENTIAL PRINCIPAL</span><strong>SEALED</strong></div>
      </section>

      <section className="landing-story landing-story--draw" id="draw-story" data-reveal>
        <div className="landing-story-copy">
          <p className="eyebrow">02 / DRAW MACHINE</p>
          <h2>THE DRAW IS PUBLIC.<br />YOUR BALANCE ISN&apos;T.</h2>
          <p>Round timing, shard membership, settlement and winners are publicly verifiable while individual balances and prize amounts stay sealed.</p>
          <RouteLink className="text-link" to="/app/draw" dataCursor="enter">EXPLORE THE DRAW →</RouteLink>
        </div>
        <LandingRotorVisual />
        <div className="landing-story-annotation"><span>24 SHARDS</span><strong>VERIFIABLE</strong></div>
      </section>

      <section className="landing-story landing-story--win" id="win-story" data-reveal>
        <div className="landing-story-copy">
          <p className="eyebrow">03 / PRIZE PRESENT</p>
          <h2>WIN.<br />OPEN IT YOURSELF.</h2>
          <p>Delivered prizes remain confidential until the winning wallet unveils them.</p>
          <RouteLink className="text-link" to="/app/draw" dataCursor="enter">VIEW VERIFIED DRAWS →</RouteLink>
        </div>
        <LandingPresentVisual />
        <div className="landing-story-annotation"><span>PRIVATE DELIVERY</span><strong>YOUR KEY</strong></div>
      </section>

      <section className="landing-how" id="how" data-reveal>
        <div className="landing-section-intro">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>THREE STEPS.<br />ONE PRIVATE POSITION.</h2>
        </div>
        <div className="landing-how-line">
          {[
            ["01", "SAVE", "Deposit cUSDC into your confidential position."],
            ["02", "DRAW", "Public settlement verifies the prize draw without publishing your balance."],
            ["03", "UNVEIL", "Winning wallets privately reveal delivered prize amounts."],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-boundary" id="privacy" data-reveal>
        <div className="privacy-story">
          <div className="privacy-boundary-heading">
            <p className="eyebrow">PRIVACY BOUNDARY</p>
            <h2>
              <span>VERIFY THE DRAW.</span>
              <em>KEEP THE POSITION.</em>
            </h2>
            <p data-native-cursor>Public proof and private financial state can coexist.</p>
          </div>
          <div className="privacy-ledger privacy-ledger--editorial" aria-label="Public and private protocol visibility">
            <div className="privacy-ledger-head" aria-hidden="true">
              <span />
              <strong>PUBLIC</strong>
              <strong>PRIVATE</strong>
            </div>
            <div className="privacy-ledger-row" data-cursor="verify">
              <span className="privacy-ledger-topic">ROUND</span>
              <span className="privacy-ledger-value privacy-ledger-value--public" data-cursor="verify">Timing + settlement</span>
              <span className="privacy-ledger-value privacy-ledger-value--private" data-cursor="sealed">—</span>
            </div>
            <div className="privacy-ledger-row" data-cursor="verify">
              <span className="privacy-ledger-topic">POSITION</span>
              <span className="privacy-ledger-value privacy-ledger-value--public" data-cursor="verify">Seat / shard membership</span>
              <span className="privacy-ledger-value privacy-ledger-value--private" data-cursor="sealed">Balance + mature weight</span>
            </div>
            <div className="privacy-ledger-row" data-cursor="verify">
              <span className="privacy-ledger-topic">PRIZE</span>
              <span className="privacy-ledger-value privacy-ledger-value--public" data-cursor="verify">Winner / selected shard</span>
              <span className="privacy-ledger-value privacy-ledger-value--private" data-cursor="sealed">Amount</span>
            </div>
          </div>
          <p className="privacy-boundary-note" data-native-cursor>
            UNVEIL does not provide address or transaction anonymity. Exact balances, mature weights, shard totals and weighted odds remain encrypted.
          </p>
        </div>
      </section>

      <section className="live-proof-section" id="live" data-reveal>
        <div className="live-status-band" aria-label="Current public Sepolia status">
          <span><i /> {schedule ? "PROTOCOL LIVE" : `PROTOCOL ${publicState}`}</span>
          <span>SEPOLIA</span>
          <span>ROUND {schedule?.currentRoundId?.toString().padStart(2, "0") ?? "—"}</span>
          <span>24 SHARDS · 3 PRIZES</span>
        </div>
        <div className="live-proof-head">
          <div className="live-proof-intro">
            <p className="eyebrow">PUBLIC PROOF</p>
            <h2>LIVE ON SEPOLIA.</h2>
            <p data-native-cursor>Current public state, read directly from the deployed prize-savings protocol.</p>
          </div>
          <div className="live-round-anchor" aria-hidden="true"><span>ROUND</span><strong>{schedule?.currentRoundId?.toString().padStart(2, "0") ?? "—"}</strong></div>
          <DrawCountdown closesAt={schedule?.closesAt} timeReady={schedule?.timeReady} ready={schedule?.ready} insufficientParticipants={schedule?.insufficientParticipants} />
        </div>
        <div className="live-metrics">
          <div><span>STATE</span><strong>{drawLabel}</strong></div>
          <div><span>ACTIVE SAVERS</span><strong>{publicParticipants ?? "—"} / 576</strong></div>
          <div><span>SCHEDULED CLOSE</span><strong>{formatDate(schedule?.closesAt)}</strong></div>
          <div><span>UNSETTLED</span><strong>{schedule?.unsettledRounds.toString() ?? "—"}</strong></div>
        </div>
        <RoundHistory rounds={unveil.history} compact />
        <a className="text-link" data-cursor="verify" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VERIFY PROTOCOL →</a>
      </section>

      <section className="final-cta" data-reveal>
        <div className="final-cta-copy">
          <p className="eyebrow">PRIVATE PRIZE SAVINGS</p>
          <h2>READY TO SAVE<br /><strong>DIFFERENTLY?</strong></h2>
          <p>Start with cUSDC. Keep your position private.</p>
          <div className="final-cta-actions">
            <RouteLink className="button-primary" to="/app" dataCursor="enter">START WITH cUSDC →</RouteLink>
            <RouteLink className="button-text" to="/app/draw" dataCursor="enter">EXPLORE THE DRAW →</RouteLink>
          </div>
        </div>
        <LandingPresentVisual />
      </section>

      <footer className="landing-footer">
        <div className="wordmark"><BrandMark compact /><strong>UNVEIL</strong></div>
        <p>Private prize savings with public proof.</p>
        <DemoBadge />
        <div>
          <a href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">GitHub</a>
          <a href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">Sepolia</a>
        </div>
      </footer>
    </main>
  );
}
