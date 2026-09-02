import { expect } from "chai";
import { mapPrivateBalanceValues, type PrivateBalanceHandles } from "../shared/privateBalances";

const HANDLES: PrivateBalanceHandles = {
  walletPrincipal: "wallet",
  poolPrincipal: "pool",
  reservedWithdrawal: "reserved",
  prizeBalance: "prize",
};

describe("UNVEIL private balance dashboard", function () {
  it("maps a fresh unjoined wallet to wallet and prize values with pool values at zero", function () {
    const unjoinedHandles: PrivateBalanceHandles = {
      ...HANDLES,
      poolPrincipal: "0x0000000000000000000000000000000000000000000000000000000000000000",
      reservedWithdrawal: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };
    const values = new Map([
      [unjoinedHandles.walletPrincipal, 94n],
      [unjoinedHandles.prizeBalance, 0n],
    ]);

    expect(mapPrivateBalanceValues(unjoinedHandles, values)).to.deep.equal({
      availablePrincipal: 94n,
      activePrincipal: 0n,
      reservedPrincipal: 0n,
      strategySharePrizeBalance: 0n,
    });
  });

  it("populates all four values from one batched response for a joined wallet", function () {
    const values = new Map([
      [HANDLES.walletPrincipal, 94n],
      [HANDLES.poolPrincipal, 6n],
      [HANDLES.reservedWithdrawal, 0n],
      [HANDLES.prizeBalance, 3n],
    ]);

    expect(mapPrivateBalanceValues(HANDLES, values)).to.deep.equal({
      availablePrincipal: 94n,
      activePrincipal: 6n,
      reservedPrincipal: 0n,
      strategySharePrizeBalance: 3n,
    });
  });

  it("keeps every zero handle sealed as a local zero value", function () {
    const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const zeroHandles: PrivateBalanceHandles = {
      walletPrincipal: zero,
      poolPrincipal: zero,
      reservedWithdrawal: zero,
      prizeBalance: zero,
    };

    expect(mapPrivateBalanceValues(zeroHandles, new Map([[zero, 0n]]))).to.deep.equal({
      availablePrincipal: 0n,
      activePrincipal: 0n,
      reservedPrincipal: 0n,
      strategySharePrizeBalance: 0n,
    });
  });
});
