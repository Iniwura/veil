import { expect } from "chai";

import {
  DEMO_DONATION,
  executePlannedSteps,
  planPositivePrizePrep,
  type PositivePrizePrepSnapshot,
} from "../scripts/sepolia-v4-positive-prize-prep";

function snapshot(overrides: Partial<PositivePrizePrepSnapshot> = {}): PositivePrizePrepSnapshot {
  return {
    nextRoundId: 14n,
    managerPrizeRoundId: 14n,
    targetDrawState: 0,
    targetFunded: false,
    targetDeliveredCount: 0,
    targetDelivered: false,
    vaultTotalAssets: 0n,
    vaultTotalSupply: 0n,
    shareWrapperUnderlyingBalance: 0n,
    currentBatchId: 1n,
    currentBatchMature: true,
    recognizedBatches: [],
    ...overrides,
  };
}

describe("V4 positive prize preparation planner", function () {
  it("plans a fresh investment without funding the prize round", function () {
    const plan = planPositivePrizePrep(snapshot());
    expect(plan.targetRoundId).to.equal(14n);
    expect(plan.steps).to.deep.equal([{ kind: "INVEST" }]);
    expect(DEMO_DONATION).to.equal(50n);
  });

  it("resumes a pending or dispatched manager batch", function () {
    const pending = planPositivePrizePrep(
      snapshot({
        recognizedBatches: [{ batchId: 1n, state: 0, resolved: false, current: true }],
      }),
    );
    expect(pending.steps).to.deep.equal([{ kind: "DISPATCH", batchId: 1n }]);

    const dispatched = planPositivePrizePrep(
      snapshot({
        recognizedBatches: [{ batchId: 1n, state: 1, resolved: false, current: false }],
      }),
    );
    expect(dispatched.steps).to.deep.equal([{ kind: "PUBLIC_CALLBACK", batchId: 1n }]);
  });

  it("does not donate again when appreciation already exists", function () {
    const plan = planPositivePrizePrep(
      snapshot({
        vaultTotalAssets: 150n,
        vaultTotalSupply: 100n,
        shareWrapperUnderlyingBalance: 100n,
        currentBatchId: 2n,
      }),
    );
    expect(plan.steps).to.deep.equal([]);
    expect(plan.appreciationAlreadyPresent).to.equal(true);
  });

  it("aborts below-par vaults", function () {
    expect(() =>
      planPositivePrizePrep(
        snapshot({ vaultTotalAssets: 99n, vaultTotalSupply: 100n, shareWrapperUnderlyingBalance: 100n }),
      ),
    ).to.throw("below par");
  });

  it("aborts an already-funded prize round", function () {
    expect(() => planPositivePrizePrep(snapshot({ targetFunded: true }))).to.throw("already funded");
  });

  it("aborts when the manager prize pointer is not the current target", function () {
    expect(() => planPositivePrizePrep(snapshot({ managerPrizeRoundId: 13n }))).to.throw("pointer");
  });

  it("never executes writes in dry-run mode", async function () {
    const plan = planPositivePrizePrep(
      snapshot({
        vaultTotalAssets: 100n,
        vaultTotalSupply: 100n,
        shareWrapperUnderlyingBalance: 100n,
      }),
      true,
    );
    let writes = 0;
    const logs: string[] = [];
    await executePlannedSteps(
      plan.steps,
      false,
      async () => {
        writes++;
      },
      (message) => logs.push(message),
    );
    expect(plan.dryRun).to.equal(true);
    expect(plan.steps.map((step) => step.kind)).to.deep.equal(["MINT_DONATION", "APPROVE_DONATION", "DONATE"]);
    expect(writes).to.equal(0);
    expect(logs).to.have.length(3);
  });
});
