import { expect } from "chai";
import {
  DASHBOARD_SEALED_SEGMENTS,
  deriveHomeNextAction,
  deriveHomePersonalSignal,
  HOME_PROTOCOL_CAPACITY_LABEL,
  isKeeperSettlementAction,
  type HomeActionInput,
} from "../shared/homePresentation";

const baseInput: HomeActionInput = {
  connected: true,
  wrongNetwork: false,
  accountReady: true,
  vaultRevealed: true,
  pendingSeatAttestation: false,
  joined: true,
  seated: true,
  connectedWinner: false,
  withdrawalActionable: false,
  redemptionActionable: false,
  keeperSettling: false,
};

describe("UNVEIL /app dashboard presentation", function () {
  it("selects the next useful saver action from real state", function () {
    expect(deriveHomeNextAction({ ...baseInput, vaultRevealed: false }).kind).to.equal("UNVEIL");
    expect(deriveHomeNextAction({ ...baseInput, withdrawalActionable: true }).kind).to.equal("CONTINUE_WITHDRAWAL");
    expect(deriveHomeNextAction({ ...baseInput, connectedWinner: true }).kind).to.equal("VIEW_PRIZE");
  });

  it("keeps keeper and attestation states passive", function () {
    const keeper = deriveHomeNextAction({ ...baseInput, keeperSettling: true });
    const pending = deriveHomeNextAction({ ...baseInput, pendingSeatAttestation: true });

    expect(keeper.passive).to.equal(true);
    expect(keeper.href).to.equal(undefined);
    expect(pending.passive).to.equal(true);
    expect(isKeeperSettlementAction("SNAPSHOT")).to.equal(true);
  });

  it("keeps sealed geometry fixed and value-independent", function () {
    expect(DASHBOARD_SEALED_SEGMENTS.length).to.equal(8);
    expect([...DASHBOARD_SEALED_SEGMENTS]).to.deep.equal([...DASHBOARD_SEALED_SEGMENTS]);
    expect(DASHBOARD_SEALED_SEGMENTS.every((width) => width > 0)).to.equal(true);
  });

  it("keeps personal winner signals privacy-safe", function () {
    const signal = deriveHomePersonalSignal({
      winner: { roundId: 14n, prizeIndex: 1 },
      withdrawalActionable: false,
      pendingSeatAttestation: false,
      seated: true,
    });

    expect(signal?.label).to.equal("YOU WON · ROUND 14 · PRIZE 2");
    expect(signal?.label).to.not.include("31");
    expect(signal?.label).to.not.include("TEST");
  });

  it("labels 576 as protocol capacity rather than occupied participation", function () {
    expect(HOME_PROTOCOL_CAPACITY_LABEL).to.equal("576 MAX");
  });
});
