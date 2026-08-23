import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { VEIL_CONTRACTS } from "./contracts";
import {
  advanceRoundMaintenance,
  connectWallet,
  drawStateLabel,
  fundDemoWallet,
  readDashboard,
  readPublicState,
  renewDrawSeat,
  revealPrivatePosition,
  revealPrize,
  revealRoundStats,
  sealDeposit,
  watchWalletSession,
  withdrawPrivate,
  type PrivatePosition,
  type PrivateRoundStats,
  type PublicState,
} from "./veilClient";

type DashboardData = Awaited<ReturnType<typeof readDashboard>>;
type SaveMode = "deposit" | "withdraw";

type Route =
  | "/"
  | "/app"
  | "/app/save"
  | "/app/draws"
  | "/app/vault"
  | "/app/prizes"
  | "/app/history"
  | "/protocol";

const ROUTES: Route[] = [
  "/",
  "/app",
  "/app/save",
  "/app/draws",
  "/app/vault",
  "/app/prizes",
  "/app/history",
  "/protocol",
];

const GUIDE_KEY = "unveil-guide-complete-v1";
const GUIDE_STEPS = [
  ["WELCOME TO UNVEIL", "Save money. Keep it private. Win from shared yield.", "/app"],
  ["CONNECT YOUR WALLET", "Use a Sepolia wallet. UNVEIL will never ask you to paste a private key.", "/app"],
  ["SAVE PRIVATELY", "Choose an amount. It is encrypted in your browser before the pool receives the request.", "/app/save"],
  ["WATCH THE DRAW", "The contract enforces the deadline. Anyone can progress the permissionless draw after it closes.", "/app/draws"],
  ["UNVEIL YOUR STATS", "Your balance, activity, draw weight and exact odds are private from everyone else, not from you.", "/app/vault"],
  ["WIN WITHOUT CLAIM FRICTION", "If you win, a keeper can deliver the encrypted prize. Only you can reveal its amount.", "/app/prizes"],
] as const;

function normalizeRoute(pathname: string): Route {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return ROUTES.includes(clean as Route) ? (clean as Route) : "/";
}

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
}

function explorerAddress(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`;
}

function formatPrivate(value: bigint | undefined, suffix = "cUSD") {
  return value === undefined ? "••••••" : `${value.toLocaleString()} ${suffix}`;
}

function formatOdds(stats: PrivateRoundStats | undefined) {
  if (!stats) return "••••%";
  const whole = stats.oddsBps / 100n;
  const fraction = (stats.oddsBps % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

function formatCountdown(target: bigint, nowMs: number) {
  const seconds = Math.max(0, Number(target) - Math.floor(nowMs / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m`;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function readableDate(timestamp: bigint) {
  if (timestamp === 0n) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();

  if (code === 4001 || lower.includes("user rejected")) return "Request cancelled in your wallet.";
  if (lower.includes("insufficient funds")) return "You need a little Sepolia ETH for gas.";
  if (lower.includes("draw still open")) return "This draw is still open. The contract will not close it early.";
  if (lower.includes("yield not ready")) return "The draw is settled, but its confidential strategy yield is not sealed yet.";
  if (lower.includes("not in round")) return "You were not in that frozen draw snapshot.";
  if (lower.includes("not winner")) return "Only the finalized winner can unveil that prize.";
  if (lower.includes("timed out") || lower.includes("did not respond"))
    return "The wallet or Sepolia request timed out. Check MetaMask activity before retrying.";
  if (lower.includes("relayer")) return "Zama's relayer did not respond. Retry when the network is available.";
  return "That action could not be completed. Check the activity message and retry.";
}

function useRoute() {
  const [route, setRoute] = useState<Route>(() => normalizeRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(normalizeRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (window.location.pathname !== next) window.history.pushState({}, "", next);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return { route, navigate };
}

function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`unveil-mark ${compact ? "compact" : ""}`} aria-hidden="true">
      <i />
      <b />
    </span>
  );
}

function CipherResolve({ value }: { value: string }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (value.includes("•") || value === "—" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const glyphs = "019ACEF347BD";
    let frame = 0;
    const frames = 18;
    const timer = window.setInterval(() => {
      frame += 1;
      const revealThrough = Math.floor((frame / frames) * value.length);
      const next = value
        .split("")
        .map((character, index) => {
          if (index < revealThrough || /[\s.,%]/.test(character)) return character;
          return glyphs[(index * 7 + frame * 5) % glyphs.length];
        })
        .join("");
      setDisplay(frame >= frames ? value : next);
      if (frame >= frames) window.clearInterval(timer);
    }, 28);

    return () => window.clearInterval(timer);
  }, [value]);

  return <>{display}</>;
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        window.setTimeout(() => setShown(true), delay);
        observer.disconnect();
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={`scroll-reveal ${shown ? "shown" : ""} ${className}`}>
      {children}
    </div>
  );
}

function LandingHeader({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <header className="landing-nav">
      <button className="wordmark" onClick={() => navigate("/")}>
        <Mark compact />
        <span>UNVEIL</span>
      </button>
      <nav>
        <a href="#product">Product</a>
        <a href="#how">How it works</a>
        <a href="#privacy">Privacy</a>
        <a href="#security">Security</a>
        <button onClick={() => navigate("/protocol")}>Protocol</button>
      </nav>
      <button className="launch-pill" onClick={() => navigate("/app")}>
        Launch app <span>↗</span>
      </button>
    </header>
  );
}

