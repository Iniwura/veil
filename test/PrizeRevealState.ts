import { expect } from "chai";
import { clearPrizeValues, prizeRevealKey, revealPrizeValue, veilPrizeValue } from "../shared/prizeRevealState";

describe("independent prize reveal state", function () {
  it("keeps one revealed slot when another slot is unveiled", function () {
    const first = prizeRevealKey(12n, 0);
    const second = prizeRevealKey(12n, 2);
    const values = revealPrizeValue(revealPrizeValue(clearPrizeValues(), first, 3n), second, 7n);
    expect(values[first]).to.equal(3n);
    expect(values[second]).to.equal(7n);
  });

  it("veils only the selected slot", function () {
    const first = prizeRevealKey(12n, 0);
    const second = prizeRevealKey(12n, 2);
    const values = revealPrizeValue(revealPrizeValue(clearPrizeValues(), first, 3n), second, 7n);
    const next = veilPrizeValue(values, first);
    expect(next[first]).to.equal(undefined);
    expect(next[second]).to.equal(7n);
  });
});
