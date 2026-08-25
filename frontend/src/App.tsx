import { useMemo, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { UNVEIL_CONTRACTS, UNVEIL_NETWORK } from "./contracts";
import {
  connectWallet,
  fundDemoWallet,
  isConnectedWinner,
  readDashboard,
  renewDrawSeat,
  revealMyRoundWeight,
  revealMyVault,
  revealPrize,
  sealDeposit,
  withdrawPrivate,
  type MyVault,
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
  if (message.startsWith("UNVEIL_TEST_FUNDING_FAILED:"))
    return "TEST TOKEN mint, approval, or wrapping failed. Existing wrapped TEST principal can still be deposited.";
  if (message.startsWith("UNVEIL_OPERATOR_AUTH_FAILED:"))
    return "Pool authorization failed. Approve the confidential principal operator transaction and retry.";
  if (message.startsWith("UNVEIL_ENCRYPTION_FAILED:"))
    return "UNVEIL could not encrypt this request. Check your connection, reconnect, and retry.";
  if (message.startsWith("UNVEIL_DEPOSIT_FAILED:")) return "The encrypted deposit was rejected by the V2 pool.";
  if (message.startsWith("UNVEIL_WITHDRAW_FAILED:"))
    return "The private withdrawal request was rejected by the V2 pool.";
  if (message.startsWith("UNVEIL_PRIZE_WINNER_ONLY:"))
    return "This prize can be revealed only by the finalized winner after automatic delivery.";
  if (message.startsWith("UNVEIL_ROUND_WEIGHT_UNAVAILABLE:"))
    return "Personal draw weight is unavailable because this wallet was not included in that round.";
  if (message.startsWith("UNVEIL_MANAGER_REQUEST_UNAVAILABLE:"))
    return "The manager could not provide this withdrawal request yet. Refresh after Sepolia confirms its state.";
  if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("did not respond"))
    return "The wallet, relayer, or Sepolia request timed out. Check wallet activity before retrying.";
  if (message.includes("CALL_EXCEPTION") || message.includes("missing revert data"))
    return "That action is not available for this wallet right now.";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("sepolia"))
    return "UNVEIL could not reach Sepolia. Check your wallet network and try again.";
  return "The action could not be completed. Please try again.";
}

function explorerAddress(address: string) {
  return `${UNVEIL_NETWORK.explorer}/address/${address}`;
}

