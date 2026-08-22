import { useMemo, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { VEIL_CONTRACTS } from "./contracts";
import { connectWallet, readDashboard, revealPrivateBalance, sealDeposit, withdrawPrivate } from "./veilClient";

type View = "landing" | "app";
type Panel = "deposit" | "withdraw";
type DashboardData = Awaited<ReturnType<typeof readDashboard>>;

const VERIFIED_ROUND = {
  id: 1,
  winner: "0xcC427b61573EEE146fc735159292f06E13bc8B80",
  prize: "15 encrypted token units",
  date: "21 AUG 2026",
};

function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function errorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? Number((error as { code?: unknown }).code) : undefined;
  const message = error instanceof Error ? error.message : "";
  if (code === 4001 || message.toLowerCase().includes("user rejected")) return "Request cancelled in your wallet.";
  if (message.includes("INSUFFICIENT_FUNDS") || message.toLowerCase().includes("insufficient funds")) return "Not enough Sepolia ETH to pay gas for this action.";
  if (message.includes("CALL_EXCEPTION") || message.includes("missing revert data")) return "That action is not available for this wallet right now.";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("sepolia")) return "VEIL could not reach Sepolia. Check your wallet network and try again.";
  return "The action could not be completed. Please try again.";
}
function explorerAddress(address: string) { return `https://sepolia.etherscan.io/address/${address}`; }

function VeilField({ compact = false }: { compact?: boolean }) {
  const particles = useMemo(() => Array.from({ length: compact ? 54 : 96 }, (_, i) => ({ left: `${(i * 37) % 100}%`, top: `${20 + ((i * 53) % 66)}%`, delay: `${(i % 17) * -0.27}s`, size: `${2 + (i % 4)}px` })), [compact]);
  return <div className={`veil-field ${compact ? "compact" : ""}`} aria-hidden="true"><div className="veil-glow"/><div className="veil-wave veil-wave-a"/><div className="veil-wave veil-wave-b"/><div className="veil-cut"/>{particles.map((p,i)=><span className={`particle ${i%11===0?"hot":""}`} key={i} style={{left:p.left,top:p.top,animationDelay:p.delay,width:p.size,height:p.size}}/>)}</div>;
}

function Header({ onHome, address, busy, onConnect }: { onHome:()=>void; address?:string; busy?:boolean; onConnect?:()=>void }) {
  return <header className="topbar"><button className="brand" onClick={onHome}><span className="brand-mark">V</span><span>VEIL</span></button><nav><a href="#pool">Pool</a><a href="#draw">Draw</a><a href="#history">History</a><a href="#protocol">Protocol</a></nav><div className="top-actions"><span className="network"><i/> Sepolia</span><button className="icon-button" aria-label="Notifications">⌁</button><button className="wallet" disabled={busy} onClick={onConnect}>{busy?"CONNECTING…":address?shortAddress(address):"Connect wallet"}</button></div></header>;
}

function Landing({ enter }: { enter:()=>void }) {
  return <main className="landing"><Header onHome={()=>undefined}/><section className="hero-shell"><div className="hero-copy"><div className="eyebrow"><span/> PRIVATE PRIZE SAVINGS · POWERED BY FHE</div><h1>NOTHING TO SEE.<br/><em>EVERYTHING TO VERIFY.</em></h1><p>Private yield. Blind selection. Verifiable winners.</p><div className="hero-actions"><button className="primary" onClick={enter}>ENTER VEIL <b>↗</b></button><a className="text-button" href="#protocol">How it works <span>→</span></a></div><div className="privacy-note">BALANCES · WEIGHTS · PRIZES <strong>STAY ENCRYPTED</strong></div></div><div className="hero-visual"><VeilField/><div className="hero-caption"><span>ENCRYPTED FIELD</span><span>FHE ACTIVE</span></div></div></section><footer className="landing-footer"><span>Powered by Zama FHE</span><span className="demo-warning">SEPOLIA DEMO · TEST ASSET</span><span>VEIL · PRIVATE BY DEFAULT</span></footer></main>;
}

