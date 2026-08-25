import { UNVEIL_CONTRACTS } from "../contracts";
import { explorerAddress, shortAddress } from "../lib/format";

export function MorePage({ replayGuide }: { replayGuide: () => void }) {
  const links = [
    ["V2 POOL", UNVEIL_CONTRACTS.pool],
    ["STRATEGY MANAGER", UNVEIL_CONTRACTS.manager],
    ["PRIZE VAULT", UNVEIL_CONTRACTS.prizeVault],
    ["TEST PRINCIPAL", UNVEIL_CONTRACTS.principal],
  ] as const;
  return (
    <div className="page-stack route-enter">
      <header className="page-heading">
        <span className="eyebrow">MORE</span>
        <h1>
          HELP, SECURITY
          <br />+ CONTRACTS.
        </h1>
      </header>
      <section className="more-grid">
        <article>
          <span className="eyebrow">PRODUCT GUIDE</span>
          <h2>NEW TO UNVEIL?</h2>
          <p>Replay the transaction-free five-step introduction to private prize savings.</p>
          <button className="button-secondary" onClick={replayGuide}>
            REPLAY GUIDE
          </button>
        </article>
        <article>
          <span className="eyebrow">SOURCE + DOCUMENTATION</span>
          <h2>VERIFY THE IMPLEMENTATION.</h2>
          <p>The active frontend is pinned to the reviewed Sepolia V2 deployment.</p>
          <a className="text-link" href="https://github.com/Iniwura/veil" target="_blank" rel="noreferrer">
            OPEN GITHUB ↗
          </a>
        </article>
      </section>
      <section className="contract-directory">
        {links.map(([label, address]) => (
          <a href={explorerAddress(address)} target="_blank" rel="noreferrer" key={label}>
            <span>{label}</span>
            <code>{shortAddress(address)}</code>
            <i>↗</i>
          </a>
        ))}
      </section>
      <div className="demo-disclaimer">
        THIS SEPOLIA PRODUCT IS A TEST/DEMO SIMULATED ERC4626 STRATEGY. IT IS NOT PRODUCTION MARKET YIELD.
      </div>
    </div>
  );
}
