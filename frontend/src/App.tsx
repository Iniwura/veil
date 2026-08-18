import { useMemo, useState } from "react";
import { VEIL_CONTRACTS } from "./contracts";

type View = "landing" | "app";

const notifications = [
  ["Deposit sealed", "Your private deposit was confirmed."],
  ["Round snapshot complete", "Your encrypted position is included."],
  ["Winner verified", "Round result was finalized with a public proof."],
];

function VeilField({ compact = false }: { compact?: boolean }) {
  const particles = useMemo(
    () =>
      Array.from({ length: compact ? 54 : 96 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        top: `${20 + ((i * 53) % 66)}%`,
        delay: `${(i % 17) * -0.27}s`,
        size: `${2 + (i % 4)}px`,
      })),
    [compact],
  );

  return (
    <div className={`veil-field ${compact ? "compact" : ""}`} aria-hidden="true">
      <div className="veil-glow" />
      <div className="veil-wave veil-wave-a" />
      <div className="veil-wave veil-wave-b" />
      <div className="veil-cut" />
      {particles.map((particle, index) => (
        <span
          className={`particle ${index % 11 === 0 ? "hot" : ""}`}
          key={index}
          style={{
            left: particle.left,
            top: particle.top,
            animationDelay: particle.delay,
            width: particle.size,
            height: particle.size,
          }}
        />
      ))}
    </div>
  );
}

function Header({ onHome }: { onHome: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome}>
        <span className="brand-mark">V</span>
        <span>VEIL</span>
      </button>
      <nav>
        <a href="#pool">Pool</a>
        <a href="#draw">Draw</a>
        <a href="#history">History</a>
        <a href="#protocol">Protocol</a>
      </nav>
      <div className="top-actions">
        <span className="network"><i /> Sepolia</span>
        <button className="icon-button" aria-label="Notifications">⌁</button>
        <button className="wallet">Connect wallet</button>
      </div>
    </header>
  );
}

function Landing({ enter }: { enter: () => void }) {
  return (
    <main className="landing">
      <Header onHome={() => undefined} />
      <section className="hero-shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> PRIVATE PRIZE SAVINGS · POWERED BY FHE</div>
          <h1>NOTHING TO SEE.<br /><em>EVERYTHING TO VERIFY.</em></h1>
          <p>Private yield. Blind selection. Verifiable winners.</p>
          <div className="hero-actions">
            <button className="primary" onClick={enter}>ENTER VEIL <b>↗</b></button>
            <button className="text-button">How it works <span>→</span></button>
          </div>
          <div className="privacy-note">BALANCES · WEIGHTS · PRIZES <strong>STAY ENCRYPTED</strong></div>
        </div>
        <div className="hero-visual">
          <VeilField />
          <div className="hero-caption"><span>ENCRYPTED FIELD</span><span>FHE ACTIVE</span></div>
        </div>
      </section>
      <footer className="landing-footer">
        <span>Powered by Zama FHE</span>
        <span className="demo-warning">SEP0LIA DEMO · TEST ASSET</span>
        <span>GitHub · Docs</span>
      </footer>
    </main>
  );
}