function VerifiedHistory() {
  return <section className="verified-history" id="history"><div className="history-heading"><div><span className="history-kicker"><i/> LIVE SEPOLIA PROOF</span><h2>ONE ROUND. FULLY VERIFIED.</h2><p>This is observed deployment evidence, not placeholder dashboard data.</p></div><a className="explorer-link" href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VIEW POOL ON ETHERSCAN ↗</a></div><div className="history-proof"><div className="proof-number"><span>ROUND</span><strong>01</strong><small>FINALIZED</small></div><div className="proof-detail"><span>WINNER</span><strong>{shortAddress(VERIFIED_ROUND.winner)}</strong><a href={explorerAddress(VERIFIED_ROUND.winner)} target="_blank" rel="noreferrer">{VERIFIED_ROUND.winner} ↗</a></div><div className="proof-detail"><span>CONFIDENTIAL PRIZE</span><strong>{VERIFIED_ROUND.prize}</strong><small>Only the winner decrypted the prize value.</small></div><div className="proof-detail"><span>VERIFICATION</span><strong className="pass-mark">PASS</strong><small>KMS winner proof · confidential claim</small></div><div className="proof-detail"><span>OBSERVED</span><strong>{VERIFIED_ROUND.date}</strong><small>Sepolia end-to-end smoke run</small></div></div><div className="proof-contracts"><a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer"><span>POOL</span><code>{shortAddress(VEIL_CONTRACTS.pool)}</code></a><a href={explorerAddress(VEIL_CONTRACTS.yieldSource)} target="_blank" rel="noreferrer"><span>YIELD SOURCE</span><code>{shortAddress(VEIL_CONTRACTS.yieldSource)}</code></a><a href={explorerAddress(VEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer"><span>PRIZE VAULT</span><code>{shortAddress(VEIL_CONTRACTS.prizeVault)}</code></a><a href={explorerAddress(VEIL_CONTRACTS.asset)} target="_blank" rel="noreferrer"><span>DEMO ASSET</span><code>{shortAddress(VEIL_CONTRACTS.asset)}</code></a></div></section>;
}

