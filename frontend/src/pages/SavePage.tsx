import { useState } from "react";
import { WithdrawalStatus } from "../components/WithdrawalStatus";
import type { UnveilController } from "../hooks/useUnveil";

export function SavePage({ unveil }: { unveil: UnveilController }) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  async function submit() {
    let value: bigint;
    try {
      value = BigInt(amount);
    } catch {
      return;
    }
    if (value <= 0n) return;
    if (mode === "deposit") await unveil.deposit(value);
    else await unveil.withdraw(value);
    setAmount("");
  }

  return (
    <div className="page-stack route-enter">
      <header className="page-heading">
        <span className="eyebrow">SAVE</span>
        <h1>
          MOVE VALUE.
          <br />
          NOT INFORMATION.
        </h1>
        <p>Every amount entered here is encrypted for VeilPoolV2 before protocol submission.</p>
      </header>
      <section className="save-layout">
        <article className="transaction-panel">
          <div className="mode-switch" role="tablist" aria-label="Save action">
            <button
              role="tab"
              aria-selected={mode === "deposit"}
              className={mode === "deposit" ? "active" : ""}
              onClick={() => setMode("deposit")}
            >
              Deposit
            </button>
            <button
              role="tab"
              aria-selected={mode === "withdraw"}
              className={mode === "withdraw" ? "active" : ""}
              onClick={() => setMode("withdraw")}
            >
              Withdraw
            </button>
          </div>
          <div className="transaction-label">
            <span>{mode === "deposit" ? "AMOUNT TO SAVE" : "AMOUNT TO REQUEST"}</span>
            <small>WHOLE TEST UNITS</small>
          </div>
          <div className="amount-input">
            <input
              aria-label={mode === "deposit" ? "Deposit amount" : "Withdrawal amount"}
              inputMode="numeric"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
            />
            <span>TEST</span>
          </div>
          {!unveil.connected && (
            <div className="notice">
              <strong>WALLET DISCONNECTED</strong>
              <p>Connect a Sepolia wallet before submitting a confidential transaction.</p>
            </div>
          )}
          <button className="button-primary button-full" disabled={Boolean(unveil.busy) || !amount} onClick={submit}>
            {unveil.busy === mode
              ? mode === "deposit"
                ? "ENCRYPTING + SAVING…"
                : "ENCRYPTING REQUEST…"
              : mode === "deposit"
                ? "SAVE PRIVATELY"
                : "REQUEST WITHDRAWAL"}
          </button>
          <button className="button-quiet button-full" disabled={Boolean(unveil.busy)} onClick={unveil.fundTestToken}>
            {unveil.busy === "fund" ? "CHECKING + WRAPPING…" : "GET TEST TOKEN"}
          </button>
          <p className="form-note">
            The faucet is secondary demo infrastructure. It mints TEST token only when needed, approves the confidential
            wrapper, and wraps into TEST principal.
          </p>
        </article>

        <aside className="transaction-story">
          {mode === "deposit" ? (
            <>
              <span className="eyebrow">DEPOSIT ROUTE</span>
              {[
                "TEST TOKEN",
                "CONFIDENTIAL WRAPPER",
                "ENCRYPTED DEPOSIT",
                "STRATEGY MANAGER CUSTODY",
                "AUTOMATIC DRAW ELIGIBILITY",
              ].map((step, index) => (
                <div className="route-step" key={step}>
                  <span>0{index + 1}</span>
                  <strong>{step}</strong>
                  {index < 4 && <i>↓</i>}
                </div>
              ))}
              <p>Pool operator authorization is requested only when the V2 pool is not already approved.</p>
            </>
          ) : (
            <>
              <span className="eyebrow">WITHDRAWAL ROUTE</span>
              <h2>
                INSTANT WHEN LIQUID.
                <br />
                QUEUED WHEN NEEDED.
              </h2>
              <p>
                Withdrawal requests may settle instantly or wait for strategy liquidity. The emitted request ID anchors
                the lifecycle without exposing the requested amount.
              </p>
              <WithdrawalStatus request={unveil.dashboard?.latestWithdrawal} />
            </>
          )}
        </aside>
      </section>
      <div className="demo-disclaimer">
        TEST/DEMO ONLY · NOT USDC, cUSDC, csteakcUSDC, STEAKHOUSE, MORPHO, OR PRODUCTION MARKET YIELD.
      </div>
    </div>
  );
}
