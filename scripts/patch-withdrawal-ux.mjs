import fs from "node:fs";

const path = "frontend/src/App.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(label, from, to) {
  if (!source.includes(from)) throw new Error(`Patch failed: ${label} pattern not found`);
  source = source.replace(from, to);
}

replaceOnce(
  "withdrawal success notice",
  `        panel === "deposit" ? "Deposit sealed and confirmed on Sepolia." : "Private withdrawal confirmed on Sepolia.",`,
  `        panel === "deposit"\n          ? "Deposit sealed and confirmed on Sepolia."\n          : "Private withdrawal request processed on Sepolia. VEIL withdraws up to your encrypted available balance; reveal locally to verify the resulting position.",`,
);

replaceOnce(
  "withdraw microcopy",
  `              ? "Amounts never appear in VEIL events."\n              : "Already funded? Deposit directly. The test-only faucet is optional."}`,
  `              ? panel === "withdraw"\n                ? "Requested withdrawals are privately capped at your encrypted available balance."\n                : "Amounts never appear in VEIL events."\n              : "Already funded? Deposit directly. The test-only faucet is optional."}`,
);

replaceOnce(
  "claim privacy copy",
  `<p>Prize stays private until the winner decrypts it.</p>`,
  `<p>Winner privately decrypts and claims. Prize value remains hidden from everyone else.</p>`,
);

fs.writeFileSync(path, source);
console.log("Patched App.tsx: private withdrawal semantics + claim privacy copy.");
