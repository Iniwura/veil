import fs from "node:fs";

const path = "frontend/src/App.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(label, from, to) {
  if (!source.includes(from)) throw new Error(`Patch failed: ${label} pattern not found`);
  source = source.replace(from, to);
}

replaceOnce(
  "confidential transfer success notice",
  `      setNotice(\n        panel === "deposit" ? "Deposit sealed and confirmed on Sepolia." : "Private withdrawal confirmed on Sepolia.",\n      );`,
  `      setNotice(\n        panel === "deposit"\n          ? "Private deposit request processed on Sepolia. ERC-7984 transfers the full encrypted request or silently transfers zero; reveal locally to verify your resulting position."\n          : "Private withdrawal request processed on Sepolia. ERC-7984 transfers the full encrypted request or silently transfers zero; reveal locally to verify your resulting position.",\n      );`,
);

replaceOnce(
  "confidential transfer microcopy",
  `            {joined\n              ? "Amounts never appear in VEIL events."\n              : "Already funded? Deposit directly. The test-only faucet is optional."}`,
  `            {joined\n              ? panel === "withdraw"\n                ? "If the encrypted balance is insufficient, ERC-7984 silently transfers zero without exposing why."\n                : "Deposit amounts stay encrypted. An insufficient confidential token balance silently transfers zero."\n              : "Already funded? Deposit directly. The test-only faucet is optional."}`,
);

replaceOnce(
  "claim privacy copy",
  `<p>Prize stays private until the winner decrypts it.</p>`,
  `<p>Winner privately decrypts and claims. Prize value remains hidden from everyone else.</p>`,
);

fs.writeFileSync(path, source);
console.log("Patched App.tsx: ERC-7984 silent-zero transfer UX + claim privacy copy.");
