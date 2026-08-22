import fs from "node:fs";

const appPath = "frontend/src/App.tsx";
const clientPath = "frontend/src/veilClient.ts";
let app = fs.readFileSync(appPath, "utf8");
let client = fs.readFileSync(clientPath, "utf8");

function replaceOnce(source, label, from, to) {
  if (!source.includes(from)) throw new Error(`Patch failed: ${label} pattern not found`);
  return source.replace(from, to);
}

function replaceBlock(source, label, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error(`Patch failed: ${label} block not found`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// ---- veilClient.ts: hardened draw-seat/read model ----
client = replaceOnce(
  client,
  "pool ABI seat functions",
  `  "function joined(address) view returns (bool)",\n  "function playerCount() view returns (uint8)",`,
  `  "function joined(address) view returns (bool)",\n  "function seated(address) view returns (bool)",\n  "function seatExpiresAt(address) view returns (uint64)",\n  "function renewDrawSeat()",\n  "function playerCount() view returns (uint8)",`,
);

client = replaceBlock(
  client,
  "verified round type",
  "export type VerifiedRound = {",
  "\n\nlet relayerPromise",
  `export type VerifiedRound = {\n  id: bigint;\n  snapshotBlock: bigint;\n  participantCount: number;\n  state: number;\n  cancelled: boolean;\n  winner: string;\n  funded: boolean;\n  winnerAuthorized: boolean;\n  claimed: boolean;\n};`,
);

client = client.replace(
  "async function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {",
  `export async function renewDrawSeat(signer: JsonRpcSigner) {\n  const { pool } = contracts(signer);\n  try {\n    const tx = await withTimeout(pool.renewDrawSeat(), 30_000, "Wallet did not respond to the draw-seat renewal request.");\n    return await withTimeout(tx.wait(), 120_000, "Draw-seat renewal is still pending on Sepolia. Check wallet activity before retrying.");\n  } catch (error) { actionError("VEIL_SEAT_RENEWAL_FAILED:", error); }\n}\n\nasync function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {`,
);

client = replaceBlock(
  client,
  "verified rounds reader",
  "async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {",
  "export async function readDashboard",
  `async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {\n  if (latestRound === 0n) return [];\n  const { pool, prizeVault } = readContracts();\n  const ids = Array.from({ length: Number(latestRound) }, (_, index) => BigInt(index + 1)).reverse();\n  const rounds = await Promise.all(ids.map(async (id) => {\n    try {\n      const draw = await pool.getDrawInfo(id);\n      const state = Number(draw.state);\n      if (state !== 3 && state !== 4) return null;\n      const cancelled = state === 4;\n      const winner = cancelled ? "0x0000000000000000000000000000000000000000" : (await pool.getWinner(id)) as string;\n      const prize = cancelled ? null : await prizeVault.prizeStatus(id);\n      return {\n        id,\n        snapshotBlock: BigInt(draw.snapshotBlock),\n        participantCount: Number(draw.participantCount),\n        state,\n        cancelled,\n        winner,\n        funded: prize ? Boolean(prize.funded) : false,\n        winnerAuthorized: prize ? Boolean(prize.winnerAuthorized) : false,\n        claimed: prize ? Boolean(prize.claimed) : false,\n      } satisfies VerifiedRound;\n    } catch {\n      return null;\n    }\n  }));\n  return rounds.filter((round): round is VerifiedRound => round !== null);\n}\n\n`,
);

client = replaceBlock(
  client,
  "dashboard reader",
  "export async function readDashboard(signer: JsonRpcSigner) {",
  "\n}",
  `export async function readDashboard(signer: JsonRpcSigner) {\n  const address = await signer.getAddress();\n  const { pool, prizeVault } = readContracts();\n  const [joined, seated, seatExpiresAt, playerCount, nextRoundId] = await Promise.all([\n    pool.joined(address),\n    pool.seated(address),\n    pool.seatExpiresAt(address),\n    pool.playerCount(),\n    pool.nextRoundId(),\n  ]);\n  const latestRound = nextRoundId > 1n ? nextRoundId - 1n : 0n;\n  const [prize, history] = await Promise.all([\n    latestRound > 0n ? prizeVault.prizeStatus(latestRound).catch(() => null) : Promise.resolve(null),\n    readVerifiedRounds(latestRound),\n  ]);\n  return {\n    joined: Boolean(joined),\n    seated: Boolean(seated),\n    seatExpiresAt: BigInt(seatExpiresAt),\n    playerCount: Number(playerCount),\n    nextRoundId: BigInt(nextRoundId),\n    latestRound,\n    prize,\n    history,\n  };\n}`,
);

// ---- App.tsx: live history, seat state, privacy-safe outcomes ----
app = replaceOnce(
  app,
  "renewDrawSeat import",
  `  readDashboard,\n  revealPrivateBalance,`,
  `  readDashboard,\n  renewDrawSeat,\n  revealPrivateBalance,`,
);

app = app.replace(
  `const VERIFIED_ROUND = {\n  id: 1,\n  winner: "0xcC427b61573EEE146fc735159292f06E13bc8B80",\n  prize: "15 encrypted token units",\n  date: "21 AUG 2026",\n};\n\n`,
  "",
);

const historyComponent = `function VerifiedHistory({ rounds }: { rounds: DashboardData["history"] }) {\n  return (\n    <section className="verified-history" id="history">\n      <div className="history-heading">\n        <div>\n          <span className="history-kicker"><i /> LIVE SEPOLIA PROOF</span>\n          <h2>{rounds.length} ROUND{rounds.length === 1 ? "" : "S"}. ONCHAIN VERIFIED.</h2>\n          <p>Finalized winners and KMS-proven cancellations read directly from the hardened Sepolia deployment.</p>\n        </div>\n        <a className="explorer-link" href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VIEW POOL ON ETHERSCAN ↗</a>\n      </div>\n      {rounds.length === 0 ? (\n        <div className="history-proof"><div className="proof-detail"><strong>CONNECT WALLET TO LOAD ROUND HISTORY</strong></div></div>\n      ) : rounds.map((round) => (\n        <div className="history-proof" key={round.id.toString()}>\n          <div className="proof-number">\n            <span>ROUND</span>\n            <strong>{round.id.toString().padStart(2, "0")}</strong>\n            <small>{round.cancelled ? "CANCELLED" : "FINALIZED"}</small>\n          </div>\n          <div className="proof-detail">\n            <span>{round.cancelled ? "RESULT" : "WINNER"}</span>\n            {round.cancelled ? (\n              <><strong>NO ELIGIBLE WEIGHT</strong><small>KMS proved a zero winner without exposing balances.</small></>\n            ) : (\n              <><strong>{shortAddress(round.winner)}</strong><a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">{round.winner} ↗</a></>\n            )}\n          </div>\n          <div className="proof-detail">\n            <span>CONFIDENTIAL PRIZE</span>\n            <strong>{round.cancelled ? "NOT ALLOCATED" : round.funded ? "ENCRYPTED PRIZE FUNDED" : "NO PRIZE FUNDED"}</strong>\n            <small>Prize values remain hidden from the public chain.</small>\n          </div>\n          <div className="proof-detail">\n            <span>VERIFICATION</span>\n            <strong className="pass-mark">PASS</strong>\n            <small>{round.cancelled ? "KMS zero-winner proof · cancelled onchain" : "KMS winner proof · finalized onchain"}</small>\n          </div>\n          <div className="proof-detail">\n            <span>{round.cancelled ? "SNAPSHOT" : "CLAIM"}</span>\n            <strong>{round.cancelled ? `${round.participantCount} POSITIONS` : round.claimed ? "CLAIMED" : round.winnerAuthorized ? "AUTHORIZED" : "PENDING"}</strong>\n            <small>snapshot block {round.snapshotBlock.toString()}</small>\n          </div>\n        </div>\n      ))}\n      <div className="proof-contracts">\n        <a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer"><span>POOL</span><code>{shortAddress(VEIL_CONTRACTS.pool)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.yieldSource)} target="_blank" rel="noreferrer"><span>YIELD SOURCE</span><code>{shortAddress(VEIL_CONTRACTS.yieldSource)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer"><span>PRIZE VAULT</span><code>{shortAddress(VEIL_CONTRACTS.prizeVault)}</code></a>\n        <a href={explorerAddress(VEIL_CONTRACTS.asset)} target="_blank" rel="noreferrer"><span>DEMO ASSET</span><code>{shortAddress(VEIL_CONTRACTS.asset)}</code></a>\n      </div>\n    </section>\n  );\n}\n\n`;
app = replaceBlock(app, "history component", "function VerifiedHistory() {", "function Dashboard({ home }", historyComponent);

app = replaceOnce(
  app,
  "connected position notice",
  `        dashboard.joined\n          ? "Wallet connected. Your private position is sealed until you request decryption."\n          : "Wallet connected. Deposit directly if this wallet already has demo cUSD; the faucet below is optional.",`,
  `        dashboard.joined\n          ? dashboard.seated\n            ? "Wallet connected. Your private position is sealed and your draw seat is active."\n            : "Wallet connected. Your private position is sealed. Renew the draw seat to enter the next snapshot."\n          : "Wallet connected. Deposit directly if this wallet already has demo cUSD; the faucet below is optional.",`,
);

app = app.replace(
  "  async function transact() {",
  `  async function renewSeat() {\n    if (!signer) return connect();\n    try {\n      setFailure("");\n      setBusy("seat");\n      setNotice("Renewing your temporary BlindDraw seat…");\n      await renewDrawSeat(signer);\n      await refresh(signer);\n      setNotice("Draw seat renewed. Your private balance was not exposed or changed.");\n    } catch (error) {\n      setFailure(errorMessage(error));\n    } finally {\n      setBusy("");\n    }\n  }\n\n  async function transact() {`,
);

app = replaceOnce(
  app,
  "private transaction outcomes",
  `      setNotice(\n        panel === "deposit" ? "Deposit sealed and confirmed on Sepolia." : "Private withdrawal confirmed on Sepolia.",\n      );`,
  `      setNotice(\n        panel === "deposit"\n          ? "Private deposit request processed on Sepolia. Reveal locally to verify the resulting position."\n          : "Private withdrawal request processed on Sepolia. Reveal locally to verify the resulting position.",\n      );`,
);

app = replaceOnce(
  app,
  "seat state constants",
  `  const joined = data?.joined ?? false;\n  const revealLabel =`,
  `  const joined = data?.joined ?? false;\n  const seated = data?.seated ?? false;\n  const revealLabel =`,
);

app = replaceOnce(
  app,
  "seat status UI",
  `          <div className="sealed-row">\n            <span className="lock-dot">⌾</span> {joined ? "SEALED" : "NOT ENTERED"}\n          </div>\n          <button className="outline" disabled={!!busy} onClick={revealAction}>`,
  `          <div className="sealed-row">\n            <span className="lock-dot">⌾</span> {joined ? "SEALED" : "NOT ENTERED"}\n          </div>\n          {joined && (\n            <div className="privacy-lines">\n              <p><span>Next draw seat</span><strong>{seated ? "ACTIVE" : "RENEW"}</strong></p>\n            </div>\n          )}\n          {joined && !seated && (\n            <button className="outline" disabled={!!busy} onClick={renewSeat}>\n              {busy === "seat" ? "RENEWING…" : "RENEW DRAW SEAT"}\n            </button>\n          )}\n          <button className="outline" disabled={!!busy} onClick={revealAction}>`,
);

app = replaceOnce(app, "history props", "      <VerifiedHistory />", "      <VerifiedHistory rounds={data?.history ?? []} />");
app = replaceOnce(
  app,
  "round-specific prize status",
  `          <div className="prize-card">\n            <span>PRIZE STATUS</span>`,
  `          <div className="prize-card">\n            <span>{data?.latestRound && data.latestRound > 0n ? \`ROUND \${data.latestRound.toString()} · PRIZE STATUS\` : "PRIZE STATUS"}</span>`,
);

app = app.replace(
  `<p>Prize stays private until the winner decrypts it.</p>`,
  `<p>Winner privately decrypts and claims. Prize value remains hidden from everyone else.</p>`,
);

fs.writeFileSync(clientPath, client);
fs.writeFileSync(appPath, app);
console.log("Patched hardened frontend: live/cancelled history, draw-seat renewal, and privacy-safe transaction outcomes.");
