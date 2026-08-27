export const STEPS = ["OPEN", "SNAPSHOT", "BLIND DRAW", "VERIFY", "DELIVER"];
export const PIPELINE = ["AUTHORIZE", "INITIALIZE FHE", "ENCRYPT LOCALLY", "SUBMIT", "CONFIRM", "SEALED"];
export const DIRECTIONS = {
  a: {
    name: "Cipher Fabric",
    subtitle: "Mechanical seam / concealed material",
    headline: "Private by nature.\nPublic by proof.",
    number: "01",
  },
  b: {
    name: "Diffraction Vault",
    subtitle: "Optical boundary / precise disclosure",
    headline: "Nothing exposed.\nEverything proven.",
    number: "02",
  },
  c: {
    name: "Kinetic Monolith",
    subtitle: "Architectural access / solid assurance",
    headline: "A position.\nNot a spectacle.",
    number: "03",
  },
};
export function lifecycle(state) {
  if (state === "SKIPPED") return ["complete", "bypassed", "bypassed", "bypassed", "bypassed"];
  if (state === "CANCELLED") return ["complete", "complete", "complete", "complete", "inactive"];
  if (state === "COMPLETE") return ["complete", "inactive", "inactive", "inactive", "inactive"];
  if (state === "DELIVERED") return STEPS.map(() => "complete");
  const i = STEPS.indexOf(state);
  if (i < 0) throw new Error(`Unknown lifecycle state: ${state}`);
  return STEPS.map((_, n) => (n < i ? "complete" : n === i ? "current" : "future"));
}
export const DRAW_COPY = {
  OPEN: [
    "A closed world. An open draw.",
    "Equal public signals. All financial weight stays concealed.",
    "SNAPSHOT ROUND 02",
  ],
  SNAPSHOT: ["Snapshot sealed.", "Close-time eligibility and encrypted weights are fixed.", "RUN BLIND DRAW"],
  "BLIND DRAW": [
    "More computation. No exposure.",
    "Encrypted computation intensifies. The seam narrows.",
    "AWAIT PUBLIC PROOF",
  ],
  VERIFY: ["One proof crosses the boundary.", "Verification becomes public. Private weights never do.", "VERIFY PROOF"],
  DELIVER: [
    "Value moves. Amounts do not surface.",
    "One confidential packet leaves the sealed interior.",
    "DELIVER CONFIDENTIALLY",
  ],
  DELIVERED: [
    "Confidential prize delivered.",
    "No claim gesture. No visible amount. This is a visual simulation only.",
    "REPLAY ENGINE",
  ],
  SKIPPED: ["Not enough participants.", "No snapshot. No BlindDraw. No encrypted winner.", "ROUND SKIPPED"],
  CANCELLED: [
    "Zero winner. No delivery.",
    "BlindDraw ran. Public verification resolved to zero winner.",
    "ROUND CANCELLED",
  ],
  COMPLETE: [
    "Complete. No prize due.",
    "Terminal origin unavailable. Intermediate history is not inferred.",
    "COMPLETE",
  ],
};
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
export function amountLabel(value) {
  return /^\d{1,9}$/.test(value) && Number(value) > 0 ? value : null;
}
