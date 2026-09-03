import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { VeilReveal } from "../components/VeilReveal";
import { WithdrawalStatus } from "../components/WithdrawalStatus";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import {
  deriveSaveStage,
  DEPOSIT_STAGES,
  saveStageIndex,
  type SaveMode,
  type SaveStage,
} from "../lib/savePresentation";
import { shortAddress } from "../lib/format";

const MotionDebugVault = import.meta.env.DEV ? lazy(() => import("../dev/MotionDebugVault")) : null;

const STAGE_LABELS: Record<SaveStage, string> = {
  IDLE: "READY TO SEAL",
  AUTHORIZATION: "AUTHORIZATION",
  FHE_INIT: "FHE INITIALIZATION",
  LOCAL_ENCRYPTION: "LOCAL ENCRYPTION",
  WALLET_CONFIRMATION: "WALLET CONFIRMATION",
  SEPOLIA_CONFIRMATION: "SEPOLIA CONFIRMATION",
  WITHDRAW_REQUEST: "ENCRYPTED REQUEST",
  SEALED: "POSITION SEALED",
  ERROR: "SEAM INTERRUPTED",
};

const STAGE_DESCRIPTIONS: Record<SaveStage, string> = {
  IDLE: "Your amount stays encrypted after it enters the pool.",
  AUTHORIZATION: "Checking the confidential principal route.",
  FHE_INIT: "Preparing the local encrypted operation.",
  LOCAL_ENCRYPTION: "Your amount is becoming an encrypted request.",
  WALLET_CONFIRMATION: "Motion pauses while your wallet confirms.",
  SEPOLIA_CONFIRMATION: "The encrypted request is settling on Sepolia.",
  WITHDRAW_REQUEST: "Your withdrawal request remains encrypted in transit.",
  SEALED: "Position sealed. New savings mature for prizes after one complete draw period.",
  ERROR: "The request did not complete. Your amount remains available to retry.",
};

const STAGE_STEP_LABELS: Record<(typeof DEPOSIT_STAGES)[number], string> = {
  AUTHORIZATION: "AUTHORIZATION",
  FHE_INIT: "FHE INITIALIZATION",
  LOCAL_ENCRYPTION: "LOCAL ENCRYPTION",
  WALLET_CONFIRMATION: "WALLET CONFIRMATION",
  SEPOLIA_CONFIRMATION: "SEPOLIA CONFIRMATION",
};

function AmountEcho({ amount }: { amount: string }) {
  const display = amount || "0";
  return (
    <span key={display} className="amount-digit-echo" aria-hidden="true">
      {display.split("").map((digit, index) => (
        <i key={`${display}-${index}`}>{digit}</i>
      ))}
    </span>
  );
}

