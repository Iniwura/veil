import { expect } from "chai";
import {
  drawStateLabel,
  historicalRoundNotIncludedMessage,
  isHistoricalRoundNotIncluded,
} from "../shared/frontendPresentation";

describe("UNVEIL frontend public/private state presentation", function () {
  it("keeps a historical not-included result neutral and actionable", function () {
    const error = new Error("UNVEIL_ROUND_WEIGHT_UNAVAILABLE: Not in round");

    expect(isHistoricalRoundNotIncluded(error)).to.equal(true);
    expect(historicalRoundNotIncludedMessage(13n)).to.equal(
      "NOT INCLUDED IN ROUND 13 · This wallet was not part of that historical snapshot. Select another round.",
    );
  });

  it("does not turn an overdue public round into a protocol failure label", function () {
    expect(drawStateLabel({ insufficientParticipants: false, ready: false, timeReady: true, overdue: true })).to.equal(
      "KEEPER SETTLING",
    );
  });
});
