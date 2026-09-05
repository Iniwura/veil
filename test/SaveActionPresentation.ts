import { expect } from "chai";
import { deriveSaveActions, isRetryableSaveError, saveSourceSummary, saveSourceUnit } from "../shared/savePresentation";

const base = {
  connected: true,
  wrongNetwork: false,
  accountReady: true,
  joined: false,
  vaultRevealed: true,
  activePrincipal: 0n,
  reservedPrincipal: 0n,
  prizeBalance: 0n,
  withdrawalActionable: false,
  hasWithdrawalState: false,
  redemptionActionable: false,
  recoveryPending: false,
};

describe("Save page useful actions", function () {
  it("offers only the private save action to a fresh account", function () {
    expect(deriveSaveActions(base).map((action) => action.kind)).to.deep.equal(["SAVE_PRIVATELY"]);
  });

  it("keeps withdrawal available for an existing saver", function () {
    expect(
      deriveSaveActions({ ...base, joined: true, activePrincipal: 10n }).map((action) => action.kind),
    ).to.deep.equal(["SAVE_MORE", "WITHDRAW"]);
  });

  it("keeps withdrawal available when only a prize balance is known", function () {
    expect(deriveSaveActions({ ...base, prizeBalance: 31n }).map((action) => action.kind)).to.deep.equal([
      "SAVE_MORE",
      "WITHDRAW",
    ]);
  });

  it("surfaces actionable withdrawal and recovery before generic actions", function () {
    expect(
      deriveSaveActions({ ...base, joined: true, withdrawalActionable: true, hasWithdrawalState: true }).map(
        (action) => action.kind,
      ),
    ).to.deep.equal(["CONTINUE_WITHDRAWAL", "SAVE_MORE", "WITHDRAW"]);
    expect(deriveSaveActions({ ...base, recoveryPending: true }).map((action) => action.kind)).to.deep.equal([
      "RECOVER_REDEMPTION",
      "SAVE_MORE",
      "WITHDRAW",
    ]);
  });

  it("does not infer a fresh account from a sealed zero value", function () {
    expect(deriveSaveActions({ ...base, joined: true, vaultRevealed: false }).map((action) => action.kind)).to.include(
      "WITHDRAW",
    );
  });

  it("uses connection actions before any transaction modal", function () {
    expect(
      deriveSaveActions({ ...base, connected: false, accountReady: false }).map((action) => action.kind),
    ).to.deep.equal(["CONNECT"]);
    expect(deriveSaveActions({ ...base, wrongNetwork: true }).map((action) => action.kind)).to.deep.equal([
      "SWITCH_NETWORK",
    ]);
  });

  it("keeps source selection units and sealed values privacy-safe", function () {
    expect(saveSourceUnit("available")).to.equal("cUSDC");
    expect(saveSourceUnit("saved")).to.equal("cUSDC");
    expect(saveSourceUnit("prize")).to.equal("VAULT SHARE UNITS");
    expect(saveSourceSummary("prize", false, 31n)).to.equal("FHE SEALED");
    expect(saveSourceSummary("prize", true, 31n)).to.equal("31 VAULT SHARE UNITS");
  });

  it("does not turn submitted or pending state into a retryable error", function () {
    expect(isRetryableSaveError("network error", "")).to.equal(true);
    expect(isRetryableSaveError("Wallet did not respond", "Transaction submitted. Waiting for confirmation.")).to.equal(
      false,
    );
    expect(isRetryableSaveError("Submitted transaction is pending", "")).to.equal(false);
  });
});