function AmountFragments({ amount, active }: { amount: string; active: boolean }) {
  const fragmentCount = Math.min(16, Math.max(8, (amount || "0").length * 3));
  return (
    <div
      className={`amount-fragments ${active ? "amount-fragments--active" : ""}`}
      style={{ "--fragment-count": fragmentCount } as CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: fragmentCount }, (_, index) => (
        <i
          key={`${amount || "zero"}-${index}`}
          style={
            {
              "--fragment-index": index,
              "--fragment-shift": Math.round((index - (fragmentCount - 1) / 2) * 5),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function DepositStageRail({ stage }: { stage: SaveStage }) {
  const activeIndex = saveStageIndex(stage);
  const visible = activeIndex >= 0 || stage === "SEALED" || stage === "ERROR";
  if (!visible) return null;
  return (
    <div className={`save-stage-rail save-stage-rail--${stage.toLowerCase()}`} role="status" aria-live="polite">
      <div className="save-stage-heading">
        <span>
          {stage === "SEALED" ? "POSITION SEALED" : stage === "ERROR" ? "SAVE INTERRUPTED" : "SEALING YOUR POSITION"}
        </span>
        <strong>{STAGE_LABELS[stage]}</strong>
      </div>
      <div className="save-stage-track">
        {DEPOSIT_STAGES.map((step, index) => {
          const completed = stage === "SEALED" || (activeIndex >= 0 && index < activeIndex);
          const active = stage === step;
          return (
            <div
              key={step}
              className={`save-stage-step ${completed ? "save-stage-step--complete" : ""} ${active ? "save-stage-step--active" : ""}`}
            >
              <i aria-hidden="true" />
              <span>{STAGE_STEP_LABELS[step]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WithdrawRequestVisual({ active }: { active: boolean }) {
  return (
    <div className={`withdraw-request-visual ${active ? "withdraw-request-visual--active" : ""}`} aria-hidden="true">
      <span>ENCRYPTED REQUEST PACKET</span>
      <i />
      <i />
      <i />
    </div>
  );
}

export function SavePage({ unveil }: { unveil: UnveilV4Controller }) {
  const [mode, setMode] = useState<SaveMode>("deposit");
  const [withdrawSource, setWithdrawSource] = useState<"saved" | "prize">("saved");
  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const roundIds = useMemo(() => unveil.history.map((round) => round.id), [unveil.history]);
  const [roundId, setRoundId] = useState("");
  const selectedRoundId = roundIds.some((id) => id.toString() === roundId) ? roundId : (roundIds[0]?.toString() ?? "");
  const revealed = Boolean(unveil.vault);
  const saveError = unveil.errorScope === "save" ? unveil.error : "";
  const saveNotice = unveil.noticeScope === "save" ? unveil.notice : "";
  const privateError = unveil.errorScope === "private" ? unveil.error : "";
  const privateNotice = unveil.noticeScope === "private" ? unveil.notice : "";
  const isPrizeRedemption = mode === "withdraw" && withdrawSource === "prize";
  const showMotionDebug = import.meta.env.DEV && new URLSearchParams(window.location.search).get("motionDebug") === "1";
  const saveStage = deriveSaveStage({ busy: unveil.busy, notice: saveNotice, error: saveError, mode });
  const amountFragmentsActive = saveStage === "LOCAL_ENCRYPTION";
  const withdrawRequestActive = saveStage === "WITHDRAW_REQUEST";
  const seatStatus = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : !unveil.connected
      ? "CONNECT WALLET"
      : unveil.dashboard?.pendingSeatAttestation
        ? "ATTESTATION PENDING"
        : unveil.dashboard?.seated
          ? "ACTIVE"
          : unveil.dashboard?.joined
            ? "NOT ACTIVE"
            : "NOT JOINED";
  const latestWithdrawal = unveil.dashboard?.latestWithdrawal;
  const latestWithdrawalSummary = latestWithdrawal
    ? `#${latestWithdrawal.requestId.toString()} · ${latestWithdrawal.status}`
    : "NONE";
  const maturityStatus = !unveil.connected
    ? "CONNECT WALLET"
    : unveil.dashboard?.pendingSeatAttestation
      ? "KMS ATTESTATION PENDING"
      : unveil.dashboard?.seated
        ? "ONE COMPLETE DRAW PERIOD · SNAPSHOT AUTHORITATIVE"
        : unveil.dashboard?.joined
          ? "SEAT ACTIVATION REQUIRED"
          : "DEPOSIT TO BEGIN MATURITY";
  const walletLabel = unveil.wrongNetwork
    ? "CONNECTED"
    : unveil.connected
      ? shortAddress(unveil.address)
      : "DISCONNECTED";
  const accountStatusHeadline = unveil.wrongNetwork
    ? "Network change required."
    : !unveil.connected
      ? "Wallet connection required."
      : mode === "deposit"
        ? "Quietly ready."
        : isPrizeRedemption
          ? "Redemption route in view."
          : "Request in view.";

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
    else if (isPrizeRedemption) await unveil.redeemPrize(value);
    else await unveil.withdraw(value);
    setAmount("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <div
      className={`page-stack save-page route-enter save-page--${mode} ${amountFocused ? "save-page--amount-focused" : ""}`}
    >
      <header className="save-page-heading page-heading">
        <div className="save-heading-meta">
          <span>02 / SAVE</span>
          <span>CONFIDENTIAL PRINCIPAL</span>
          <span>SEPOLIA · V4</span>
        </div>
        <h1>
          SAVE
          <strong>PRIVATELY.</strong>
        </h1>
        <p>
          Save TEST principal into a confidential position. V4 uses mature encrypted balance for prize weight without
          publishing the amount.
        </p>
      </header>

      {(saveError || saveNotice) && (
        <div
          className={`action-notice save-notice-rail ${saveError ? "action-notice--error" : ""}`}
          role={saveError ? "alert" : "status"}
        >
          <span>
            {saveError
              ? isPrizeRedemption
                ? "PRIZE REDEMPTION ERROR"
                : "SAVE ERROR"
              : saveStage === "SEALED"
                ? "POSITION SEALED"
                : "SAVE UPDATE"}
          </span>
          <p>{saveError || saveNotice}</p>
          {saveError && (
            <button
              className="action-notice-dismiss"
              type="button"
              onClick={unveil.clearError}
              aria-label="Dismiss save error"
            >
              ×
            </button>
          )}
        </div>
      )}

      <section className="save-layout save-layout--signature">
        <form
          className={`transaction-panel transaction-panel--signature ${unveil.busy === mode ? "transaction-panel--sealing" : ""} ${amountFocused ? "transaction-panel--focused" : ""} ${saveError ? "transaction-panel--error" : ""}`}
          onSubmit={onSubmit}
        >
          <div className="save-command-meta">
            <span>PRIVATE INPUT</span>
            <span>
              {mode === "deposit" ? "PRINCIPAL IN" : isPrizeRedemption ? "PRIZE SHARES OUT" : "PRINCIPAL OUT"}
            </span>
          </div>
          <div className="mode-switch" role="tablist" aria-label="Save action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "deposit"}
              className={mode === "deposit" ? "active" : ""}
              onClick={() => setMode("deposit")}
            >
              DEPOSIT
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "withdraw"}
              className={mode === "withdraw" ? "active" : ""}
              onClick={() => setMode("withdraw")}
            >
              WITHDRAW
            </button>
            <i className="mode-switch-seam" aria-hidden="true" />
          </div>
          {mode === "withdraw" && (
            <div className="withdraw-source-switch" role="group" aria-label="Withdraw from">
              <span>WITHDRAW FROM</span>
              <button
                type="button"
                className={withdrawSource === "saved" ? "active" : ""}
                aria-pressed={withdrawSource === "saved"}
                onClick={() => setWithdrawSource("saved")}
              >
                SAVED BALANCE
              </button>
              <button
                type="button"
                className={withdrawSource === "prize" ? "active" : ""}
                aria-pressed={withdrawSource === "prize"}
                onClick={() => setWithdrawSource("prize")}
              >
                PRIZE BALANCE
              </button>
            </div>
          )}
          <div className="amount-command">
            <div className="transaction-label">
              <span>
                {mode === "deposit" ? "Amount to save" : isPrizeRedemption ? "Amount to redeem" : "Amount to request"}
              </span>
              <small>{isPrizeRedemption ? "TEST SHARE UNITS" : "WHOLE TEST UNITS"}</small>
            </div>
            <div className="amount-input" data-tour="save-amount">
              <AmountFragments amount={amount} active={amountFragmentsActive} />
              <AmountEcho amount={amount} />
              <input
                aria-label={
                  mode === "deposit"
                    ? "Deposit amount"
                    : isPrizeRedemption
                      ? "Prize redemption amount"
                      : "Withdrawal amount"
                }
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              />
              <span>{isPrizeRedemption ? "SHARES" : "TEST"}</span>
            </div>
            <p className="amount-command-note">
              {isPrizeRedemption
                ? "Redeem confidential strategy shares back into confidential TEST principal."
                : STAGE_DESCRIPTIONS[saveStage]}
            </p>
          </div>
          <DepositStageRail stage={mode === "deposit" ? saveStage : "IDLE"} />
          {mode === "withdraw" && !isPrizeRedemption && <WithdrawRequestVisual active={withdrawRequestActive} />}
          {!unveil.connected && !unveil.wrongNetwork && (
            <div className="notice save-wallet-note">
              <strong>WALLET DISCONNECTED</strong>
              <p>Connect a Sepolia wallet before submitting a confidential transaction.</p>
            </div>
          )}
          <button
            className={`button-primary button-full save-primary-action save-primary-action--${saveStage.toLowerCase()}`}
            data-cursor="enter"
            data-tour="save-submit"
            disabled={Boolean(unveil.busy) || !amount || (isPrizeRedemption && Boolean(unveil.prizeRedemptionRecovery))}
            type="submit"
          >
            <span>
              {saveError
                ? mode === "deposit"
                  ? "RETRY SAVE"
                  : isPrizeRedemption
                    ? "RETRY PRIZE REDEMPTION"
                    : "RETRY REQUEST"
                : saveStage === "SEALED" && mode === "deposit"
                  ? "POSITION SEALED ✓"
                  : unveil.busy === mode
                    ? mode === "deposit"
                      ? "ENCRYPTING + SAVING…"
                      : "ENCRYPTING REQUEST…"
                    : unveil.busy === "prize-redeem"
                      ? "REDEEMING PRIZE…"
                      : mode === "deposit"
                        ? "SAVE PRIVATELY"
                        : isPrizeRedemption
                          ? "REDEEM PRIZE"
                          : "REQUEST WITHDRAWAL"}
            </span>
            <i aria-hidden="true">{saveStage === "SEALED" ? "✓" : "→"}</i>
          </button>
          <div className="faucet-strip">
            <span>NEED TEST PRINCIPAL?</span>
            <button
              className="button-quiet"
              disabled={Boolean(unveil.busy)}
              type="button"
              onClick={unveil.fundTestToken}
            >
              {unveil.busy === "fund" ? "CHECKING + WRAPPING…" : "GET TEST TOKEN →"}
            </button>
          </div>
          <p className="form-note">The faucet is demo infrastructure for TEST token only.</p>
        </form>

        <aside className="account-status-region account-status-region--utility">
          <div className="account-status-heading">
            <span className="eyebrow">ACCOUNT STATUS</span>
            <h2>{accountStatusHeadline}</h2>
          </div>
          <dl className="account-status-list">
            <div>
              <dt>WALLET</dt>
              <dd>{walletLabel}</dd>
            </div>
            <div>
              <dt>DRAW SEAT</dt>
              <dd>{seatStatus}</dd>
            </div>
            {unveil.dashboard?.pendingSeatAttestation && (
              <div>
                <dt>KMS ATTESTATION</dt>
                <dd>KEEPER QUEUED · NO WALLET ACTION</dd>
              </div>
            )}
            <div>
              <dt>NETWORK</dt>
              <dd>{unveil.wrongNetwork ? "SWITCH TO SEPOLIA" : "SEPOLIA"}</dd>
            </div>
            <div>
              <dt>LATEST WITHDRAWAL</dt>
              <dd>{latestWithdrawal?.status ?? "NONE LOADED"}</dd>
            </div>
          </dl>
          {mode === "deposit" ? (
            <p>
              Deposits become confidential principal immediately. New savings contribute mature prize weight only after
              one complete draw period while the draw seat remains active.
            </p>
          ) : isPrizeRedemption ? (
            <div className="prize-redemption-panel" aria-live="polite">
              <div className="prize-redemption-heading">
                <span>PRIZE REDEMPTION ROUTE</span>
                <strong>
                  {unveil.prizeRedemptionRecovery ? "BATCH DISCOVERY" : (unveil.prizeRedemption?.status ?? "READY")}
                </strong>
              </div>
              {unveil.prizeRedemptionRecovery ? (
                <>
                  <p>Redemption transaction submitted. Locating its onchain batch. Do not submit another redemption.</p>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={Boolean(unveil.busy)}
                    onClick={unveil.recoverPrizeRedemption}
                  >
                    {unveil.busy === "prize-redemption-recovery" ? "LOCATING BATCH…" : "RECOVER REDEMPTION"}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    {unveil.prizeRedemption?.depositStatus === "REFUNDABLE"
                      ? "Confidential strategy shares can be returned to your wallet."
                      : "Redeem confidential strategy shares back into confidential TEST principal. The resulting principal arrives in AVAILABLE TO SAVE."}
                  </p>
                  {unveil.prizeRedemption && (
                    <dl className="prize-redemption-details">
                      <div>
                        <dt>BATCH</dt>
                        <dd>#{unveil.prizeRedemption.batchId.toString()}</dd>
                      </div>
                      <div>
                        <dt>READY AT</dt>
                        <dd>{new Date(Number(unveil.prizeRedemption.batchMaturesAt) * 1000).toLocaleString()}</dd>
                      </div>
                    </dl>
                  )}
                  {unveil.prizeRedemption?.action.actionable && (
                    <button
                      className="button-secondary"
                      type="button"
                      disabled={Boolean(unveil.busy)}
                      onClick={unveil.advancePrizeRedemption}
                    >
                      {unveil.busy === "prize-redemption-lifecycle"
                        ? "ADVANCING REDEMPTION…"
                        : unveil.prizeRedemption.action.title}
                    </button>
                  )}
                  {!unveil.prizeRedemption && <p>Submit a prize redemption to join the next confidential batch.</p>}
                </>
              )}
            </div>
          ) : (
            <>
              <p>Requests settle instantly when liquid or remain queued until strategy liquidity is available.</p>
              <WithdrawalStatus
                request={latestWithdrawal}
                connected={unveil.connected}
                address={unveil.address}
                busy={unveil.busy}
                onAdvance={unveil.advanceWithdrawal}
                onCancel={unveil.cancelWithdrawal}
              />
            </>
          )}
        </aside>
      </section>

      <section
        className={`vault-surface private-position-instrument ${revealed ? "vault-surface--revealed" : ""} ${unveil.busy === "reveal-vault" ? "vault-surface--unveiling" : ""}`}
        data-tour="private-position"
        data-cursor="sealed"
      >
        <div className="save-section-heading">
          <div>
            <span className="eyebrow">PRIVATE ACCOUNT DASHBOARD</span>
            <h2>{revealed ? "BALANCES UNVEILED LOCALLY" : unveil.busy === "reveal-vault" ? "UNVEILING" : "SEALED"}</h2>
          </div>
          <span className={`vault-seal ${revealed ? "open" : ""}`}>{revealed ? "UNVEILED LOCALLY" : "FHE SEALED"}</span>
        </div>
        {(privateError || privateNotice) && (
          <div
            className={`action-notice private-notice ${privateError ? "action-notice--error" : ""}`}
            role={privateError ? "alert" : "status"}
          >
            <span>{privateError ? "PRIVATE REVEAL ERROR" : "PRIVATE UPDATE"}</span>
            <p>{privateError || privateNotice}</p>
            {privateError && (
              <button
                className="action-notice-dismiss"
                type="button"
                onClick={unveil.clearError}
                aria-label="Dismiss private reveal error"
              >
                ×
              </button>
            )}
          </div>
        )}
        {unveil.busy === "reveal-vault" && (
          <div className="vault-reveal-progress" role="status" aria-label="Private balance reveal in progress">
            <i className="active">01 · WALLET AUTHORIZATION</i>
            <i>02 · DECRYPTING AUTHORIZED CIPHERTEXTS</i>
            <i>03 · LOCAL REVEAL</i>
          </div>
        )}
        <div className="private-balance-dashboard">
          <i className="private-instrument-material" aria-hidden="true" />
          <div className="private-balance-grid">
            <VeilReveal
              label="AVAILABLE TO SAVE"
              value={unveil.vault?.availablePrincipal}
              revealed={revealed}
              busy={unveil.busy === "reveal-vault"}
              detail="Confidential principal held in this wallet"
              unit=" TEST UNITS"
              stagger={0}
            />
            <VeilReveal
              label="SAVED IN UNVEIL"
              value={unveil.vault?.activePrincipal}
              revealed={revealed}
              busy={unveil.busy === "reveal-vault"}
              detail="TEST confidential principal"
              unit=" TEST UNITS"
              stagger={1}
            />
            <VeilReveal
              label="PENDING WITHDRAWAL"
              value={unveil.vault?.reservedPrincipal}
              revealed={revealed}
              busy={unveil.busy === "reveal-vault"}
              detail="Accepted principal awaiting settlement"
              unit=" TEST UNITS"
              stagger={2}
            />
            <VeilReveal
              label="PRIZE BALANCE"
              value={unveil.vault?.strategySharePrizeBalance}
              revealed={revealed}
              busy={unveil.busy === "reveal-vault"}
              detail="Confidential strategy shares held by this wallet"
              unit=" TEST SHARE UNITS"
              stagger={3}
            />
          </div>
          <div className="private-balance-context" aria-label="Private account status">
            <div>
              <span>DRAW SEAT</span>
              <strong>{seatStatus}</strong>
            </div>
            <div>
              <span>ELIGIBILITY / MATURITY</span>
              <strong>{maturityStatus}</strong>
            </div>
            <div>
              <span>LATEST WITHDRAWAL</span>
              <strong>{latestWithdrawalSummary}</strong>
            </div>
            <p>Exact mature weight and odds remain private snapshot outputs, never aggregate dashboard values.</p>
          </div>
        </div>
        <div className="vault-actions">
          <button
            className="button-primary"
            type="button"
            data-cursor="sealed"
            data-tour="private-reveal"
            disabled={Boolean(unveil.busy)}
            onClick={revealed ? unveil.hideVault : unveil.revealVaultStats}
          >
            {unveil.busy === "reveal-vault" ? "UNVEILING…" : revealed ? "VEIL MY BALANCES" : "UNVEIL MY BALANCES"}
          </button>
          <p>
            Your private values are decrypted only after your wallet authorizes the request and remain local to this
            session.
          </p>
        </div>
      </section>

      <details className="weight-reveal advanced-private-data" data-cursor="sealed">
        <summary>Inspect historical draw weight</summary>
        <div className="weight-reveal-body">
          <div>
            <span className="eyebrow">ADVANCED PRIVATE DATA</span>
            <h2>Unveil one round.</h2>
            <p>If this wallet was included, it can decrypt only its own immutable mature snapshot weight.</p>
          </div>
          <div className="weight-control">
            <label htmlFor="round-select">ROUND</label>
            <select id="round-select" value={selectedRoundId} onChange={(event) => setRoundId(event.target.value)}>
              {roundIds.length ? (
                roundIds.map((id) => (
                  <option key={id.toString()} value={id.toString()}>
                    {id.toString().padStart(2, "0")}
                  </option>
                ))
              ) : (
                <option value="">NO SETTLED ROUND</option>
              )}
            </select>
            <button
              className="button-secondary"
              type="button"
              disabled={Boolean(unveil.busy) || !selectedRoundId}
              onClick={() => selectedRoundId && unveil.revealRound(BigInt(selectedRoundId))}
            >
              {unveil.busy === "reveal-weight" ? "UNVEILING…" : "UNVEIL MY DRAW WEIGHT"}
            </button>
            {unveil.roundWeight && (
              <button className="button-quiet" type="button" onClick={unveil.hideRoundWeight}>
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
            detail={
              selectedRoundId ? `Immutable snapshot · Round ${selectedRoundId.padStart(2, "0")}` : "No round selected"
            }
            unit=" TEST UNITS"
          />
        </div>
      </details>

      <div className="demo-disclaimer">TEST/DEMO ONLY · NOT PRODUCTION MARKET YIELD.</div>

      {showMotionDebug && MotionDebugVault && (
        <Suspense fallback={null}>
          <MotionDebugVault />
        </Suspense>
      )}
    </div>
  );
}
