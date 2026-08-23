import { useMemo, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { VEIL_CONTRACTS } from "./contracts";
import {
  connectWallet,
  fundDemoWallet,
  readDashboard,
  renewDrawSeat,
  revealPrivateBalance,
  sealDeposit,
  withdrawPrivate,
} from "./veilClient";

type View = "landing" | "app";
type Panel = "deposit" | "withdraw";
type DashboardData = Awaited<ReturnType<typeof readDashboard>>;

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : "";

  if (code === 4001 || message.toLowerCase().includes("user rejected")) return "Request cancelled in your wallet.";
  if (message.includes("INSUFFICIENT_FUNDS") || message.toLowerCase().includes("insufficient funds"))
    return "Not enough Sepolia ETH to pay gas for this action.";
  if (message.startsWith("VEIL_DEMO_FUNDING_FAILED:"))
    return "Optional demo funding failed. You can still deposit if this wallet already has demo cUSD.";
  if (message.startsWith("VEIL_OPERATOR_AUTH_FAILED:"))
    return "Pool authorization failed. Approve the operator transaction in your wallet and retry.";
  if (message.startsWith("VEIL_ENCRYPTION_FAILED:"))
    return "VEIL could not encrypt this request. Check your connection, reconnect the wallet, and retry.";
  if (message.startsWith("VEIL_DEPOSIT_FAILED:"))
    return "The encrypted deposit was rejected. Check the VEIL console entry for the exact contract or wallet reason.";
  if (message.startsWith("VEIL_WITHDRAW_FAILED:"))
    return "The private withdrawal was rejected. Check the VEIL console entry for the exact reason.";
  if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("did not respond"))
    return "The wallet or Sepolia request timed out. Check MetaMask activity before retrying.";
  if (message.includes("CALL_EXCEPTION") || message.includes("missing revert data"))
    return "That action is not available for this wallet right now.";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("sepolia"))
    return "VEIL could not reach Sepolia. Check your wallet network and try again.";
  return "The action could not be completed. Please try again.";
}

