import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { VeilReveal } from "../components/VeilReveal";
import { WithdrawalStatus } from "../components/WithdrawalStatus";
import type { UnveilController } from "../hooks/useUnveil";

const MotionDebugVault = import.meta.env.DEV ? lazy(() => import("../dev/MotionDebugVault")) : null;

export function SavePage({ unveil }: { unveil: UnveilController }) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const roundIds = useMemo(() => unveil.history.map((round) => round.id), [unveil.history]);
  const [roundId, setRoundId] = useState("");
  const selectedRoundId = roundIds.some((id) => id.toString() === roundId) ? roundId : (roundIds[0]?.toString() ?? "");
  const revealed = Boolean(unveil.vault);
  const saveError = unveil.errorScope === "save" ? unveil.error : "";
  const saveNotice = unveil.noticeScope === "save" ? unveil.notice : "";
  const showMotionDebug = import.meta.env.DEV && new URLSearchParams(window.location.search).get("motionDebug") === "1";

  useEffect(() => {
    if (selectedRoundId !== roundId) setRoundId(selectedRoundId);
  }, [roundId, selectedRoundId]);

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
      <header className="page-heading page-heading--compact">
        <span className="eyebrow">SAVE</span>
        <h1>SAVE PRIVATELY.</h1>
        <p>Save TEST principal into a confidential position. The draw uses your encrypted balance without publishing it.</p>
      </header>

      {(saveError || saveNotice) && (
        <div className={`action-notice ${saveError ? "action-notice--error" : ""}`} role={saveError ? "alert" : "status"}>
          <span>{saveError ? "SAVE ERROR" : "SAVE UPDATE"}</span>
          <p>{saveError || saveNotice}</p>
          {saveError && (
            <button className="action-notice-dismiss" onClick={unveil.clearError} aria-label="Dismiss save error">
              ×
            </button>
          )}
        </div>
      )}

      <section className="save-layout save-layout--product">
        <article className={`transaction-panel ${unveil.busy === mode ? "transaction-panel--sealing" : ""}`}>
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
          <div className="amount-input" data-tour="save-amount">
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
          <button
            className="button-primary button-full"
            data-tour="save-submit"
            disabled={Boolean(unveil.busy) || !amount}
            onClick={submit}
          >
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
          <p className="form-note">The faucet is demo infrastructure for TEST token only.</p>
        </article>

        <aside className="transaction-story">
          {mode === "deposit" ? (
            <>
              <span className="eyebrow">HOW SAVING WORKS</span>
              <h2>YOUR POSITION STAYS YOURS.</h2>
              <div className="save-benefits">
                <div>
                  <strong>01</strong>
                  <span>DEPOSIT</span>
                  <p>TEST becomes confidential principal before entering the pool.</p>
                </div>
                <div>
                  <strong>02</strong>
                  <span>DRAW WEIGHT</span>
                  <p>Your balance becomes an encrypted weight for eligible rounds.</p>
                </div>
                <div>
                  <strong>03</strong>
                  <span>UNVEIL</span>
                  <p>Only your wallet can locally decrypt authorized private values.</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">WITHDRAWAL STATUS</span>
              <h2>LIQUID WHEN AVAILABLE.</h2>
              <p>Requests settle instantly when liquid or remain queued until strategy liquidity is available.</p>
              <WithdrawalStatus request={unveil.dashboard?.latestWithdrawal} />
            </>
          )}
        </aside>
      </section>

      <section className={`vault-surface ${revealed ? "vault-surface--revealed" : ""}`} data-tour="private-position">
        <div className="save-section-heading">
          <div>
            <span className="eyebrow">MY PRIVATE POSITION</span>
            <h2>{revealed ? "UNVEILED TO YOU" : unveil.busy === "reveal-vault" ? "UNVEILING" : "SEALED"}</h2>
          </div>
          <span className={`vault-seal ${revealed ? "open" : ""}`}>{revealed ? "LOCAL VIEW" : "FHE SEALED"}</span>
        </div>
        {unveil.busy === "reveal-vault" && (
          <div className="vault-reveal-progress" role="status" aria-label="Private position reveal in progress">
            <i className="active">01 · WALLET AUTHORIZATION</i>
            <i>02 · DECRYPTING AUTHORIZED CIPHERTEXTS</i>
            <i>03 · LOCAL REVEAL</i>
          </div>
        )}
        <div className="vault-grid">
          <VeilReveal
            label="Active principal"
            value={unveil.vault?.activePrincipal}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="TEST confidential principal"
            unit=" TEST UNITS"
            stagger={0}
          />
          <VeilReveal
            label="Reserved withdrawal"
            value={unveil.vault?.reservedPrincipal}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="Accepted principal awaiting settlement"
            unit=" TEST UNITS"
            stagger={1}
          />
          <VeilReveal
            label="Private strategy shares"
            value={unveil.vault?.strategySharePrizeBalance}
            revealed={revealed}
            busy={unveil.busy === "reveal-vault"}
            detail="TEST/DEMO confidential shares"
            unit=" TEST SHARE UNITS"
            stagger={2}
          />
          <div className="private-stat private-stat--odds">
            <span>Your odds</span>
            <strong>NOT AVAILABLE</strong>
            <small>Aggregate round weight is not wallet-decryptable in V2.</small>
          </div>
        </div>
        <div className="vault-actions">
          <button
            className="button-primary"
            data-tour="private-reveal"
            disabled={Boolean(unveil.busy)}
            onClick={revealed ? unveil.hideVault : unveil.revealVaultStats}
          >
            {unveil.busy === "reveal-vault" ? "UNVEILING…" : revealed ? "VEIL POSITION" : "UNVEIL MY POSITION"}
          </button>
          <p>Your private values are decrypted only after your wallet authorizes the request and remain local to this session.</p>
        </div>
      </section>

      <section className="weight-reveal">
        <div>
          <span className="eyebrow">HISTORICAL WEIGHT</span>
          <h2>UNVEIL ONE ROUND.</h2>
          <p>If this wallet was included, it can decrypt only its own immutable snapshot weight.</p>
        </div>
        <div className="weight-control">
          <label htmlFor="round-select">ROUND</label>
          <select id="round-select" value={selectedRoundId} onChange={(event) => setRoundId(event.target.value)}>
            {roundIds.length ? (
              roundIds.map((id) => (
                <option key={id.toString()} value={id.toString()}>
                  {id.toString()}
                </option>
              ))
            ) : (
              <option value="">NO SETTLED ROUND</option>
            )}
          </select>
          <button
            className="button-secondary"
            disabled={Boolean(unveil.busy) || !selectedRoundId}
            onClick={() => selectedRoundId && unveil.revealRound(BigInt(selectedRoundId))}
          >
            {unveil.busy === "reveal-weight" ? "UNVEILING…" : "UNVEIL MY DRAW WEIGHT"}
          </button>
          {unveil.roundWeight && (
            <button className="button-quiet" onClick={unveil.hideRoundWeight}>
              VEIL WEIGHT
            </button>
          )}
        </div>
        <VeilReveal
          compact
          label={unveil.roundWeight ? "My weight" : "My encrypted weight"}
          value={unveil.roundWeight?.value}
          revealed={Boolean(unveil.roundWeight)}
          busy={unveil.busy === "reveal-weight"}
          detail={selectedRoundId ? `Immutable snapshot · Round ${selectedRoundId.padStart(2, "0")}` : "No round selected"}
          unit=" TEST UNITS"
        />
      </section>

      <div className="demo-disclaimer">TEST/DEMO ONLY · NOT PRODUCTION MARKET YIELD.</div>

      {showMotionDebug && MotionDebugVault && (
        <Suspense fallback={null}>
          <MotionDebugVault />
        </Suspense>
      )}
    </div>
  );
}
