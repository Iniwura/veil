import fs from "node:fs";

const appPath = "frontend/src/App.tsx";
const clientPath = "frontend/src/veilClient.ts";
let app = fs.readFileSync(appPath, "utf8");
let client = fs.readFileSync(clientPath, "utf8");

function rxReplace(source, label, regex, replacement) {
  if (!regex.test(source)) throw new Error(`Patch failed: ${label}`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

function replaceBetween(source, label, start, end, replacement) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a === -1 || b === -1) throw new Error(`Patch failed: ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

// veilClient.ts
if (!client.includes('"function seated(address) view returns (bool)"')) {
  client = rxReplace(
    client,
    "pool seat ABI",
    /(\s*"function joined\(address\) view returns \(bool\)",\s*\n)(\s*"function playerCount\(\) view returns \(uint8\)",)/,
    `$1  "function seated(address) view returns (bool)",\n  "function seatExpiresAt(address) view returns (uint64)",\n  "function renewDrawSeat()",\n$2`,
  );
}

if (!client.includes("cancelled: boolean;")) {
  client = replaceBetween(
    client,
    "VerifiedRound type",
    "export type VerifiedRound = {",
    "\n\nlet relayerPromise",
    [
      "export type VerifiedRound = {",
      "  id: bigint;",
      "  snapshotBlock: bigint;",
      "  participantCount: number;",
      "  state: number;",
      "  cancelled: boolean;",
      "  winner: string;",
      "  funded: boolean;",
      "  winnerAuthorized: boolean;",
      "  claimed: boolean;",
      "};",
    ].join("\n"),
  );
}

if (!client.includes("export async function renewDrawSeat")) {
  client = client.replace(
    "async function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {",
    [
      "export async function renewDrawSeat(signer: JsonRpcSigner) {",
      "  const { pool } = contracts(signer);",
      "  try {",
      '    const tx = await withTimeout(pool.renewDrawSeat(), 30_000, "Wallet did not respond to the draw-seat renewal request.");',
      '    return await withTimeout(tx.wait(), 120_000, "Draw-seat renewal is still pending on Sepolia. Check wallet activity before retrying.");',
      '  } catch (error) { actionError("VEIL_SEAT_RENEWAL_FAILED:", error); }',
      "}",
      "",
      "async function userDecryptHandle(signer: JsonRpcSigner, handle: string, contractAddress: string) {",
    ].join("\n"),
  );
}

client = replaceBetween(
  client,
  "round history reader",
  "async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {",
  "export async function readDashboard",
  [
    "async function readVerifiedRounds(latestRound: bigint): Promise<VerifiedRound[]> {",
    "  if (latestRound === 0n) return [];",
    "  const { pool, prizeVault } = readContracts();",
    "  const ids = Array.from({ length: Number(latestRound) }, (_, index) => BigInt(index + 1)).reverse();",
    "  const rounds = await Promise.all(ids.map(async (id) => {",
    "    try {",
    "      const draw = await pool.getDrawInfo(id);",
    "      const state = Number(draw.state);",
    "      if (state !== 3 && state !== 4) return null;",
    "      const cancelled = state === 4;",
    '      const winner = cancelled ? "0x0000000000000000000000000000000000000000" : (await pool.getWinner(id)) as string;',
    "      const prize = cancelled ? null : await prizeVault.prizeStatus(id);",
    "      return {",
    "        id,",
    "        snapshotBlock: BigInt(draw.snapshotBlock),",
    "        participantCount: Number(draw.participantCount),",
    "        state,",
    "        cancelled,",
    "        winner,",
    "        funded: prize ? Boolean(prize.funded) : false,",
    "        winnerAuthorized: prize ? Boolean(prize.winnerAuthorized) : false,",
    "        claimed: prize ? Boolean(prize.claimed) : false,",
    "      } satisfies VerifiedRound;",
    "    } catch {",
    "      return null;",
    "    }",
    "  }));",
    "  return rounds.filter((round): round is VerifiedRound => round !== null);",
    "}",
    "",
  ].join("\n"),
);

const dashboardStart = client.indexOf("export async function readDashboard(signer: JsonRpcSigner) {");
if (dashboardStart === -1) throw new Error("Patch failed: dashboard reader start");
client = client.slice(0, dashboardStart) + [
  "export async function readDashboard(signer: JsonRpcSigner) {",
  "  const address = await signer.getAddress();",
  "  const { pool, prizeVault } = readContracts();",
  "  const [joined, seated, seatExpiresAt, playerCount, nextRoundId] = await Promise.all([",
  "    pool.joined(address),",
  "    pool.seated(address),",
  "    pool.seatExpiresAt(address),",
  "    pool.playerCount(),",
  "    pool.nextRoundId(),",
  "  ]);",
  "  const latestRound = nextRoundId > 1n ? nextRoundId - 1n : 0n;",
  "  const [prize, history] = await Promise.all([",
  "    latestRound > 0n ? prizeVault.prizeStatus(latestRound).catch(() => null) : Promise.resolve(null),",
  "    readVerifiedRounds(latestRound),",
  "  ]);",
  "  return {",
  "    joined: Boolean(joined),",
  "    seated: Boolean(seated),",
  "    seatExpiresAt: BigInt(seatExpiresAt),",
  "    playerCount: Number(playerCount),",
  "    nextRoundId: BigInt(nextRoundId),",
  "    latestRound,",
  "    prize,",
  "    history,",
  "  };",
  "}",
  "",
].join("\n");

// App.tsx
if (!app.includes("  renewDrawSeat,")) {
  app = rxReplace(app, "renew import", /(\s*readDashboard,\s*\n)(\s*revealPrivateBalance,)/, `$1  renewDrawSeat,\n$2`);
}

app = app.replace(/const VERIFIED_ROUND = \{[\s\S]*?\};\s*\n\n/, "");

const historyLines = [
  'function VerifiedHistory({ rounds }: { rounds: DashboardData["history"] }) {',
  "  return (",
  '    <section className="verified-history" id="history">',
  '      <div className="history-heading">',
  "        <div>",
  '          <span className="history-kicker"><i /> LIVE SEPOLIA PROOF</span>',
  '          <h2>{rounds.length} ROUND{rounds.length === 1 ? "" : "S"}. ONCHAIN VERIFIED.</h2>',
  "          <p>Finalized winners and KMS-proven cancellations read directly from the hardened Sepolia deployment.</p>",
  "        </div>",
  '        <a className="explorer-link" href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer">VIEW POOL ON ETHERSCAN ↗</a>',
  "      </div>",
  "      {rounds.length === 0 ? (",
  '        <div className="history-proof"><div className="proof-detail"><strong>CONNECT WALLET TO LOAD ROUND HISTORY</strong></div></div>',
  "      ) : rounds.map((round) => (",
  '        <div className="history-proof" key={round.id.toString()}>',
  '          <div className="proof-number">',
  "            <span>ROUND</span>",
  '            <strong>{round.id.toString().padStart(2, "0")}</strong>',
  '            <small>{round.cancelled ? "CANCELLED" : "FINALIZED"}</small>',
  "          </div>",
  '          <div className="proof-detail">',
  '            <span>{round.cancelled ? "RESULT" : "WINNER"}</span>',
  "            {round.cancelled ? (",
  "              <><strong>NO ELIGIBLE WEIGHT</strong><small>KMS proved a zero winner without exposing balances.</small></>",
  "            ) : (",
  '              <><strong>{shortAddress(round.winner)}</strong><a href={explorerAddress(round.winner)} target="_blank" rel="noreferrer">{round.winner} ↗</a></>',
  "            )}",
  "          </div>",
  '          <div className="proof-detail">',
  "            <span>CONFIDENTIAL PRIZE</span>",
  '            <strong>{round.cancelled ? "NOT ALLOCATED" : round.funded ? "ENCRYPTED PRIZE FUNDED" : "NO PRIZE FUNDED"}</strong>',
  "            <small>Prize values remain hidden from the public chain.</small>",
  "          </div>",
  '          <div className="proof-detail">',
  "            <span>VERIFICATION</span>",
  '            <strong className="pass-mark">PASS</strong>',
  '            <small>{round.cancelled ? "KMS zero-winner proof · cancelled onchain" : "KMS winner proof · finalized onchain"}</small>',
  "          </div>",
  '          <div className="proof-detail">',
  '            <span>{round.cancelled ? "SNAPSHOT" : "CLAIM"}</span>',
  '            <strong>{round.cancelled ? round.participantCount.toString() + " POSITIONS" : round.claimed ? "CLAIMED" : round.winnerAuthorized ? "AUTHORIZED" : "PENDING"}</strong>',
  "            <small>snapshot block {round.snapshotBlock.toString()}</small>",
  "          </div>",
  "        </div>",
  "      ))}",
  '      <div className="proof-contracts">',
  '        <a href={explorerAddress(VEIL_CONTRACTS.pool)} target="_blank" rel="noreferrer"><span>POOL</span><code>{shortAddress(VEIL_CONTRACTS.pool)}</code></a>',
  '        <a href={explorerAddress(VEIL_CONTRACTS.yieldSource)} target="_blank" rel="noreferrer"><span>YIELD SOURCE</span><code>{shortAddress(VEIL_CONTRACTS.yieldSource)}</code></a>',
  '        <a href={explorerAddress(VEIL_CONTRACTS.prizeVault)} target="_blank" rel="noreferrer"><span>PRIZE VAULT</span><code>{shortAddress(VEIL_CONTRACTS.prizeVault)}</code></a>',
  '        <a href={explorerAddress(VEIL_CONTRACTS.asset)} target="_blank" rel="noreferrer"><span>DEMO ASSET</span><code>{shortAddress(VEIL_CONTRACTS.asset)}</code></a>',
  "      </div>",
  "    </section>",
  "  );",
  "}",
  "",
].join("\n");
app = replaceBetween(app, "history component", app.includes("function VerifiedHistory({ rounds }") ? "function VerifiedHistory({ rounds }" : "function VerifiedHistory() {", "function Dashboard({ home }", historyLines);

if (!app.includes("async function renewSeat()")) {
  app = app.replace(
    "  async function transact() {",
    [
      "  async function renewSeat() {",
      "    if (!signer) return connect();",
      "    try {",
      '      setFailure("");',
      '      setBusy("seat");',
      '      setNotice("Renewing your temporary BlindDraw seat…");',
      "      await renewDrawSeat(signer);",
      "      await refresh(signer);",
      '      setNotice("Draw seat renewed. Your private balance was not exposed or changed.");',
      "    } catch (error) {",
      "      setFailure(errorMessage(error));",
      "    } finally {",
      '      setBusy("");',
      "    }",
      "  }",
      "",
      "  async function transact() {",
    ].join("\n"),
  );
}

app = app.replace(
  /panel === "deposit" \? "Deposit sealed and confirmed on Sepolia\." : "Private withdrawal confirmed on Sepolia\."/,
  'panel === "deposit" ? "Private deposit request processed on Sepolia. Reveal locally to verify the resulting position." : "Private withdrawal request processed on Sepolia. Reveal locally to verify the resulting position."',
);

if (!app.includes("  const seated = data?.seated ?? false;")) {
  app = app.replace("  const joined = data?.joined ?? false;", "  const joined = data?.joined ?? false;\n  const seated = data?.seated ?? false;");
}

if (!app.includes("RENEW DRAW SEAT")) {
  app = rxReplace(
    app,
    "seat status UI",
    /(\s*<div className="sealed-row">[\s\S]*?<\/div>\s*\n)(\s*<button className="outline" disabled=\{!!busy\} onClick=\{revealAction\}>)/,
    `$1          {joined && (\n            <div className="privacy-lines">\n              <p><span>Next draw seat</span><strong>{seated ? "ACTIVE" : "RENEW"}</strong></p>\n            </div>\n          )}\n          {joined && !seated && (\n            <button className="outline" disabled={!!busy} onClick={renewSeat}>\n              {busy === "seat" ? "RENEWING…" : "RENEW DRAW SEAT"}\n            </button>\n          )}\n$2`,
  );
}

app = app.replace("      <VerifiedHistory />", "      <VerifiedHistory rounds={data?.history ?? []} />");
app = app.replace(
  "            <span>PRIZE STATUS</span>",
  '            <span>{data?.latestRound && data.latestRound > 0n ? `ROUND ${data.latestRound.toString()} · PRIZE STATUS` : "PRIZE STATUS"}</span>',
);
app = app.replace(
  "<p>Prize stays private until the winner decrypts it.</p>",
  "<p>Winner privately decrypts and claims. Prize value remains hidden from everyone else.</p>",
);

// Improve connected notice if still on old copy.
app = app.replace(
  'dashboard.joined\n          ? "Wallet connected. Your private position is sealed until you request decryption."\n          : "Wallet connected. Deposit directly if this wallet already has demo cUSD; the faucet below is optional.",',
  'dashboard.joined\n          ? dashboard.seated\n            ? "Wallet connected. Your private position is sealed and your draw seat is active."\n            : "Wallet connected. Your private position is sealed. Renew the draw seat to enter the next snapshot."\n          : "Wallet connected. Deposit directly if this wallet already has demo cUSD; the faucet below is optional.",',
);

fs.writeFileSync(clientPath, client);
fs.writeFileSync(appPath, app);
console.log("Patched hardened frontend v2: live/cancelled history, draw-seat renewal, and privacy-safe outcomes.");
