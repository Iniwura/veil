import { expect } from "chai";

import { selectMatureTargetRound } from "../scripts/sepolia-v4-smoke";

describe("V4 Sepolia smoke mature-target selection", function () {
  it("uses the seat boundary while the first mature round is still unstarted", async function () {
    expect(selectMatureTargetRound(1n, 18n, 18n)).to.equal(18n);
    expect(selectMatureTargetRound(17n, 18n, 18n)).to.equal(18n);
    expect(selectMatureTargetRound(18n, 18n, 18n)).to.equal(18n);
  });

  it("resumes at the next unstarted round after earlier rounds were settled", async function () {
    expect(selectMatureTargetRound(19n, 18n, 18n)).to.equal(19n);
  });

  it("rejects mismatched or invalid seat boundaries instead of weakening assertions", async function () {
    expect(() => selectMatureTargetRound(1n, 18n, 19n)).to.throw("Unexpected seat maturity boundary");
    expect(() => selectMatureTargetRound(1n, 1n, 1n)).to.throw("Unexpected seat maturity boundary");
  });
});