function Dashboard({ home }: { home: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [panel, setPanel] = useState<"deposit" | "withdraw">("deposit");

  return (
    <main className="dashboard">
      <Header onHome={home} />
      <section className="dashboard-grid" id="pool">
        <aside className="left-rail">
          <div className="section-kicker">YOUR POSITION</div>
          <div className="private-balance">
            <span>{revealed ? "120.00" : "••••••"}</span><small>cUSD</small>
          </div>
          <div className="sealed-row"><span className="lock-dot">⌾</span> SEALED</div>
          <button className="outline" onClick={() => setRevealed(!revealed)}>{revealed ? "HIDE" : "REVEAL TO ME"}</button>
          <div className="privacy-lines">
            <p><span>Your weight</span><strong>ENCRYPTED</strong></p>
            <p><span>Your odds</span><strong>PRIVATE</strong></p>
            <p><span>Withdrawals</span><strong>PRIVATE</strong></p>
          </div>
          <div className="action-tabs">
            <button className={panel === "deposit" ? "active" : ""} onClick={() => setPanel("deposit")}>Deposit</button>
            <button className={panel === "withdraw" ? "active" : ""} onClick={() => setPanel("withdraw")}>Withdraw</button>
          </div>
          <div className="amount-box">
            <label>{panel === "deposit" ? "Amount to seal" : "Amount to withdraw"}</label>
            <div><span>0.00</span><b>cUSD</b></div>
          </div>
          <button className="primary full">{panel === "deposit" ? "SEAL DEPOSIT" : "WITHDRAW PRIVATELY"}</button>
          <small className="microcopy">Amounts never appear in VEIL events.</small>
        </aside>

        <section className="draw-stage" id="draw">
          <div className="round-head">
            <div><span>ROUND</span><strong>07</strong></div>
            <div className="round-state"><i /> OPEN</div>
            <div className="countdown"><span>SNAPSHOT IN</span><strong>02:15:42</strong></div>
          </div>
          <div className="draw-visual">
            <VeilField compact />
            <div className="draw-copy">
              <span>ENCRYPTED POOL</span>
              <h2>32 POSITIONS.<br />ZERO BALANCES EXPOSED.</h2>
              <p>The next BlindDraw operates on an encrypted snapshot of participant weights.</p>
            </div>
          </div>
          <div className="draw-stats">
            <div><span>Participants</span><strong>32</strong></div>
            <div><span>Your position</span><strong>SEALED</strong></div>
            <div><span>Winner</span><strong>—</strong></div>
            <div><span>Proof</span><strong>PENDING</strong></div>
          </div>
          <div className="lifecycle">
            {["OPEN", "SNAPSHOT", "BLIND DRAW", "REVEAL", "SETTLE"].map((step, i) => (
              <div className={i === 0 ? "current" : ""} key={step}><b>{String(i + 1).padStart(2, "0")}</b><span>{step}</span></div>
            ))}
          </div>
        </section>

        <aside className="right-rail">
          <div className="notifications-head"><span>ACTIVITY</span><button>⌁</button></div>
          {notifications.map(([title, body], i) => (
            <div className="activity" key={title}>
              <span className={i === 2 ? "verified" : ""}>{i === 2 ? "✓" : "●"}</span>
              <div><strong>{title}</strong><p>{body}</p><small>{i === 0 ? "NOW" : `${i * 6}M AGO`}</small></div>
            </div>
          ))}
          <div className="prize-card">
            <span>PRIZE STATUS</span>
            <h3>NO UNCLAIMED PRIZE</h3>
            <p>If you win, the prize amount stays encrypted until you choose to reveal it.</p>
          </div>
          <div className="proof-card">
            <span>LIVE CONTRACT</span>
            <code>{VEIL_CONTRACTS.pool.slice(0, 10)}…{VEIL_CONTRACTS.pool.slice(-6)}</code>
            <small>Sepolia · demo deployment</small>
          </div>
        </aside>
      </section>

      <section className="protocol-strip" id="protocol">
        <div><span>01</span><strong>DEPOSIT</strong><p>Input is encrypted before it reaches VEIL.</p></div>
        <div><span>02</span><strong>SNAPSHOT</strong><p>Encrypted weights freeze without revealing balances.</p></div>
        <div><span>03</span><strong>BLIND DRAW</strong><p>Winner selection executes over ciphertexts.</p></div>
        <div><span>04</span><strong>VERIFY</strong><p>The final winner becomes publicly provable.</p></div>
        <div><span>05</span><strong>CLAIM</strong><p>Prize stays private until the winner decrypts it.</p></div>
      </section>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>("landing");
  return view === "landing" ? <Landing enter={() => setView("app")} /> : <Dashboard home={() => setView("landing")} />;
}