function explorerAddress(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`;
}

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

function Header({
  onHome,
  address,
  busy,
  onConnect,
}: {
  onHome: () => void;
  address?: string;
  busy?: boolean;
  onConnect?: () => void;
}) {
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
        <span className="network">
          <i /> Sepolia
        </span>
        <span className="icon-button" aria-hidden="true">
          ⌁
        </span>
        <button className="wallet" disabled={busy} onClick={onConnect}>
          {busy ? "CONNECTING…" : address ? shortAddress(address) : "Connect wallet"}
        </button>
      </div>
    </header>
  );
}

function Landing({ enter, showProtocol }: { enter: () => void; showProtocol: () => void }) {
  return (
    <main className="landing">
      <Header onHome={() => undefined} />
      <section className="hero-shell">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> PRIVATE PRIZE SAVINGS · POWERED BY FHE
          </div>
          <h1>
            NOTHING TO SEE.
            <br />
            <em>EVERYTHING TO VERIFY.</em>
          </h1>
          <p>Private yield. Blind selection. Verifiable winners.</p>
          <div className="hero-actions">
            <button className="primary" onClick={enter}>
              ENTER VEIL <b>↗</b>
            </button>
            <button className="text-button" onClick={showProtocol}>
              How it works <span>→</span>
            </button>
          </div>
          <div className="privacy-note">
            BALANCES · WEIGHTS · PRIZES <strong>STAY ENCRYPTED</strong>
          </div>
        </div>
        <div className="hero-visual">
          <VeilField />
          <div className="hero-caption">
            <span>ENCRYPTED FIELD</span>
            <span>FHE ACTIVE</span>
          </div>
        </div>
      </section>
      <footer className="landing-footer">
        <span>Powered by Zama FHE</span>
        <span className="demo-warning">SEPOLIA DEMO · TEST ASSET</span>
        <span>VEIL · PRIVATE BY DEFAULT</span>
      </footer>
    </main>
  );
}

function VerifiedHistory({ rounds }: { rounds: DashboardData["history"] }) {
  return (
    <section className="verified-history" id="history">
      <div className="history-heading">
        <div>
          <span className="history-kicker"><i /> LIVE SEPOLIA PROOF</span>
          <h2>{rounds.length} ROUND{rounds.length === 1 ? "" : "S"}. ONCHAIN VERIFIED.</h2>
          <p>Finalized winners and KMS-proven cancellations read directly from the hardened Sepolia deployment.</p>
        </div>
        <a className="explorer-link" href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VIEW POOL ON ETHERSCAN ↗</a>
      </div>
      {rounds.length === 0 ? (
        <div className="history-proof"><div className="proof-detail"><strong>CONNECT WALLET TO LOAD ROUND HISTORY</strong></div></div>
      ) : rounds.map((round) => (
        <div className="history-proof" key={round.id.toString()}>
          <div className="proof-number">
            <span>ROUND</span>
            <strong>{round.id.toString().padStart(2, "0")}</strong>
            <small>{round.cancelled ? "CANCELLED" : "FINALIZED"}</small>
          </div>
          <div className="proof-detail">
            <span>{round.cancelled ? "RESULT" : "WINNER"}</span>
            {round.cancelled ? (
              <><strong>NO ELIGIBLE WEIGHT</strong><small>KMS proved a zero winner without exposing balances.</small></>
            ) : (
              <><strong>{shortAddress(round.winner)}</strong><a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">{round.winner} ↗</a></>
            )}
          </div>
          <div className="proof-detail">
            <span>CONFIDENTIAL PRIZE</span>
            <strong>{round.cancelled ? "NOT ALLOCATED" : round.funded ? "ENCRYPTED PRIZE FUNDED" : "NO PRIZE FUNDED"}</strong>
            <small>Prize values remain hidden from the public chain.</small>
          </div>
          <div className="proof-detail">
            <span>VERIFICATION</span>
            <strong className="pass-mark">PASS</strong>
            <small>{round.cancelled ? "KMS zero-winner proof · cancelled onchain" : "KMS winner proof · finalized onchain"}</small>
          </div>
          <div className="proof-detail">
            <span>{round.cancelled ? "SNAPSHOT" : "CLAIM"}</span>
            <strong>{round.cancelled ? round.participantCount.toString() + " POSITIONS" : round.claimed ? "CLAIMED" : round.winnerAuthorized ? "AUTHORIZED" : "PENDING"}</strong>
            <small>snapshot block {round.snapshotBlock.toString()}</small>
          </div>
        </div>
      ))}
      <div className="proof-contracts">
        <a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer"><span>POOL</span><code>{shortAddress(VEIL_CONTRACTS.pool)}</code></a>
        <a href={explorerAddress(VEIL_CONTRACTS.yieldSource)} target="_blank" rel="noreferrer"><span>YIELD SOURCE</span><code>{shortAddress(VEIL_CONTRACTS.yieldSource)}</code></a>
        <a href={explorerAddress(VEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer"><span>PRIZE VAULT</span><code>{shortAddress(VEIL_CONTRACTS.prizeVault)}</code></a>
        <a href={explorerAddress(VEIL_CONTRACTS.asset)} target="_blank" rel="noreferrer"><span>DEMO ASSET</span><code>{shortAddress(VEIL_CONTRACTS.asset)}</code></a>
      </div>
    </section>
  );
}
function Dashboard({ home }: { home: () => void }) {
  const [signer, setSigner] = useState<JsonRpcSigner>();
  const [address, setAddress] = useState("");
  const [data, setData] = useState<DashboardData>();
  const [panel, setPanel] = useState<Panel>("deposit");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint>();
  const [faucetUsed, setFaucetUsed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Connect your wallet to read your encrypted position.");
  const [failure, setFailure] = useState("");

  async function refresh(active = signer) {
    if (!active) return;
    setData(await readDashboard(active));
  }

  async function connect() {
    try {
      setFailure("");
      setBusy("connect");
      const wallet = await connectWallet();
      setSigner(wallet.signer);
      setAddress(wallet.address);
      const dashboard = await readDashboard(wallet.signer);
      setData(dashboard);
      setNotice(
        dashboard.joined
          ? dashboard.seated
            ? "Wallet connected. Your private position is sealed and your draw seat is active."
            : "Wallet connected. Your private position is sealed. Renew the draw seat to enter the next snapshot."
          : "Wallet connected. Deposit directly if this wallet already has demo cUSD; the faucet below is optional.",
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function fund() {
    if (!signer) return connect();
    try {
      setFailure("");
      setBusy("fund");
      setNotice("Requesting 100 test-only cUSD for this Sepolia wallet…");
      await fundDemoWallet(signer, 100n);
      setFaucetUsed(true);
      setNotice("100 demo cUSD funded. You can now seal a private deposit.");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function reveal() {
    if (!signer) return connect();
    if (!data?.joined) {
      setFailure("");
      setPanel("deposit");
      setNotice("Deposit into VEIL first to create a private position, then you can reveal it privately.");
      return;
    }

    try {
      setFailure("");
      setBusy("reveal");
      setNotice("Requesting private decryption signature…");
      setBalance(await revealPrivateBalance(signer));
      setNotice("Balance decrypted locally for this wallet session.");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function renewSeat() {
    if (!signer) return connect();
    try {
      setFailure("");
      setBusy("seat");
      setNotice("Renewing your temporary BlindDraw seat…");
      await renewDrawSeat(signer);
      await refresh(signer);
      setNotice("Draw seat renewed. Your private balance was not exposed or changed.");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function transact() {
    if (!signer) return connect();
    if (panel === "withdraw" && !data?.joined) {
      setFailure("");
      setPanel("deposit");
      setNotice("Create a private position with a deposit before withdrawing.");
      return;
    }

    let value: bigint;
    try {
      value = BigInt(amount);
    } catch {
      setFailure("Enter a whole-number demo amount.");
      return;
    }

    if (value <= 0n) {
      setFailure("Enter an amount greater than zero.");
      return;
    }

    try {
      setFailure("");
      setBusy(panel);
      setNotice(panel === "deposit" ? "Encrypting deposit before submission…" : "Encrypting withdrawal request…");
      if (panel === "deposit") await sealDeposit(signer, value, setNotice);
      else await withdrawPrivate(signer, value);
      setAmount("");
      setBalance(undefined);
      await refresh(signer);
      setNotice(
        panel === "deposit"
          ? "Private deposit request processed on Sepolia. Reveal locally to verify the resulting position."
          : "Private withdrawal request processed on Sepolia. Reveal locally to verify the resulting position.",
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  const participants = data?.playerCount ?? 0;
  const round = data?.nextRoundId ?? 1n;
  const joined = data?.joined ?? false;
  const seated = data?.seated ?? false;
  const revealLabel =
    busy === "reveal"
      ? "DECRYPTING…"
      : balance !== undefined
        ? "HIDE"
        : !address
          ? "CONNECT TO REVEAL"
          : !joined
            ? "JOIN TO REVEAL"
            : "REVEAL TO ME";
  const revealAction = balance !== undefined ? () => setBalance(undefined) : reveal;
  const showFaucet = Boolean(address) && !joined && !faucetUsed;

  return (
    <main className="dashboard">
      <Header onHome={home} address={address} busy={busy === "connect"} onConnect={connect} />
      <section className="dashboard-grid" id="pool">
        <aside className="left-rail">
          <div className="section-kicker">YOUR POSITION</div>
          <div className="private-balance">
            <span>{balance === undefined ? "••••••" : balance.toString()}</span>
            <small>cUSD</small>
          </div>
          <div className="sealed-row">
            <span className="lock-dot">⌾</span> {joined ? "SEALED" : "NOT ENTERED"}
          </div>
          {joined && (
            <div className="privacy-lines">
              <p><span>Next draw seat</span><strong>{seated ? "ACTIVE" : "RENEW"}</strong></p>
            </div>
          )}
          {joined && !seated && (
            <button className="outline" disabled={!!busy} onClick={renewSeat}>
              {busy === "seat" ? "RENEWING…" : "RENEW DRAW SEAT"}
            </button>
          )}
          <button className="outline" disabled={!!busy} onClick={revealAction}>
            {revealLabel}
          </button>
          <div className="privacy-lines">
            <p>
              <span>Your weight</span>
              <strong>{joined ? "ENCRYPTED" : "—"}</strong>
            </p>
            <p>
              <span>Your odds</span>
              <strong>{joined ? "PRIVATE" : "—"}</strong>
            </p>
            <p>
              <span>Withdrawals</span>
              <strong>{joined ? "PRIVATE" : "—"}</strong>
            </p>
          </div>
          <div className="action-tabs">
            <button className={panel === "deposit" ? "active" : ""} onClick={() => setPanel("deposit")}>
              Deposit
            </button>
            <button
              className={panel === "withdraw" ? "active" : ""}
              disabled={!!address && !joined}
              onClick={() => setPanel("withdraw")}
            >
              Withdraw
            </button>
          </div>
          {showFaucet && (
            <button className="outline faucet-button" disabled={!!busy} onClick={fund}>
              {busy === "fund" ? "FUNDING…" : "OPTIONAL: GET 100 DEMO cUSD"}
            </button>
          )}
          <div className="amount-box">
            <label>{panel === "deposit" ? "Amount to seal" : "Amount to withdraw"}</label>
            <div>
              <input
                aria-label="Amount"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              />
              <b>cUSD</b>
            </div>
          </div>
          <button className="primary full" disabled={!!busy || !amount} onClick={transact}>
            {busy === panel
              ? panel === "deposit"
                ? "SEALING…"
                : "WITHDRAWING…"
              : panel === "deposit"
                ? "SEAL DEPOSIT"
                : "WITHDRAW PRIVATELY"}
          </button>
          <small className="microcopy">
            {joined
              ? "Amounts never appear in VEIL events."
              : "Already funded? Deposit directly. The test-only faucet is optional."}
          </small>
        </aside>

        <section className="draw-stage" id="draw">
          <div className="round-head">
            <div>
              <span>NEXT ROUND</span>
              <strong>{round.toString().padStart(2, "0")}</strong>
            </div>
            <div className="round-state">
              <i /> LIVE
            </div>
            <div className="countdown">
              <span>NETWORK</span>
              <strong>SEPOLIA</strong>
            </div>
          </div>
          <div className="draw-visual">
            <VeilField compact />
            <div className="draw-copy">
              <span>ENCRYPTED POOL</span>
              <h2>
                {participants} POSITION{participants === 1 ? "" : "S"}.
                <br />
                ZERO BALANCES EXPOSED.
              </h2>
              <p>
                BlindDraw operates on encrypted participant weights. The public chain never receives plaintext deposit amounts.
              </p>
            </div>
          </div>
          <div className="draw-stats">
            <div>
              <span>Participants</span>
              <strong>{participants}</strong>
            </div>
            <div>
              <span>Your position</span>
              <strong>{joined ? "SEALED" : "—"}</strong>
            </div>
            <div>
              <span>Latest round</span>
              <strong>{data?.latestRound?.toString() ?? "0"}</strong>
            </div>
            <div>
              <span>Proof</span>
              <strong>ONCHAIN</strong>
            </div>
          </div>
          <div className="lifecycle">
            {["OPEN", "SNAPSHOT", "BLIND DRAW", "REVEAL", "SETTLE"].map((step, index) => (
              <div className={index === 0 ? "current" : ""} key={step}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="right-rail">
          <div className="notifications-head">
            <span>ACTIVITY</span>
          </div>
          <div className="activity">
            <span>●</span>
            <div>
              <strong>{failure ? "Action needs attention" : "VEIL session"}</strong>
              <p>{failure || notice}</p>
              <small>NOW</small>
            </div>
          </div>
          <div className="prize-card">
            <span>{data?.latestRound && data.latestRound > 0n ? `ROUND ${data.latestRound.toString()} · PRIZE STATUS` : "PRIZE STATUS"}</span>
            <h3>
              {data?.prize?.claimed
                ? "PRIZE CLAIMED"
                : data?.prize?.funded
                  ? "ENCRYPTED PRIZE FUNDED"
                  : "NO UNCLAIMED PRIZE"}
            </h3>
            <p>Prize values stay encrypted until an authorized winner chooses to decrypt them.</p>
          </div>
          <div className="proof-card">
            <span>LIVE CONTRACT</span>
            <code>
              {VEIL_CONTRACTS.pool.slice(0, 10)}…{VEIL_CONTRACTS.pool.slice(-6)}
            </code>
            <small>Sepolia · demo deployment</small>
          </div>
        </aside>
      </section>

      <VerifiedHistory rounds={data?.history ?? []} />

      <section className="protocol-strip" id="protocol">
        <div>
          <span>01</span>
          <strong>DEPOSIT</strong>
          <p>Input is encrypted before it reaches VEIL.</p>
        </div>
        <div>
          <span>02</span>
          <strong>SNAPSHOT</strong>
          <p>Encrypted weights freeze without revealing balances.</p>
        </div>
        <div>
          <span>03</span>
          <strong>BLIND DRAW</strong>
          <p>Winner selection executes over ciphertexts.</p>
        </div>
        <div>
          <span>04</span>
          <strong>VERIFY</strong>
          <p>The final winner becomes publicly provable.</p>
        </div>
        <div>
          <span>05</span>
          <strong>CLAIM</strong>
          <p>Winner privately decrypts and claims. Prize value remains hidden from everyone else.</p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>("landing");

  function showProtocol() {
    setView("app");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.getElementById("protocol")?.scrollIntoView());
    });
  }

  return view === "landing" ? (
    <Landing enter={() => setView("app")} showProtocol={showProtocol} />
  ) : (
    <Dashboard home={() => setView("landing")} />
  );
}
