import { expect } from "chai";
import { advanceWalletSessionEpoch, isCurrentWalletOperation, walletButtonAction } from "../shared/walletSession";

describe("UNVEIL wallet session controls", function () {
  it("opens the connected session menu instead of starting another connect attempt", function () {
    expect(walletButtonAction({ connected: true, wrongNetwork: false })).to.equal("open-menu");
  });

  it("uses connect for disconnected and reconnect-required sessions", function () {
    expect(walletButtonAction({ connected: false, wrongNetwork: false })).to.equal("connect");
  });

  it("uses the network switch action for a wrong-network session", function () {
    expect(walletButtonAction({ connected: false, wrongNetwork: true })).to.equal("switch-network");
  });

  it("invalidates private session epochs when disconnecting", function () {
    const before = { walletEpoch: 4, connectAttempt: 7 };
    const after = advanceWalletSessionEpoch(before);

    expect(after).to.deep.equal({ walletEpoch: 5, connectAttempt: 8 });
  });

  it("prevents stale async wallet work from becoming current after disconnect", function () {
    const operation = { walletEpoch: 4, connectAttempt: 7 };
    const afterDisconnect = advanceWalletSessionEpoch(operation);

    expect(isCurrentWalletOperation(afterDisconnect, operation)).to.equal(false);
  });
});