function EncryptionTheatre() {
  const [opened, setOpened] = useState(false);
  const cipher = useMemo(() => "9F A2 7C 11 E8 4D B0 C6 33 7A 21 F4", []);

  return (
    <div className={`encryption-theatre ${opened ? "opened" : ""}`} onClick={() => setOpened((value) => !value)}>
      <div className="aperture-grid" />
      <div className="orbit orbit-a" />
      <div className="orbit orbit-b" />
      <div className="orbit orbit-c" />
      <div className="cipher-stream stream-a">{cipher}</div>
      <div className="cipher-stream stream-b">{cipher.split(" ").reverse().join(" ")}</div>
      <div className="privacy-core">
        <span className="core-kicker">PRIVATE POSITION</span>
        <strong className="core-value"><CipherResolve value={opened ? "12.45 cUSDC" : "•••••• cUSDC"} /></strong>
        <span className="core-state">{opened ? "UNVEILED ONLY TO YOU" : "FHE SEALED"}</span>
      </div>
      <div className="theatre-caption">
        <span>CLICK TO {opened ? "VEIL" : "UNVEIL"}</span>
        <span>LOCAL DECRYPTION</span>
      </div>
    </div>
  );
}

function Landing({ navigate, publicState, startGuide }: { navigate: (route: Route) => void; publicState?: PublicState; startGuide: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = publicState?.rounds[0];

  return (
    <main className="landing-page">
      <LandingHeader navigate={navigate} />
      <section className="hero-v3" id="product">
        <div className="hero-v3-copy">
          <div className="signal-line"><i /> CONFIDENTIAL PRIZE SAVINGS · ZAMA FHE</div>
          <h1>SAVE PRIVATELY.<span>WIN VERIFIABLY.</span></h1>
          <p>Deposit into a shared prize pool without publishing your balance, draw weight or winnings. UNVEIL runs a weighted draw over encrypted values and proves the winner onchain.</p>
          <div className="hero-v3-actions">
            <button className="cta-primary" onClick={() => navigate("/app/save")}>START SAVING <span>↗</span></button>
            <button className="cta-ghost" onClick={startGuide}>TAKE THE GUIDED DEMO <span>→</span></button>
          </div>
          <div className="hero-proofline"><span><b>FHE</b> balances sealed</span><span><b>PERMISSIONLESS</b> draws</span><span><b>NO-LOSS</b> principal model</span></div>
        </div>
        <EncryptionTheatre />
      </section>

      <section className="live-rail">
        <div><span>NEXT PRIVATE DRAW</span><strong>{publicState ? formatCountdown(publicState.nextDrawClosesAt, now) : "SYNCING…"}</strong></div>
        <div><span>ACTIVE DRAW POSITIONS</span><strong>{publicState?.playerCount ?? "—"}</strong></div>
        <div><span>LATEST ROUND</span><strong>{latest ? `#${latest.id}` : "AWAITING"}</strong></div>
        <div><span>PROOF STATE</span><strong>{latest ? drawStateLabel(latest.state) : "LIVE SEPOLIA"}</strong></div>
      </section>

      <section className="editorial-block problem-block">
        <Reveal><p className="section-code">[ THE PROBLEM ]</p><h2>Your savings should not be a public leaderboard.</h2></Reveal>
        <Reveal delay={100} className="editorial-grid">
          <p>Prize savings works because everyone pools capital and shares the yield. On a transparent chain, that can also reveal who saved what, who carries the most draw weight and how much a winner received.</p>
          <p className="editorial-punch">UNVEIL keeps the game verifiable without turning your finances into the game.</p>
        </Reveal>
      </section>

      <section className="how-section" id="how">
        <Reveal><p className="section-code">[ HOW IT WORKS ]</p><h2>Private in. Provable out.</h2></Reveal>
        <div className="how-grid">
          {[
            ["01", "SAVE", "Encrypt a deposit in your browser. The pool records principal without publishing the amount."],
            ["02", "EARN", "A confidential strategy adapter realizes yield separately from user principal."],
            ["03", "FREEZE", "At the onchain deadline, anyone can close the draw and freeze encrypted weights."],
            ["04", "BLINDDRAW", "FHE samples a weighted winner without exposing balances or odds."],
            ["05", "PROVE", "Zama public decryption proves the winner handle and the contract verifies it."],
            ["06", "DELIVER", "Realized encrypted yield is sent to the finalized winner. No manual claim is required."],
          ].map(([n, title, copy], index) => (
            <Reveal delay={index * 70} key={n} className="how-card"><span className="how-number">{n}</span><h3>{title}</h3><p>{copy}</p><i /></Reveal>
          ))}
        </div>
      </section>

      <section className="privacy-compare" id="privacy">
        <Reveal className="compare-head"><p className="section-code">[ WHY UNVEIL ]</p><h2>Verifiability without financial exposure.</h2><p>PoolTogether proves the draw through transparency. UNVEIL proves it without exposing your finances.</p></Reveal>
        <Reveal className="compare-table" delay={100}>
          <div className="compare-row compare-title"><span>INFORMATION</span><span>PUBLIC PRIZE POOL</span><span>UNVEIL</span></div>
          {[
            ["Savings balance", "Observable", "Encrypted"],
            ["Deposit / withdrawal amount", "Observable", "Encrypted"],
            ["Draw weight", "Inferable", "Encrypted"],
            ["Personal odds", "Public / inferable", "Private reveal"],
            ["Winner identity", "Public", "Public + proved"],
            ["Prize amount", "Observable", "Winner-only reveal"],
            ["Principal", "Withdrawable", "Withdrawable"],
          ].map(([label, publicPool, unveil]) => <div className="compare-row" key={label}><span>{label}</span><span>{publicPool}</span><span className="sealed-cell">{unveil}</span></div>)}
        </Reveal>
      </section>

      <section className="draw-story">
        <Reveal><p className="section-code">[ THE DRAW ]</p><h2>No admin button. The clock is the rule.</h2></Reveal>
        <Reveal delay={100} className="draw-line">
          {[["OPEN", "Private deposits continue"], ["DEADLINE", "Contract freezes eligible weights"], ["BLIND", "FHE selects over ciphertext"], ["PROOF", "KMS proof verifies winner"], ["PAYOUT", "Encrypted yield reaches winner"]].map(([title, copy], index) => <div className="draw-node" key={title}><i className={index === 0 ? "active" : ""} /><strong>{title}</strong><span>{copy}</span></div>)}
        </Reveal>
      </section>

      <section className="security-section" id="security">
        <Reveal className="security-copy"><p className="section-code">[ PRIVACY BOUNDARY ]</p><h2>We hide the numbers. We prove the outcome.</h2><p>Wallet addresses, transaction timing, draw membership and the finalized winner remain public. Balances, amounts, weights, odds and prize values remain ciphertext until an authorized user chooses to unveil them.</p><button className="text-link" onClick={() => navigate("/protocol")}>READ THE PROTOCOL MODEL →</button></Reveal>
        <Reveal delay={120} className="security-orbit"><div className="security-ring ring-1" /><div className="security-ring ring-2" /><div className="security-center"><Mark /><strong>ZAMA FHE</strong><span>COMPUTE WHILE SEALED</span></div><span className="security-tag tag-a">BALANCE · PRIVATE</span><span className="security-tag tag-b">WINNER · PROVED</span><span className="security-tag tag-c">PRIZE · PRIVATE</span></Reveal>
      </section>

      <section className="faq-section">
        <Reveal><p className="section-code">[ QUESTIONS ]</p><h2>Simple answers before you save.</h2></Reveal>
        <div className="faq-grid">
          {[
            ["Can I lose my deposit?", "UNVEIL's prize comes from strategy yield. Your recorded principal remains separately withdrawable."],
            ["Can I see my own balance?", "Yes. Click UNVEIL and sign once. Your browser decrypts your private stats for your session."],
            ["Can I see my odds?", "After a draw closes, you can privately decrypt your frozen weight and total pool weight and calculate exact odds locally."],
            ["Who runs the draw?", "Nobody controls the timing. The contract enforces the deadline and any account can progress the permissionless draw steps."],
            ["Do I need to claim a win?", "No. Any keeper can deliver the encrypted prize, but the destination is fixed to the proved winner."],
            ["Is everything anonymous?", "No. Addresses and transaction metadata are public. UNVEIL protects financial values, not all blockchain metadata."],
          ].map(([q, a], index) => <Reveal delay={index * 50} key={q} className="faq-card"><h3>{q}</h3><p>{a}</p></Reveal>)}
        </div>
      </section>

      <section className="final-cta"><Reveal><p>NOTHING TO SEE.</p><h2>EVERYTHING TO VERIFY.</h2><button className="cta-primary huge" onClick={() => navigate("/app/save")}>START SAVING PRIVATELY ↗</button></Reveal></section>
      <footer className="landing-footer-v3"><span><Mark compact /> UNVEIL</span><span>SEPOLIA · TEST ASSET · ZAMA FHE</span><button onClick={() => navigate("/protocol")}>Contracts & protocol ↗</button></footer>
    </main>
  );
}

function AppShell({ route, navigate, address, busy, connect, startGuide, children }: { route: Route; navigate: (route: Route) => void; address: string; busy: string; connect: () => void; startGuide: () => void; children: React.ReactNode }) {
  const links: Array<[Route, string]> = [["/app", "Overview"], ["/app/save", "Save"], ["/app/draws", "Draws"], ["/app/vault", "My Vault"], ["/app/prizes", "Prizes"], ["/app/history", "History"]];

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <button className="wordmark app-wordmark" onClick={() => navigate("/")}><Mark compact /><span>UNVEIL</span></button>
        <nav>{links.map(([to, label]) => <button key={to} className={route === to ? "active" : ""} onClick={() => navigate(to)}><span>{label}</span><i /></button>)}</nav>
        <div className="sidebar-bottom"><button onClick={startGuide}>Replay guide</button><button onClick={() => navigate("/protocol")}>Protocol ↗</button><div className="network-chip"><i /> SEPOLIA</div></div>
      </aside>
      <div className="app-main">
        <header className="app-topbar"><div className="mobile-brand"><Mark compact /><strong>UNVEIL</strong></div><span className="private-mode"><i /> PRIVATE MODE ACTIVE</span><button className="wallet-pill" disabled={Boolean(busy)} onClick={connect}>{busy === "connect" ? "CONNECTING…" : address ? shortAddress(address) : "CONNECT WALLET"}</button></header>
        <div className="route-stage" key={route}>{children}</div>
        <nav className="mobile-tabs">{[["/app", "Home"], ["/app/save", "Save"], ["/app/draws", "Draws"], ["/app/prizes", "Prizes"], ["/app/vault", "Me"]].map(([to, label]) => <button key={to} className={route === to ? "active" : ""} onClick={() => navigate(to as Route)}>{label}</button>)}</nav>
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function SealedMetric({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return <div className={`sealed-metric ${accent ? "accent" : ""}`}><span>{label}</span><strong className={value.includes("•") ? "cipher-value" : "clear-value"}><CipherResolve value={value} /></strong><small>{hint}</small></div>;
}

function BlindDrawField({ phase, playerCount }: { phase: string; playerCount: number }) {
  const nodes = useMemo(() => Array.from({ length: 24 }, (_, index) => ({ angle: (360 / 24) * index, radius: 31 + (index % 4) * 5, delay: `${(index % 8) * -0.13}s` })), []);
  return (
    <div className={`blinddraw-field phase-${phase}`}>
      <div className="blinddraw-grid" />
      <div className="blinddraw-ring ring-a" /><div className="blinddraw-ring ring-b" />
      {nodes.map((node, index) => <i className={index < Math.min(playerCount, nodes.length) ? "occupied" : ""} key={index} style={{ "--angle": `${node.angle}deg`, "--radius": `${node.radius}%`, "--delay": node.delay } as React.CSSProperties} />)}
      <div className="blinddraw-core"><span>FHE BLINDDRAW</span><strong>{phase.toUpperCase()}</strong><small>{playerCount} encrypted positions</small></div>
      <div className="blinddraw-caption"><span>WEIGHTS NEVER OPEN</span><span>KMS-PROVED OUTCOME</span></div>
    </div>
  );
}

function OverviewPage({ data, publicState, privatePosition, privateRound, now, navigate, unveil }: { data?: DashboardData; publicState?: PublicState; privatePosition?: PrivatePosition; privateRound?: PrivateRoundStats; now: number; navigate: (route: Route) => void; unveil: () => void }) {
  const state = data ?? publicState;
  const latest = state?.rounds[0];
  return (
    <section className="product-page">
      <PageHead eyebrow="OVERVIEW" title="Your private savings cockpit." copy="The chain sees participation. Only you can unveil the numbers." />
      <div className="overview-hero">
        <div className="next-draw-card"><span>NEXT PRIVATE DRAW</span><strong>{state ? formatCountdown(state.nextDrawClosesAt, now) : "--:--:--"}</strong><p>{data?.seated ? "You are eligible for the next scheduled close." : data?.joined ? "Renew eligibility when needed without changing your principal." : "Connect and save privately to enter the next draw."}</p><button onClick={() => navigate("/app/draws")}>OPEN DRAW CENTER →</button></div>
        <div className="overview-stats"><SealedMetric label="PRIVATE BALANCE" value={formatPrivate(privatePosition?.balance)} hint="Only you can decrypt" accent /><SealedMetric label="LATEST SNAPSHOT WEIGHT" value={privateRound ? privateRound.weight.toString() : "••••••"} hint="Frozen at draw close" /><SealedMetric label="LATEST EXACT ODDS" value={formatOdds(privateRound)} hint="Calculated locally" /><SealedMetric label="ACTIVE POSITIONS" value={state?.playerCount.toString() ?? "—"} hint="Public roster count" /></div>
      </div>
      <div className="overview-actions"><button className="unveil-button" onClick={unveil}><span>UNVEIL MY PRIVATE STATS</span><i>↗</i></button><button className="action-tile" onClick={() => navigate("/app/save")}><span>SAVE MORE</span><strong>Encrypt a new deposit →</strong></button><button className="action-tile" onClick={() => navigate("/app/prizes")}><span>PRIZES</span><strong>{latest?.winner ? "Check the latest result →" : "Watch the next draw →"}</strong></button></div>
    </section>
  );
}

function SavePage({ address, data, mode, setMode, amount, setAmount, busy, transact, fund }: { address: string; data?: DashboardData; mode: SaveMode; setMode: (mode: SaveMode) => void; amount: string; setAmount: (value: string) => void; busy: string; transact: () => void; fund: () => void }) {
  return (
    <section className="product-page">
      <PageHead eyebrow="SAVE" title="Move value without publishing the number." copy="The amount is encrypted in your browser before the pool sees it." />
      <div className="save-layout">
        <div className="save-card"><div className="segmented"><button className={mode === "deposit" ? "active" : ""} onClick={() => setMode("deposit")}>Deposit</button><button className={mode === "withdraw" ? "active" : ""} onClick={() => setMode("withdraw")}>Withdraw</button></div><label className="amount-label"><span>{mode === "deposit" ? "AMOUNT TO SAVE" : "PRIVATE WITHDRAWAL REQUEST"}</span><div><input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} placeholder="0" /><b>cUSD</b></div></label><div className="encrypt-preview"><i /><span>THIS VALUE LEAVES YOUR BROWSER AS FHE CIPHERTEXT</span><code>{amount ? `encrypt(${amount}) → 0x••••••••` : "awaiting amount"}</code></div><button className="seal-action" disabled={Boolean(busy) || !amount} onClick={transact}>{busy === mode ? "PROCESSING PRIVATE REQUEST…" : mode === "deposit" ? "ENCRYPT & SAVE" : "ENCRYPT & WITHDRAW"}<span>↗</span></button><p className="silent-zero">Oversized requests resolve privately to zero. UNVEIL never announces “insufficient balance” to the public UI.</p></div>
        <div className="save-side"><div className="status-card"><span>YOUR DRAW ELIGIBILITY</span><strong>{data?.seated ? "ACTIVE" : data?.joined ? "NEEDS RENEWAL" : "NOT YET ENTERED"}</strong><p>A successful deposit automatically keeps your draw eligibility alive.</p></div><div className="demo-card"><span>SEPOLIA DEMO ASSET</span><h3>Need test cUSD?</h3><p>The faucet is convenience only. It is not part of the production economic model.</p><button disabled={!address || Boolean(busy)} onClick={fund}>{busy === "fund" ? "FUNDING…" : "GET 100 DEMO cUSD"}</button></div></div>
      </div>
    </section>
  );
}

function DrawsPage({ state, now, busy, maintain }: { state?: PublicState; now: number; busy: string; maintain: () => void }) {
  const latest = state?.rounds[0];
  const nowSec = BigInt(Math.floor(now / 1000));
  const closeReady = state ? nowSec >= state.nextDrawClosesAt : false;
  const yieldRound = state?.rounds.find((round) => round.id === state.yieldRoundId);
  const deliveryTarget = state?.rounds.slice().reverse().find((round) => round.state === 3 && round.funded && !round.delivered);

  let maintenanceLabel = "DRAW AUTOMATION CAUGHT UP";
  let phase = "open";
  let disabled = !state;

  if (closeReady) {
    maintenanceLabel = "CLOSE ELAPSED DRAW";
    phase = "ready";
    disabled = false;
  } else if (latest?.state === 1) {
    maintenanceLabel = "RUN BLINDDRAW";
    phase = "snapshot";
    disabled = false;
  } else if (latest?.state === 2) {
    maintenanceLabel = "PROVE & FINALIZE WINNER";
    phase = "draw";
    disabled = false;
  } else if (yieldRound && (yieldRound.state === 3 || yieldRound.state === 4) && !state?.yieldReady) {
    maintenanceLabel = "AWAITING STRATEGY YIELD";
    phase = "yield";
    disabled = true;
  } else if (yieldRound?.state === 4 && state?.yieldReady) {
    maintenanceLabel = "CARRY SEALED YIELD FORWARD";
    phase = "yield";
    disabled = false;
  } else if (yieldRound?.state === 3 && !yieldRound.funded && state?.yieldReady) {
    maintenanceLabel = "ROUTE SEALED REALIZED YIELD";
    phase = "yield";
    disabled = false;
  } else if (deliveryTarget) {
    maintenanceLabel = "DELIVER ENCRYPTED PRIZE";
    phase = "payout";
    disabled = false;
  } else if (latest?.state === 3) {
    phase = "proved";
  } else if (latest?.state === 4) {
    phase = "cancelled";
  }

  return (
    <section className="product-page draw-page">
      <PageHead eyebrow="DRAWS" title="The clock controls the round." copy="UNVEIL enforces the deadline onchain. Any account can progress the permissionless steps afterward." />
      <div className="draw-dashboard"><div className="countdown-panel"><span>NEXT SCHEDULED CLOSE</span><strong>{state ? formatCountdown(state.nextDrawClosesAt, now) : "--:--:--"}</strong><small>{state ? readableDate(state.nextDrawClosesAt) : "Loading onchain schedule"}</small><div className="countdown-track"><i style={{ width: state ? `${Math.min(100, Math.max(3, (1 - Math.max(0, Number(state.nextDrawClosesAt) - now / 1000) / Number(state.drawPeriod)) * 100))}%` : "3%" }} /></div></div><div className="draw-state-panel"><span>LATEST ROUND</span><strong>{latest ? `#${latest.id} · ${drawStateLabel(latest.state)}` : "NO CLOSED ROUND YET"}</strong><p>{latest ? `${latest.participantCount} encrypted positions frozen at block ${latest.snapshotBlock}.` : "The first eligible scheduled draw is still open."}</p><button disabled={Boolean(busy) || disabled} onClick={maintain}>{busy === "maintain" ? "ADVANCING PROTOCOL…" : maintenanceLabel}<span>↗</span></button><small className="permissionless-note">No admin privilege. The only non-keeper step is the strategy sealing its completed confidential yield bucket after draw close.</small></div></div>
      <BlindDrawField phase={phase} playerCount={latest?.participantCount ?? state?.playerCount ?? 0} />
      <div className="lifecycle-track">{[["01", "OPEN", "Private deposits"], ["02", "SNAPSHOT", "Weights frozen"], ["03", "BLINDDRAW", "FHE selection"], ["04", "PROOF", "KMS verified"], ["05", "PAYOUT", "Private delivery"]].map(([n, name, sub], index) => { const activeIndex = phase === "open" ? 0 : phase === "ready" || phase === "snapshot" ? 1 : phase === "draw" ? 2 : phase === "proved" || phase === "yield" ? 3 : phase === "payout" ? 4 : 0; return <div className={`lifecycle-step ${activeIndex === index ? "active" : ""}`} key={n}><span>{n}</span><i /><strong>{name}</strong><small>{sub}</small></div>; })}</div>
    </section>
  );
}

function VaultPage({ data, position, roundStats, busy, unveil, veil, renew }: { data?: DashboardData; position?: PrivatePosition; roundStats?: PrivateRoundStats; busy: string; unveil: () => void; veil: () => void; renew: () => void }) {
  const open = Boolean(position);
  return (
    <section className={`product-page vault-page ${open ? "unveiled" : ""}`}>
      <PageHead eyebrow="MY VAULT" title="Encrypted to everyone. Unveiled only to you." copy="One wallet signature decrypts your private position for this browser session." action={<button className="veil-toggle" disabled={Boolean(busy)} onClick={open ? veil : unveil}>{busy === "unveil" ? "UNVEILING…" : open ? "VEIL MY STATS" : "UNVEIL MY STATS"}</button>} />
      <div className="private-grid"><SealedMetric label="CURRENT PRINCIPAL" value={formatPrivate(position?.balance)} hint="Withdrawable principal" accent /><SealedMetric label="TOTAL DEPOSITED" value={formatPrivate(position?.totalDeposited)} hint="Private lifetime activity" /><SealedMetric label="TOTAL WITHDRAWN" value={formatPrivate(position?.totalWithdrawn)} hint="Private lifetime activity" /><SealedMetric label="LAST DEPOSIT" value={formatPrivate(position?.lastDeposit)} hint="Never published as plaintext" /><SealedMetric label="LAST WITHDRAWAL" value={formatPrivate(position?.lastWithdrawal)} hint="Never published as plaintext" /><SealedMetric label="LATEST DRAW WEIGHT" value={roundStats ? roundStats.weight.toString() : "••••••"} hint="Frozen snapshot weight" /><SealedMetric label="LATEST EXACT ODDS" value={formatOdds(roundStats)} hint="Computed locally from encrypted denominator" accent /><SealedMetric label="DRAW ELIGIBILITY" value={data?.seated ? "ACTIVE" : "INACTIVE"} hint={data?.seatExpiresAt ? `Lease through ${readableDate(data.seatExpiresAt)}` : "Deposit to enter"} /></div>
      <div className="vault-explain"><div><i /> <strong>ONE SIGNATURE</strong><p>UNVEIL asks your wallet to authorize private decryption. The plaintext appears only in your browser session.</p></div><button disabled={!data?.joined || Boolean(busy)} onClick={renew}>RENEW DRAW ELIGIBILITY</button></div>
    </section>
  );
}

function PrizesPage({ address, state, revealedPrizes, busy, revealWin, maintain }: { address: string; state?: PublicState; revealedPrizes: Record<string, bigint>; busy: string; revealWin: (round: bigint) => void; maintain: () => void }) {
  const wins = state?.rounds.filter((round) => address && round.winner.toLowerCase() === address.toLowerCase()) ?? [];
  return (
    <section className="product-page">
      <PageHead eyebrow="PRIZES" title="If you win, the prize finds you." copy="A keeper can deliver the encrypted prize to the proved winner. Only that winner can unveil the amount." />
      {wins.length === 0 ? <div className="empty-prize"><div className="prize-orb"><Mark /></div><span>{address ? "NO WIN RECORDED FOR THIS WALLET YET" : "CONNECT TO CHECK YOUR PRIVATE PRIZE HISTORY"}</span><h2>Your principal keeps working for future draws.</h2><p>Winning is public. The amount you win is not.</p></div> : <div className="win-stack">{wins.map((round) => { const amount = revealedPrizes[round.id.toString()]; return <article className={`win-card ${round.delivered ? "delivered" : ""}`} key={round.id.toString()}><div className="win-burst" /><span>ROUND #{round.id} · YOU WON</span><h2><CipherResolve value={amount === undefined ? "•••••• cUSD" : `${amount.toLocaleString()} cUSD`} /></h2><div className="win-meta"><span>PAYOUT <b>{round.delivered ? "DELIVERED ✓" : round.funded ? "READY" : state?.yieldReady && state.yieldRoundId === round.id ? "YIELD SEALED" : "AWAITING YIELD"}</b></span><span>PROOF <b>VERIFIED ✓</b></span></div><button disabled={!round.funded || Boolean(busy)} onClick={() => round.delivered ? revealWin(round.id) : maintain()}>{round.delivered ? "UNVEIL WHAT I WON" : "DELIVER MY PRIVATE PRIZE"}<span>↗</span></button></article>; })}</div>}
    </section>
  );
}

function HistoryPage({ state }: { state?: PublicState }) {
  return <section className="product-page"><PageHead eyebrow="HISTORY" title="Public outcomes. Private finances." copy="Every finalized winner is verifiable. Individual weights and prize values are not." /><div className="history-list-v3">{(state?.rounds ?? []).length === 0 ? <div className="history-empty">NO CLOSED ROUNDS ON THIS DEPLOYMENT YET.</div> : state?.rounds.map((round) => <article key={round.id.toString()}><div><span>ROUND</span><strong>#{round.id.toString().padStart(2, "0")}</strong></div><div><span>STATE</span><strong>{drawStateLabel(round.state)}</strong></div><div><span>WINNER</span><strong>{round.state === 3 ? shortAddress(round.winner) : round.state === 4 ? "PROVEN ZERO" : "SEALED"}</strong></div><div><span>POSITIONS</span><strong>{round.participantCount}</strong></div><div><span>PRIZE</span><strong>{round.delivered ? "DELIVERED · AMOUNT PRIVATE" : round.funded ? "FUNDED · PRIVATE" : "PENDING"}</strong></div><a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VERIFY ↗</a></article>)}</div></section>;
}

function ProtocolPage({ navigate }: { navigate: (route: Route) => void }) {
  return <main className="protocol-page"><header className="protocol-nav"><button className="wordmark" onClick={() => navigate("/")}><Mark compact /><span>UNVEIL</span></button><button onClick={() => navigate("/app")}>OPEN APP ↗</button></header><section className="protocol-hero"><span>[ PROTOCOL MODEL ]</span><h1>Private numbers.<br /><em>Public proof.</em></h1><p>UNVEIL is a confidential prize-savings protocol built around Zama FHE. It keeps the financial inputs encrypted while allowing the public to verify the draw outcome.</p></section><section className="protocol-diagram"><div className="proto-node"><span>01</span><strong>WALLET</strong><small>encrypt locally</small></div><i /><div className="proto-node private"><span>02</span><strong>VeilPool</strong><small>principal + weights · FHE</small></div><i /><div className="proto-node"><span>03</span><strong>BLINDDRAW</strong><small>weighted encrypted selection</small></div><i /><div className="proto-node"><span>04</span><strong>KMS PROOF</strong><small>public winner verification</small></div><i /><div className="proto-node private"><span>05</span><strong>PRIZE VAULT</strong><small>winner-only amount</small></div></section><section className="protocol-columns"><div><span>PRIVATE</span><ul><li>principal balance</li><li>deposit amount</li><li>withdrawal amount</li><li>snapshot weight</li><li>personal odds until user reveal</li><li>prize amount</li></ul></div><div><span>PUBLIC</span><ul><li>wallet address</li><li>transaction timing</li><li>draw membership</li><li>round lifecycle</li><li>finalized winner</li><li>payout state</li></ul></div><div><span>PERMISSIONLESS</span><ul><li>scheduled draw close</li><li>BlindDraw execution</li><li>winner proof finalization</li><li>sealed-yield routing</li><li>prize delivery</li></ul></div></section><section className="contracts-grid">{[["POOL", VEIL_CONTRACTS.pool], ["YIELD ADAPTER", VEIL_CONTRACTS.yieldSource], ["PRIZE VAULT", VEIL_CONTRACTS.prizeVault], ["DEMO ASSET", VEIL_CONTRACTS.asset]].map(([label, contractAddress]) => <a href={explorerAddress(contractAddress)} target="_blank" rel="noreferrer" key={label}><span>{label}</span><code>{contractAddress}</code><b>↗</b></a>)}</section><section className="protocol-note"><strong>YIELD BOUNDARY</strong><p>The Sepolia competition deployment uses a controlled strategy adapter backed by actual confidential demo-asset transfers. After a draw closes the strategy seals that round's encrypted realized-yield bucket; it cannot choose the winner or reroute the bucket. Production can replace the adapter with a reviewed confidential yield venue.</p></section></main>;
}

function Guide({ step, setStep, close, navigate }: { step: number; setStep: (step: number) => void; close: () => void; navigate: (route: Route) => void }) {
  const current = GUIDE_STEPS[step];
  useEffect(() => { navigate(current[2] as Route); }, [current, navigate]);
  const finish = () => { localStorage.setItem(GUIDE_KEY, "1"); close(); };
  return <div className="guide-backdrop"><div className="guide-card" role="dialog" aria-modal="true" aria-label="UNVEIL guided demo"><div className="guide-progress">{GUIDE_STEPS.map((_, index) => <i className={index <= step ? "active" : ""} key={index} />)}</div><span>{step + 1} / {GUIDE_STEPS.length}</span><h2>{current[0]}</h2><p>{current[1]}</p><div className="guide-actions"><button onClick={finish}>SKIP</button><button className="guide-next" onClick={() => step === GUIDE_STEPS.length - 1 ? finish() : setStep(step + 1)}>{step === GUIDE_STEPS.length - 1 ? "FINISH" : "CONTINUE"} →</button></div></div></div>;
}

export default function App() {
  const { route, navigate } = useRoute();
  const [signer, setSigner] = useState<JsonRpcSigner>();
  const [address, setAddress] = useState("");
  const [data, setData] = useState<DashboardData>();
  const [publicState, setPublicState] = useState<PublicState>();
  const [privatePosition, setPrivatePosition] = useState<PrivatePosition>();
  const [privateRound, setPrivateRound] = useState<PrivateRoundStats>();
  const [revealedPrizes, setRevealedPrizes] = useState<Record<string, bigint>>({});
  const [saveMode, setSaveMode] = useState<SaveMode>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Connect a wallet when you are ready to use the live Sepolia app.");
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(Date.now());
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        if (signer) {
          const next = await readDashboard(signer);
          if (!cancelled) { setData(next); setPublicState(next); }
        } else {
          const next = await readPublicState();
          if (!cancelled) setPublicState(next);
        }
      } catch {
        // Keep the last good state. The visible countdown still runs locally while RPC recovers.
      }
    };
    void sync();
    const timer = window.setInterval(sync, 12_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [signer]);

  useEffect(() => {
    if (!signer) return;
    return watchWalletSession(() => { setSigner(undefined); setAddress(""); setData(undefined); setPrivatePosition(undefined); setPrivateRound(undefined); setRevealedPrizes({}); setNotice("Wallet account or network changed. Reconnect to refresh your private session."); });
  }, [signer]);

  useEffect(() => {
    if (guideOpen || !route.startsWith("/app") || localStorage.getItem(GUIDE_KEY) === "1") return;
    const timer = window.setTimeout(() => setGuideOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [guideOpen, route]);

  async function refresh(active = signer) {
    if (!active) { const next = await readPublicState(); setPublicState(next); return; }
    const next = await readDashboard(active); setData(next); setPublicState(next);
  }

  async function connect() {
    try { setFailure(""); setBusy("connect"); const wallet = await connectWallet(); setSigner(wallet.signer); setAddress(wallet.address); const dashboard = await readDashboard(wallet.signer); setData(dashboard); setPublicState(dashboard); setNotice(dashboard.joined ? "Wallet connected. Your financial values remain sealed until you choose to unveil them." : "Wallet connected. Start with a private deposit when you are ready."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  async function transact() {
    if (!signer) return connect();
    let value: bigint;
    try { value = BigInt(amount); } catch { setFailure("Enter a whole-number demo amount."); return; }
    if (value <= 0n) return setFailure("Enter an amount greater than zero.");
    try { setFailure(""); setBusy(saveMode); setNotice(saveMode === "deposit" ? "Encrypting your deposit locally…" : "Encrypting your withdrawal request locally…"); if (saveMode === "deposit") await sealDeposit(signer, value, setNotice); else await withdrawPrivate(signer, value); setAmount(""); setPrivatePosition(undefined); setPrivateRound(undefined); await refresh(signer); setNotice(saveMode === "deposit" ? "Private deposit processed. The amount was never published as plaintext." : "Private withdrawal request processed. Unveil your vault to verify the resulting position privately."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  async function fund() {
    if (!signer) return connect();
    try { setFailure(""); setBusy("fund"); setNotice("Requesting 100 test-only cUSD…"); await fundDemoWallet(signer, 100n); setNotice("100 demo cUSD funded. This faucet exists only for the Sepolia demo."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  async function unveil() {
    if (!signer) return connect();
    if (!data?.joined) { navigate("/app/save"); setNotice("Save privately first, then your vault can be unveiled."); return; }
    try { setFailure(""); setBusy("unveil"); setNotice("Sign once to decrypt your private position for this session…"); const position = await revealPrivatePosition(signer); setPrivatePosition(position); if (data.latestRound > 0n && data.inLatestRound) setPrivateRound(await revealRoundStats(signer, data.latestRound)); setNotice("Private stats unveiled locally. They were not published to the chain."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  function veil() { setPrivatePosition(undefined); setPrivateRound(undefined); setRevealedPrizes({}); setNotice("Private values veiled again in this interface."); }

  async function renew() {
    if (!signer) return connect();
    try { setFailure(""); setBusy("renew"); await renewDrawSeat(signer); await refresh(signer); setNotice("Draw eligibility renewed without revealing or changing your principal."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  async function maintain() {
    if (!signer) return connect();
    try { setFailure(""); setBusy("maintain"); const result = await advanceRoundMaintenance(signer, setNotice); await refresh(signer); if (result === "waiting") setNotice("Protocol is caught up. The next draw remains open."); else if (result === "awaiting-yield") setNotice("The draw is settled. The strategy still needs to seal this round's confidential realized-yield bucket before any keeper can route it."); else setNotice(`Permissionless protocol step completed: ${result}.`); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  async function revealWin(roundId: bigint) {
    if (!signer) return connect();
    try { setFailure(""); setBusy("prize"); setNotice("Requesting winner-only prize decryption…"); const prize = await revealPrize(signer, roundId); setRevealedPrizes((current) => ({ ...current, [roundId.toString()]: prize })); setNotice("Prize amount unveiled only to this winner session."); }
    catch (error) { setFailure(userMessage(error)); } finally { setBusy(""); }
  }

  function startGuide() { setGuideStep(0); setGuideOpen(true); navigate("/app"); }

  if (route === "/") return <><Landing navigate={navigate} publicState={publicState} startGuide={startGuide} />{guideOpen && <Guide step={guideStep} setStep={setGuideStep} close={() => setGuideOpen(false)} navigate={navigate} />}</>;
  if (route === "/protocol") return <ProtocolPage navigate={navigate} />;

  const state = data ?? publicState;
  let page: React.ReactNode;
  if (route === "/app/save") page = <SavePage address={address} data={data} mode={saveMode} setMode={setSaveMode} amount={amount} setAmount={setAmount} busy={busy} transact={transact} fund={fund} />;
  else if (route === "/app/draws") page = <DrawsPage state={state} now={now} busy={busy} maintain={maintain} />;
  else if (route === "/app/vault") page = <VaultPage data={data} position={privatePosition} roundStats={privateRound} busy={busy} unveil={unveil} veil={veil} renew={renew} />;
  else if (route === "/app/prizes") page = <PrizesPage address={address} state={state} revealedPrizes={revealedPrizes} busy={busy} revealWin={revealWin} maintain={maintain} />;
  else if (route === "/app/history") page = <HistoryPage state={state} />;
  else page = <OverviewPage data={data} publicState={publicState} privatePosition={privatePosition} privateRound={privateRound} now={now} navigate={navigate} unveil={unveil} />;

  return <><AppShell route={route} navigate={navigate} address={address} busy={busy} connect={connect} startGuide={startGuide}>{page}</AppShell>{(notice || failure) && <div className={`activity-toast ${failure ? "error" : ""}`}><i /><div><span>{failure ? "ACTION NEEDS ATTENTION" : "PRIVATE ACTIVITY"}</span><p>{failure || notice}</p></div><button onClick={() => { setFailure(""); setNotice(""); }}>×</button></div>}{guideOpen && <Guide step={guideStep} setStep={setGuideStep} close={() => setGuideOpen(false)} navigate={navigate} />}</>;
}