function Dashboard({ home }: { home:()=>void }) {
  const [signer,setSigner]=useState<JsonRpcSigner>(); const [address,setAddress]=useState(""); const [data,setData]=useState<DashboardData>();
  const [panel,setPanel]=useState<Panel>("deposit"); const [amount,setAmount]=useState(""); const [balance,setBalance]=useState<bigint>();
  const [busy,setBusy]=useState(""); const [notice,setNotice]=useState("Connect your wallet to read your encrypted position."); const [failure,setFailure]=useState("");
  async function refresh(active=signer){ if(!active)return; setData(await readDashboard(active)); }
  async function connect(){ try{setFailure("");setBusy("connect");const wallet=await connectWallet();setSigner(wallet.signer);setAddress(wallet.address);const dashboard=await readDashboard(wallet.signer);setData(dashboard);setNotice(dashboard.joined?"Wallet connected. Your private position is sealed until you request decryption.":"Wallet connected. Deposit into VEIL to create your private position.");}catch(e){setFailure(errorMessage(e));}finally{setBusy("");} }
  async function reveal(){
    if(!signer)return connect();
    if(!data?.joined){setFailure("");setPanel("deposit");setNotice("Deposit into VEIL first to create a private position, then you can reveal it privately.");return;}
    try{setFailure("");setBusy("reveal");setNotice("Requesting private decryption signature…");setBalance(await revealPrivateBalance(signer));setNotice("Balance decrypted locally for this wallet session.");}catch(e){setFailure(errorMessage(e));}finally{setBusy("");}
  }
  async function transact(){
    if(!signer)return connect();
    if(panel==="withdraw"&&!data?.joined){setFailure("");setPanel("deposit");setNotice("Create a private position with a deposit before withdrawing.");return;}
    let value:bigint; try{value=BigInt(amount);}catch{setFailure("Enter a whole-number demo amount.");return;}
    try{setFailure("");setBusy(panel);setNotice(panel==="deposit"?"Encrypting deposit before submission…":"Encrypting withdrawal request…");if(panel==="deposit")await sealDeposit(signer,value);else await withdrawPrivate(signer,value);setAmount("");setBalance(undefined);await refresh(signer);setNotice(panel==="deposit"?"Deposit sealed and confirmed on Sepolia.":"Private withdrawal confirmed on Sepolia.");}catch(e){setFailure(errorMessage(e));}finally{setBusy("");}
  }
  const participants=data?.playerCount??0; const round=data?.nextRoundId??1n; const joined=data?.joined??false;
  const revealLabel=busy==="reveal"?"DECRYPTING…":balance!==undefined?"HIDE":!address?"CONNECT TO REVEAL":!joined?"JOIN TO REVEAL":"REVEAL TO ME";
  const revealAction=balance!==undefined?()=>setBalance(undefined):reveal;
  return <main className="dashboard"><Header onHome={home} address={address} busy={busy==="connect"} onConnect={connect}/><section className="dashboard-grid" id="pool"><aside className="left-rail"><div className="section-kicker">YOUR POSITION</div><div className="private-balance"><span>{balance===undefined?"••••••":balance.toString()}</span><small>cUSD</small></div><div className="sealed-row"><span className="lock-dot">⌾</span> {joined?"SEALED":"NOT ENTERED"}</div><button className="outline" disabled={!!busy} onClick={revealAction}>{revealLabel}</button><div className="privacy-lines"><p><span>Your weight</span><strong>{joined?"ENCRYPTED":"—"}</strong></p><p><span>Your odds</span><strong>{joined?"PRIVATE":"—"}</strong></p><p><span>Withdrawals</span><strong>{joined?"PRIVATE":"—"}</strong></p></div><div className="action-tabs"><button className={panel==="deposit"?"active":""} onClick={()=>setPanel("deposit")}>Deposit</button><button className={panel==="withdraw"?"active":""} disabled={!!address&&!joined} onClick={()=>setPanel("withdraw")}>Withdraw</button></div><div className="amount-box"><label>{panel==="deposit"?"Amount to seal":"Amount to withdraw"}</label><div><input aria-label="Amount" inputMode="numeric" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value.replace(/[^0-9]/g,""))}/><b>cUSD</b></div></div><button className="primary full" disabled={!!busy||!amount} onClick={transact}>{busy===panel?(panel==="deposit"?"SEALING…":"WITHDRAWING…"):(panel==="deposit"?"SEAL DEPOSIT":"WITHDRAW PRIVATELY")}</button><small className="microcopy">{joined?"Amounts never appear in VEIL events.":"Your first sealed deposit creates a private position."}</small></aside><section className="draw-stage" id="draw"><div className="round-head"><div><span>NEXT ROUND</span><strong>{round.toString().padStart(2,"0")}</strong></div><div className="round-state"><i/> LIVE</div><div className="countdown"><span>NETWORK</span><strong>SEPOLIA</strong></div></div><div className="draw-visual"><VeilField compact/><div className="draw-copy"><span>ENCRYPTED POOL</span><h2>{participants} POSITION{participants===1?"":"S"}.<br/>ZERO BALANCES EXPOSED.</h2><p>BlindDraw operates on encrypted participant weights. The public chain never receives plaintext deposit amounts.</p></div></div><div className="draw-stats"><div><span>Participants</span><strong>{participants}</strong></div><div><span>Your position</span><strong>{joined?"SEALED":"—"}</strong></div><div><span>Latest round</span><strong>{data?.latestRound?.toString()??"0"}</strong></div><div><span>Proof</span><strong>ONCHAIN</strong></div></div><div className="lifecycle">{["OPEN","SNAPSHOT","BLIND DRAW","REVEAL","SETTLE"].map((step,i)=><div className={i===0?"current":""} key={step}><b>{String(i+1).padStart(2,"0")}</b><span>{step}</span></div>)}</div></section><aside className="right-rail"><div className="notifications-head"><span>ACTIVITY</span><button>⌁</button></div><div className="activity"><span>●</span><div><strong>{failure?"Action needs attention":"VEIL session"}</strong><p>{failure||notice}</p><small>NOW</small></div></div><div className="prize-card"><span>PRIZE STATUS</span><h3>{data?.prize?.claimed?"PRIZE CLAIMED":data?.prize?.funded?"ENCRYPTED PRIZE FUNDED":"NO UNCLAIMED PRIZE"}</h3><p>Prize values stay encrypted until an authorized winner chooses to decrypt them.</p></div><div className="proof-card"><span>LIVE CONTRACT</span><code>{VEIL_CONTRACTS.pool.slice(0,10)}…{VEIL_CONTRACTS.pool.slice(-6)}</code><small>Sepolia · demo deployment</small></div></aside></section><VerifiedHistory/><section className="protocol-strip" id="protocol"><div><span>01</span><strong>DEPOSIT</strong><p>Input is encrypted before it reaches VEIL.</p></div><div><span>02</span><strong>SNAPSHOT</strong><p>Encrypted weights freeze without revealing balances.</p></div><div><span>03</span><strong>BLIND DRAW</strong><p>Winner selection executes over ciphertexts.</p></div><div><span>04</span><strong>VERIFY</strong><p>The final winner becomes publicly provable.</p></div><div><span>05</span><strong>CLAIM</strong><p>Prize stays private until the winner decrypts it.</p></div></section></main>;
}

export default function App(){const [view,setView]=useState<View>("landing");return view==="landing"?<Landing enter={()=>setView("app")}/>:<Dashboard home={()=>setView("landing")}/>;}
