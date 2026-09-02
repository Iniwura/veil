import { expect } from "chai";
import { waitForSubmittedTransaction } from "../shared/transactionSafety";

describe("frontend transaction safety", function () {
  it("does not turn a late wallet submission into a retryable failure", async function () {
    let submissionAttempts = 0;
    const transaction = {
      hash: "0xlate",
      wait: async () => "confirmed",
    };

    const submission = new Promise<typeof transaction>((resolve) => {
      setTimeout(() => {
        submissionAttempts += 1;
        resolve(transaction);
      }, 40);
    });

    // The old client rejected after 30 seconds. This shorter delay models a
    // wallet/provider response arriving after that boundary; the safe helper
    // must keep the operation in flight and complete it exactly once.
    const result = await waitForSubmittedTransaction(submission);
    expect(result.receipt).to.equal("confirmed");
    expect(result.pendingNoticeShown).to.equal(false);
    expect(submissionAttempts).to.equal(1);
  });

  it("reports a slow receipt as pending without rejecting the submitted action", async function () {
    const pendingHashes: string[] = [];
    const transaction = {
      hash: "0xpending",
      wait: () => new Promise<string>((resolve) => setTimeout(() => resolve("confirmed"), 25)),
    };

    const result = await waitForSubmittedTransaction(
      Promise.resolve(transaction),
      (hash) => pendingHashes.push(hash),
      5,
    );

    expect(pendingHashes).to.deep.equal(["0xpending"]);
    expect(result.pendingNoticeShown).to.equal(true);
    expect(result.receipt).to.equal("confirmed");
  });
});