function formatTime(timestamp?: bigint) {
  if (!timestamp) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
          <p>Private positions. Blind selection. Verifiable winners.</p>
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
        <span className="demo-warning">SEPOLIA TEST/DEMO · SIMULATED ERC4626</span>
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
          <span className="history-kicker">
            <i /> LIVE V2 SEPOLIA STATE
          </span>
          <h2>
            {rounds.length} SETTLED ROUND{rounds.length === 1 ? "" : "S"} LOADED.
          </h2>
          <p>FINALIZED, KMS-zero CANCELLED, and insufficient-participant SKIPPED states are kept distinct.</p>
        </div>
        <a className="explorer-link" href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          VIEW V2 POOL ON ETHERSCAN ↗
        </a>
      </div>
      {rounds.length === 0 ? (
        <div className="history-proof">
          <div className="proof-detail">
            <strong>CONNECT WALLET TO LOAD ROUND HISTORY</strong>
          </div>
        </div>
      ) : (
        rounds.map((round) => (
          <div className="history-proof" key={round.id.toString()}>
            <div className="proof-number">
              <span>ROUND</span>
              <strong>{round.id.toString().padStart(2, "0")}</strong>
              <small>{round.status}</small>
            </div>
            <div className="proof-detail">
              <span>{round.status === "FINALIZED" ? "WINNER" : "RESULT"}</span>
              {round.status === "FINALIZED" && round.winner ? (
                <>
                  <strong>{shortAddress(round.winner)}</strong>
                  <a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">
                    {round.winner} ↗
                  </a>
                </>
              ) : round.status === "CANCELLED" ? (
                <>
                  <strong>KMS-PROVEN ZERO WINNER</strong>
                  <small>BlindDraw ran; encrypted weight selected no winner.</small>
                </>
              ) : (
                <>
                  <strong>INSUFFICIENT PARTICIPANTS</strong>
                  <small>No BlindDraw and no encrypted winner handle.</small>
                </>
              )}
            </div>
            <div className="proof-detail">
              <span>CONFIDENTIAL PRIZE</span>
              <strong>{round.processedPrize ? "PRIZE DELIVERED" : "NOT PROCESSED"}</strong>
              <small>Delivered share values remain winner-private.</small>
            </div>
            <div className="proof-detail">
              <span>VERIFICATION</span>
              <strong className="pass-mark">ONCHAIN</strong>
              <small>
                {round.status === "SKIPPED" ? "Scheduled close-time participant check" : "Zama/KMS proof-gated result"}
              </small>
            </div>
            <div className="proof-detail">
              <span>SNAPSHOT</span>
              <strong>
                {round.participantCount} POSITION{round.participantCount === 1 ? "" : "S"}
              </strong>
              <small>snapshot block {round.snapshotBlock.toString()}</small>
            </div>
          </div>
        ))
      )}
      <div className="proof-contracts">
        <a href={explorerAddress(UNVEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">
          <span>V2 POOL</span>
          <code>{shortAddress(UNVEIL_CONTRACTS.pool)}</code>
        </a>
        <a href={explorerAddress(UNVEIL_CONTRACTS.manager)} target="_blank" rel="noreferrer">
          <span>MANAGER</span>
          <code>{shortAddress(UNVEIL_CONTRACTS.manager)}</code>
        </a>
        <a href={explorerAddress(UNVEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer">
          <span>PRIZE VAULT</span>
          <code>{shortAddress(UNVEIL_CONTRACTS.prizeVault)}</code>
        </a>
        <a href={explorerAddress(UNVEIL_CONTRACTS.principal)} target="_blank" rel="noreferrer">
          <span>TEST PRINCIPAL</span>
          <code>{shortAddress(UNVEIL_CONTRACTS.principal)}</code>
        </a>
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
  const [vault, setVault] = useState<MyVault>();
  const [roundWeight, setRoundWeight] = useState<{ roundId: bigint; value: bigint }>();
  const [prize, setPrize] = useState<{ roundId: bigint; value: bigint }>();
  const [faucetUsed, setFaucetUsed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Connect your wallet to read your V2 position and schedule.");
  const [failure, setFailure] = useState("");

  async function refresh(active = signer) {
    if (active) setData(await readDashboard(active));
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
          ? "Wallet connected to live V2. Private values remain sealed until you reveal them."
          : "Wallet connected to live V2. Existing wrapped TEST principal can be deposited directly.",
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
      setNotice("Checking wrapped TEST principal before minting…");
      const result = await fundDemoWallet(signer, 100n);
      setFaucetUsed(true);
      setNotice(
        result.alreadyFunded
          ? "Wallet already has at least 100 wrapped TEST principal; nothing was minted."
          : `${result.wrapped} TEST TOKEN unit${result.wrapped === 1n ? "" : "s"} wrapped as confidential principal.`,
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function revealVault() {
    if (!signer) return connect();
    try {
      setFailure("");
      setBusy("reveal");
      setNotice("Requesting one wallet-authorized private decryption…");
      setVault(await revealMyVault(signer));
      setNotice("Your active, reserved, and strategy-share balances were decrypted only for this wallet session.");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function revealWeight() {
    if (!signer) return connect();
    const roundId = data?.latestRound ?? 0n;
    if (roundId === 0n) {
      setFailure("No historical round is available yet.");
      return;
    }
    try {
      setFailure("");
      setBusy("weight");
      setRoundWeight({ roundId, value: await revealMyRoundWeight(signer, roundId) });
      setNotice(`Your Round ${roundId} snapshot weight was decrypted locally. Exact odds remain unavailable.`);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function revealDeliveredPrize() {
    if (!signer || !data?.latestFinalized) return;
    try {
      setFailure("");
      setBusy("prize");
      setPrize({ roundId: data.latestFinalized.id, value: await revealPrize(signer, data.latestFinalized.id) });
      setNotice("The automatically delivered strategy-share prize was decrypted only for the winning wallet.");
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
      setNotice("Draw seat renewed without exposing or changing principal.");
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function transact() {
    if (!signer) return connect();
    if (panel === "withdraw" && !data?.joined) {
      setPanel("deposit");
      setNotice("Create a private position before withdrawing.");
      return;
    }
    let value: bigint;
    try {
      value = BigInt(amount);
    } catch {
      setFailure("Enter a whole-number TEST amount.");
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
      if (panel === "deposit") {
        await sealDeposit(signer, value, setNotice);
        setNotice("Private V2 deposit confirmed. Reveal My Vault to verify the resulting position.");
      } else {
        const result = await withdrawPrivate(signer, value);
        setNotice(
          `Withdrawal request ${result.requestId} recorded: ${result.request.status}. Queued requests wait for permissionless strategy settlement.`,
        );
      }
      setAmount("");
      setVault(undefined);
      await refresh(signer);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  const participants = data?.playerCount ?? 0;
  const schedule = data?.schedule;
  const round = schedule?.currentRoundId ?? 1n;
  const joined = data?.joined ?? false;
  const seated = data?.seated ?? false;
  const drawLabel = schedule?.insufficientParticipants
    ? "INSUFFICIENT"
    : schedule?.ready
      ? "READY"
      : schedule?.timeReady
        ? "CLOSED"
        : "OPEN";
  const latestFinalized = data?.latestFinalized;
  const mayRevealPrize = Boolean(latestFinalized?.processedPrize && isConnectedWinner(address, latestFinalized));
  const showFaucet = Boolean(address) && !faucetUsed;

  return (
    <main className="dashboard">
      <Header onHome={home} address={address} busy={busy === "connect"} onConnect={connect} />
      <section className="dashboard-grid" id="pool">
        <aside className="left-rail">
          <div className="section-kicker">YOUR V2 VAULT</div>
          <div className="private-balance">
            <span>{vault ? vault.activePrincipal.toString() : "••••••"}</span>
            <small>TEST PRINCIPAL</small>
          </div>
          <div className="sealed-row">
            <span className="lock-dot">⌾</span> {joined ? "SEALED" : "NOT ENTERED"}
          </div>
          <button className="outline" disabled={!!busy} onClick={vault ? () => setVault(undefined) : revealVault}>
            {busy === "reveal"
              ? "DECRYPTING…"
              : vault
                ? "HIDE PRIVATE VALUES"
                : address
                  ? "REVEAL MY VAULT"
                  : "CONNECT TO REVEAL"}
          </button>
          <div className="privacy-lines">
            <p>
              <span>Reserved principal</span>
              <strong>{vault ? vault.reservedPrincipal.toString() : joined ? "ENCRYPTED" : "0"}</strong>
            </p>
            <p>
              <span>Strategy shares</span>
              <strong>{vault ? vault.strategySharePrizeBalance.toString() : "ENCRYPTED"}</strong>
            </p>
            <p>
              <span>My draw weight</span>
              <strong>{roundWeight ? `${roundWeight.value} · R${roundWeight.roundId}` : "ENCRYPTED"}</strong>
            </p>
            <p>
              <span>My odds</span>
              <strong>NOT DERIVABLE</strong>
            </p>
          </div>
          {joined && !seated && (
            <button className="outline" disabled={!!busy} onClick={renewSeat}>
              {busy === "seat" ? "RENEWING…" : "RENEW DRAW SEAT"}
            </button>
          )}
          {data?.latestRound && data.latestRound > 0n && (
            <button className="outline secondary-action" disabled={!!busy} onClick={revealWeight}>
              {busy === "weight" ? "DECRYPTING…" : `REVEAL ROUND ${data.latestRound} WEIGHT`}
            </button>
          )}
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
              {busy === "fund" ? "FUNDING…" : "OPTIONAL: GET 100 TEST TOKEN"}
            </button>
          )}
          <div className="amount-box">
            <label>{panel === "deposit" ? "Amount to seal" : "Amount to request"}</label>
            <div>
              <input
                aria-label="Amount"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              />
              <b>TEST</b>
            </div>
          </div>
          <button className="primary full" disabled={!!busy || !amount} onClick={transact}>
            {busy === panel
              ? panel === "deposit"
                ? "SEALING…"
                : "REQUESTING…"
              : panel === "deposit"
                ? "SEAL DEPOSIT"
                : "REQUEST WITHDRAWAL"}
          </button>
          <small className="microcopy">
            {panel === "withdraw"
              ? "A request may settle instantly or queue for strategy liquidity. No encrypted amount is displayed."
              : "TEST/DEMO token only. This is not USDC, cUSDC, Steakhouse, or production market yield."}
          </small>
        </aside>

        <section className="draw-stage" id="draw">
          <div className="round-head">
            <div>
              <span>CURRENT ROUND</span>
              <strong>{round.toString().padStart(2, "0")}</strong>
            </div>
            <div className="round-state">
              <i /> {drawLabel}
            </div>
            <div className="countdown">
              <span>SCHEDULED CLOSE</span>
              <strong>{formatTime(schedule?.closesAt)}</strong>
            </div>
          </div>
          <div className="draw-visual">
            <VeilField compact />
            <div className="draw-copy">
              <span>LIVE CONTRACT SCHEDULE</span>
              <h2>
                {participants} POSITION{participants === 1 ? "" : "S"}.<br />
                ZERO BALANCES EXPOSED.
              </h2>
              <p>
                Opens {formatTime(schedule?.opensAt)} · closes {formatTime(schedule?.closesAt)}. BlindDraw operates on
                encrypted snapshot weights.
              </p>
            </div>
          </div>
          <div className="draw-stats">
            <div>
              <span>Participants</span>
              <strong>{participants}</strong>
            </div>
            <div>
              <span>Unsettled rounds</span>
              <strong>{schedule?.unsettledRounds.toString() ?? "—"}</strong>
            </div>
            <div>
              <span>Can advance</span>
              <strong>{schedule?.canAdvance ? "YES" : "NO"}</strong>
            </div>
            <div>
              <span>Overdue</span>
              <strong>{schedule?.overdue ? "YES" : "NO"}</strong>
            </div>
          </div>
          <div className="lifecycle">
            {["OPEN", "SNAPSHOT", "BLIND DRAW", "FINALIZE", "DELIVER"].map((step, index) => (
              <div
                className={
                  (index === 0 && !schedule?.timeReady) || (index === 1 && schedule?.canAdvance) ? "current" : ""
                }
                key={step}
              >
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
              <strong>{failure ? "Action needs attention" : "UNVEIL V2 session"}</strong>
              <p>{failure || notice}</p>
              <small>NOW</small>
            </div>
          </div>
          {data?.latestWithdrawal && (
            <div className="prize-card">
              <span>WITHDRAWAL REQUEST {data.latestWithdrawal.requestId.toString()}</span>
              <h3>{data.latestWithdrawal.status}</h3>
              <p>
                {data.latestWithdrawal.committed ? "Committed to strategy settlement. " : ""}The request amount remains
                encrypted.
              </p>
            </div>
          )}
          <div className="prize-card">
            <span>{latestFinalized ? `ROUND ${latestFinalized.id} · PRIZE` : "PRIZE STATUS"}</span>
            <h3>{latestFinalized?.processedPrize ? "PRIZE DELIVERED" : "NO PROCESSED PRIZE"}</h3>
            <p>V2 delivers confidential strategy shares automatically. There is no authorize or claim transaction.</p>
            {prize && (
              <strong>
                {prize.value.toString()} PRIVATE SHARE UNIT{prize.value === 1n ? "" : "S"}
              </strong>
            )}
            {mayRevealPrize && !prize && (
              <button className="outline" disabled={!!busy} onClick={revealDeliveredPrize}>
                {busy === "prize" ? "DECRYPTING…" : "REVEAL DELIVERED PRIZE"}
              </button>
            )}
          </div>
          <div className="proof-card">
            <span>LIVE V2 POOL</span>
            <code>
              {UNVEIL_CONTRACTS.pool.slice(0, 10)}…{UNVEIL_CONTRACTS.pool.slice(-6)}
            </code>
            <small>Sepolia · TEST/DEMO simulated strategy</small>
          </div>
        </aside>
      </section>

      <VerifiedHistory rounds={data?.history ?? []} />
      <section className="protocol-strip" id="protocol">
        <div>
          <span>01</span>
          <strong>DEPOSIT</strong>
          <p>TEST principal is wrapped, then encrypted before it reaches the V2 pool.</p>
        </div>
        <div>
          <span>02</span>
          <strong>SNAPSHOT</strong>
          <p>Fixed-schedule encrypted weights freeze without revealing balances.</p>
        </div>
        <div>
          <span>03</span>
          <strong>BLIND DRAW</strong>
          <p>Winner selection executes over ciphertexts.</p>
        </div>
        <div>
          <span>04</span>
          <strong>FINALIZE</strong>
          <p>The KMS-proof-gated winner becomes publicly verifiable.</p>
        </div>
        <div>
          <span>05</span>
          <strong>DELIVER</strong>
          <p>Processed strategy-share prizes transfer automatically and remain winner-private.</p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>("landing");
  function showProtocol() {
    setView("app");
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => document.getElementById("protocol")?.scrollIntoView()),
    );
  }
  return view === "landing" ? (
    <Landing enter={() => setView("app")} showProtocol={showProtocol} />
  ) : (
    <Dashboard home={() => setView("landing")} />
  );
}
