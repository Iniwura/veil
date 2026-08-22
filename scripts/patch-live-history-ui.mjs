import fs from "node:fs";

const path = "frontend/src/App.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(label, from, to) {
  if (!source.includes(from)) throw new Error(`Patch failed: ${label} pattern not found`);
  source = source.replace(from, to);
}

replaceOnce(
  "remove hardcoded round",
  `const VERIFIED_ROUND = {\n  id: 1,\n  winner: "0xcC427b61573EEE146fc735159292f06E13bc8B80",\n  prize: "15 encrypted token units",\n  date: "21 AUG 2026",\n};\n\n`,
  ``,
);

const historyStart = source.indexOf("function VerifiedHistory() {");
const dashboardStart = source.indexOf("function Dashboard({ home }", historyStart);
if (historyStart === -1 || dashboardStart === -1) throw new Error("Patch failed: VerifiedHistory block not found");

const historyComponent = `function VerifiedHistory({ rounds }: { rounds: DashboardData["history"] }) {\n  return (\n    <section className="verified-history" id="history">\n      <div className="history-heading">\n        <div>\n          <span className="history-kicker"><i /> LIVE SEPOLIA PROOF</span>\n          <h2>{rounds.length} ROUND{rounds.length === 1 ? "" : "S"}. FULLY VERIFIED.</h2>\n          <p>Live finalized-round evidence read directly from the Sepolia deployment.</p>\n        </div>\n        <a className="explorer-link" href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">\n          VIEW POOL ON ETHERSCAN ↗\n        </a>\n      </div>\n      {rounds.length === 0 ? (\n        <div className="history-proof"><div className="proof-detail"><strong>CONNECT WALLET TO LOAD VERIFIED HISTORY</strong></div></div>\n      ) : rounds.map((round) => (\n        <div className="history-proof" key={round.id.toString()}>\n          <div className="proof-number">\n            <span>ROUND</span>\n            <strong>{round.id.toString().padStart(2, "0")}</strong>\n            <small>FINALIZED</small>\n          </div>\n          <div className="proof-detail">\n            <span>WINNER</span>\n            <strong>{shortAddress(round.winner)}</strong>\n            <a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">{round.winner} ↗</a>\n          </div>\n          <div className="proof-detail">\n            <span>CONFIDENTIAL PRIZE</span>\n            <strong>{round.funded ? "ENCRYPTED PRIZE FUNDED" : "NO PRIZE FUNDED"}</strong>\n            <small>Prize value remains confidential on the public chain.</small>\n          </div>\n          <div className="proof-detail">\n            <span>VERIFICATION</span>\n            <strong className="pass-mark">PASS</strong>\n            <small>KMS winner proof · finalized onchain</small>\n          </div>\n          <div className="proof-detail">\n            <span>CLAIM</span>\n            <strong>{round.claimed ? "CLAIMED" : round.winnerAuthorized ? "AUTHORIZED" : "PENDING"}</strong>\n            <small>{round.participantCount} encrypted positions · snapshot block {round.snapshotBlock.toString()}</small>\n          </div>\n        </div>\n      ))}\n      <div className="proof-contracts">\n        <a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer"><span>POOL</span><code>{shortAddress(VEIL_CONTRACTS.pool)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.yieldSource)} target="_blank" rel="noreferrer"><span>YIELD SOURCE</span><code>{shortAddress(VEIL_CONTRACTS.yieldSource)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer"><span>PRIZE VAULT</span><code>{shortAddress(VEIL_CONTRACTS.prizeVault)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.asset)} target="_blank" rel="noreferrer"><span>DEMO ASSET</span><code>{shortAddress(VEIL_CONTRACTS.asset)}</code></a>\n      </div>\n    </section>\n  );\n}\n\n`;
source = source.slice(0, historyStart) + historyComponent + source.slice(dashboardStart);

replaceOnce("history props", "      <VerifiedHistory />", "      <VerifiedHistory rounds={data?.history ?? []} />");
replaceOnce(
  "round-specific prize card",
  `          <div className="prize-card">\n            <span>PRIZE STATUS</span>`,
  `          <div className="prize-card">\n            <span>{data?.latestRound && data.latestRound > 0n ? \`ROUND \${data.latestRound.toString()} · PRIZE STATUS\` : "PRIZE STATUS"}</span>`,
);

fs.writeFileSync(path, source);
console.log("Patched App.tsx: live verified history + round-specific prize status.");
