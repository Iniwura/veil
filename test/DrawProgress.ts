import { expect } from "chai";
import { drawRoundCountdownSeconds, drawRoundProgressPercent, formatDrawCountdown } from "../shared/drawProgress";

describe("Draw round timing presentation", function () {
  const opensAt = 1_000n;
  const closesAt = 2_000n;

  it("reports zero before a round opens", function () {
    expect(drawRoundProgressPercent(opensAt, closesAt, 999n)).to.equal(0);
  });

  it("reports deterministic elapsed progress during an open round", function () {
    expect(drawRoundProgressPercent(opensAt, closesAt, 1_500n)).to.equal(50);
    expect(formatDrawCountdown(drawRoundCountdownSeconds(closesAt, 1_247n))).to.equal("00:12:33");
  });

  it("reports a closed round as complete without negative countdowns", function () {
    expect(drawRoundProgressPercent(opensAt, closesAt, closesAt)).to.equal(100);
    expect(drawRoundProgressPercent(opensAt, closesAt, 2_400n)).to.equal(100);
    expect(drawRoundCountdownSeconds(closesAt, 2_400n)).to.equal(0);
    expect(formatDrawCountdown(-10)).to.equal("00:00:00");
  });

  it("fails closed for unavailable or invalid timing", function () {
    expect(drawRoundProgressPercent(undefined, closesAt, 1_500n)).to.equal(0);
    expect(drawRoundProgressPercent(opensAt, opensAt, 1_500n)).to.equal(0);
    expect(drawRoundCountdownSeconds(undefined, 1_500n)).to.equal(0);
  });
});
