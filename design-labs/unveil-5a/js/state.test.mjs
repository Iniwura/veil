import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lifecycle, STEPS, PIPELINE, amountLabel, escapeHtml } from "./state.mjs";
for (const [index, state] of STEPS.entries())
  test(`${state}: only preceding stages complete`, () =>
    assert.deepEqual(
      lifecycle(state),
      STEPS.map((_, i) => (i < index ? "complete" : i === index ? "current" : "future")),
    ));
test("SKIPPED has no snapshot, computation, verification or delivery", () =>
  assert.deepEqual(lifecycle("SKIPPED"), ["complete", "bypassed", "bypassed", "bypassed", "bypassed"]));
test("CANCELLED retains public verification but no delivery", () =>
  assert.deepEqual(lifecycle("CANCELLED"), ["complete", "complete", "complete", "complete", "inactive"]));
test("unknown-origin COMPLETE never invents stages", () =>
  assert.deepEqual(lifecycle("COMPLETE"), ["complete", "inactive", "inactive", "inactive", "inactive"]));
test("DELIVERED completes the full simulated lifecycle", () =>
  assert.deepEqual(lifecycle("DELIVERED"), Array(5).fill("complete")));
test("invalid stage fails closed", () => assert.throws(() => lifecycle("BOGUS")));
test("pipeline has named truthful stages, not percentages", () =>
  assert.deepEqual(PIPELINE, ["AUTHORIZE", "INITIALIZE FHE", "ENCRYPT LOCALLY", "SUBMIT", "CONFIRM", "SEALED"]));
for (const value of ["", "0", "-1", "1.5", "1000000000", "<script>"])
  test(`invalid amount rejected: ${value}`, () => assert.equal(amountLabel(value), null));
test("entered amount remains unchanged", () => assert.equal(amountLabel("100"), "100"));
test("markup values escaped", () => assert.equal(escapeHtml('<a "x">&'), "&lt;a &quot;x&quot;&gt;&amp;"));
test("lab imports no production wallet or protocol modules", async () => {
  const code = await readFile(new URL("lab.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /from\s+["'](?:\.\.\/|ethers|react|@zama)/);
  assert.doesNotMatch(code, /window\.ethereum|eth_sendTransaction|personal_sign|useUnveil|veilClient/);
});
test("backgrounds contain no repeated graph, dot, or coordinate grid", async () => {
  const css = await readFile(new URL("../styles/lab.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /repeating-(?:linear|radial)-gradient|background-size:\s*\d+px\s+\d+px/);
});
