import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from "react";
import { VeilReveal } from "../components/VeilReveal";
import { WithdrawalStatus } from "../components/WithdrawalStatus";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import {
  deriveSaveActions,
  deriveSaveStage,
  isRetryableSaveError,
  saveSourceSummary,
  saveSourceUnit,
  type SaveActionKind,
  type SaveMode,
  type SaveStage,
} from "../lib/savePresentation";
import { DASHBOARD_SEALED_SEGMENTS } from "../../../shared/homePresentation";
import "./savePage.css";

const MotionDebugVault = import.meta.env.DEV ? lazy(() => import("../dev/MotionDebugVault")) : null;

const PROGRESS_STEPS = ["SIGN", "ENCRYPT", "SUBMIT", "CONFIRM"] as const;

function progressIndex(stage: SaveStage) {
  switch (stage) {
    case "AUTHORIZATION":
    case "WALLET_CONFIRMATION":
      return 0;
    case "FHE_INIT":
    case "LOCAL_ENCRYPTION":
      return 1;
    case "SEPOLIA_CONFIRMATION":
      return 2;
    case "WITHDRAW_REQUEST":
      return 3;
    default:
      return -1;
  }
}

function AmountEcho({ amount }: { amount: string }) {
  if (!amount) return null;
  return (
    <span className="amount-digit-echo" aria-hidden="true">
      {amount.split("").map((digit, index) => (
        <i key={`${amount}-${index}`}>{digit}</i>
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
              "--fragment-shift": (index - (fragmentCount - 1) / 2) * 5,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

type SplitActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
};

function SplitActionButton({ label, className = "", ...props }: SplitActionButtonProps) {
  return (
    <button {...props} className={`save-split-action ${className}`.trim()} data-cursor="enter">
      <span className="save-split-label">{label.replace(/\s*→\s*$/, "")}</span>
      <span className="save-split-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

function SaveProgressRail({ stage }: { stage: SaveStage }) {
  const activeIndex = progressIndex(stage);
  if (activeIndex < 0) return null;
  return (
    <div className="save-progress-rail" role="status" aria-live="polite">
      <span className="save-progress-label">PROGRESS</span>
      <ol>
        {PROGRESS_STEPS.map((step, index) => (
          <li className={index <= activeIndex ? "active" : ""} key={step}>
            <i aria-hidden="true" />
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SavePrivateValue({
  label,
  value,
  unit,
  revealed,
}: {
  label: string;
  value?: bigint;
  unit: string;
  revealed: boolean;
}) {
  return (
    <div className="save-private-value">
      <span>{label}</span>
      <div aria-live="polite" aria-atomic="true">
        {revealed ? (
          <strong>
            {value?.toString() ?? "0"}
            <small>{unit}</small>
          </strong>
        ) : (
          <span className="save-cipher-segments" aria-label="Encrypted value sealed">
            {DASHBOARD_SEALED_SEGMENTS.map((width, index) => (
              <i aria-hidden="true" key={index} style={{ "--segment-width": `${width}px` } as CSSProperties} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function prizeRouteState(
  state: UnveilV4Controller["prizeRedemption"],
  recovery: UnveilV4Controller["prizeRedemptionRecovery"],
) {
  if (recovery || state?.status === "BLOCKED") return { label: "RECOVERY", index: 1 };
  switch (state?.status) {
    case "JOINED":
      return { label: "JOINED", index: 1 };
    case "WAITING_FOR_BATCH":
      return { label: "WAITING", index: 1 };
    case "DISPATCHED":
      return { label: "DISPATCHED", index: 2 };
    case "ROUTE_READY":
    case "CLAIMABLE":
      return { label: "CLAIMABLE", index: 3 };
    case "COMPLETE":
      return { label: "COMPLETE", index: 3 };
    case "CANCELED":
      return { label: state?.depositStatus === "REFUNDABLE" ? "REFUNDABLE" : "COMPLETE", index: 3 };
    default:
      return { label: "READY", index: 0 };
  }
}

function PrizeRedemptionRoute({
  state,
  recovery,
  busy,
  onAdvance,
  onRecover,
}: {
  state: UnveilV4Controller["prizeRedemption"];
  recovery: UnveilV4Controller["prizeRedemptionRecovery"];
  busy: string;
  onAdvance: () => void;
  onRecover: () => void;
}) {
  const route = prizeRouteState(state, recovery);
  const nodes = ["SHARES", "BATCH", "REDEEM", "PRINCIPAL"];
  return (
    <section className="save-prize-route" aria-label="Prize redemption lifecycle" aria-live="polite">
      <div className="save-prize-route-track">
        {nodes.map((node, index) => (
          <div className={index < route.index ? "complete" : index === route.index ? "current" : ""} key={node}>
            <i aria-hidden="true" />
            <span>{node}</span>
          </div>
        ))}
      </div>
      <strong className="save-prize-route-state">{route.label}</strong>
      {recovery ? (
        <div className="save-route-message">
          <span>Redemption submitted. Batch discovery is still pending.</span>
          <SplitActionButton
            className="save-route-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={onRecover}
            label={busy === "prize-redemption-recovery" ? "LOCATING…" : "RECOVER →"}
          />
        </div>
      ) : state?.action.actionable ? (
        <div className="save-route-message">
          <span>{state.action.description}</span>
          <SplitActionButton
            className="save-route-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={onAdvance}
            label={busy === "prize-redemption-lifecycle" ? "ADVANCING…" : `${state.action.title} →`}
          />
        </div>
      ) : null}
    </section>
  );
}

function SaveDialog({
  open,
  title,
  busy,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="save-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={dialogRef} className="save-modal" role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
        <div className="save-modal-heading">
          <h2 id="save-modal-title">{title}</h2>
          <button
            className="save-modal-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
            data-cursor="enter"
          >
            CLOSE ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SavePage({ unveil }: { unveil: UnveilV4Controller }) {
  const [mode, setMode] = useState<SaveMode>("deposit");
  const [withdrawSource, setWithdrawSource] = useState<"saved" | "prize">("saved");
  const [modalOpen, setModalOpen] = useState(false);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const roundIds = useMemo(() => unveil.history.map((round) => round.id), [unveil.history]);
  const [roundId, setRoundId] = useState("");
  const selectedRoundId = roundIds.some((id) => id.toString() === roundId) ? roundId : (roundIds[0]?.toString() ?? "");
  const revealed = Boolean(unveil.vault);
  const saveError = unveil.errorScope === "save" ? unveil.error : "";
  const saveNotice = unveil.noticeScope === "save" ? unveil.notice : "";
  const privateError = unveil.errorScope === "private" ? unveil.error : "";
  const isPrizeRedemption = mode === "withdraw" && withdrawSource === "prize";
  const showMotionDebug = import.meta.env.DEV && new URLSearchParams(window.location.search).get("motionDebug") === "1";
  const saveStage = deriveSaveStage({ busy: unveil.busy, notice: saveNotice, error: saveError, mode });
  const latestWithdrawal = unveil.dashboard?.latestWithdrawal;
  const latestWithdrawalSummary = latestWithdrawal
    ? `#${latestWithdrawal.requestId.toString()} · ${latestWithdrawal.status}`
    : "NONE";
  const personalSignal =
    unveil.connected && !unveil.wrongNetwork && unveil.dashboard
      ? unveil.dashboard?.pendingSeatAttestation
        ? "SEAT ATTESTATION PENDING · MATURITY PENDING"
        : unveil.dashboard?.seated
          ? "SEAT ACTIVE · MATURITY ONE COMPLETE DRAW PERIOD"
          : unveil.dashboard?.joined
            ? "SEAT NOT ACTIVE · MATURITY NOT ACTIVE"
            : "SEAT NOT JOINED · MATURITY NOT ACTIVE"
      : "";
  const sourceKind = mode === "deposit" ? "available" : isPrizeRedemption ? "prize" : "saved";
  const sourceLabel = sourceKind === "available" ? "AVAILABLE" : sourceKind === "prize" ? "PRIZE" : "SAVED";
  const sourceValue =
    sourceKind === "available"
      ? unveil.vault?.availablePrincipal
      : sourceKind === "prize"
        ? unveil.vault?.strategySharePrizeBalance
        : unveil.vault?.activePrincipal;
  const sourceSummary = saveSourceSummary(sourceKind, revealed, sourceValue);
  const sourceUnit = saveSourceUnit(sourceKind);
  const retryableSaveError = isRetryableSaveError(saveError, saveNotice);
  const saveActions = deriveSaveActions({
    connected: unveil.connected,
    wrongNetwork: unveil.wrongNetwork,
    accountReady: Boolean(unveil.dashboard),
    joined: Boolean(unveil.dashboard?.joined),
    vaultRevealed: revealed,
    activePrincipal: unveil.vault?.activePrincipal,
    reservedPrincipal: unveil.vault?.reservedPrincipal,
    prizeBalance: unveil.vault?.strategySharePrizeBalance,
    withdrawalActionable: Boolean(latestWithdrawal?.action?.actionable),
    hasWithdrawalState: Boolean(latestWithdrawal),
    redemptionActionable: Boolean(unveil.prizeRedemption?.action?.actionable),
    recoveryPending: Boolean(unveil.prizeRedemptionRecovery),
  });
  const reconnectAction = unveil.wrongNetwork
    ? "SWITCH TO SEPOLIA"
    : !unveil.connected
      ? mode === "deposit"
        ? "RECONNECT TO SAVE"
        : isPrizeRedemption
          ? "RECONNECT TO REDEEM"
          : "RECONNECT TO WITHDRAW"
      : "";

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

  function openAction(kind: SaveActionKind) {
    if (kind === "CONNECT") {
      void unveil.connect();
      return;
    }
    if (kind === "SWITCH_NETWORK") {
      void unveil.switchToSepolia();
      return;
    }
    if (kind === "CONTINUE_WITHDRAWAL") {
      setMode("withdraw");
      setWithdrawSource("saved");
      setModalOpen(true);
      return;
    }
    if (kind === "CONTINUE_REDEMPTION" || kind === "RECOVER_REDEMPTION") {
      setMode("withdraw");
      setWithdrawSource("prize");
      setModalOpen(true);
      return;
    }
    setMode(kind === "WITHDRAW" ? "withdraw" : "deposit");
    setModalOpen(true);
  }

  function closeModal() {
    if (!unveil.busy) setModalOpen(false);
  }

  function closeWeightModal() {
    if (unveil.busy === "reveal-weight") return;
    setWeightModalOpen(false);
    unveil.hideRoundWeight();
  }

  const actionErrorLabel = isPrizeRedemption ? "PRIZE ERROR" : mode === "withdraw" ? "WITHDRAWAL ERROR" : "SAVE ERROR";
  const primaryActionLabel = reconnectAction
    ? reconnectAction
    : saveError && retryableSaveError
      ? mode === "deposit"
        ? "RETRY SAVE"
        : isPrizeRedemption
          ? "RETRY REDEEM"
          : "RETRY REQUEST"
      : saveError
        ? "SUBMITTED · WAITING FOR CONFIRMATION"
        : saveStage === "SEALED" && mode === "deposit"
          ? "POSITION SEALED"
          : unveil.busy === mode
            ? mode === "deposit"
              ? "ENCRYPTING + SAVING…"
              : "ENCRYPTING REQUEST…"
            : unveil.busy === "prize-redeem"
              ? "REDEEMING…"
              : mode === "deposit"
                ? "SAVE PRIVATELY →"
                : isPrizeRedemption
                  ? "REDEEM PRIZE →"
                  : "REQUEST WITHDRAWAL →";

  return (
    <div
      className={`page-stack save-page save-page--clean save-page--${mode} ${amountFocused ? "save-page--amount-focused" : ""}`}
    >
      <header className="save-clean-header">
        <div className="save-heading-meta">
          <span>02 / SAVE</span>
          <span>SEPOLIA</span>
        </div>
        <div className="save-vault-motif" aria-hidden="true">
          <svg viewBox="0 0 720 520" focusable="false">
            <g className="save-vault-frame" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="112" y="38" width="520" height="444" />
              <rect x="128" y="54" width="488" height="412" />
              <path d="M154 80h436v360H154z" />
              <path d="M166 92h412v336H166z" opacity="0.52" />
              <path d="M112 222h184M488 222h144" />
              <path d="M128 238h168M488 238h128" opacity="0.56" />
              <path d="M112 126h16M112 126v-22M632 394h-16M632 394v22" />
            </g>
            <g className="save-vault-hinges" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="98" y="232" width="18" height="48" />
              <circle cx="98" cy="256" r="7" />
              <rect x="98" y="318" width="18" height="62" />
              <circle cx="98" cy="349" r="7" />
            </g>
            <g className="save-vault-door-panel" fill="none" stroke="currentColor">
              <path className="save-vault-door-edge" d="M154 80h436v360H154z" strokeWidth="1.4" />
              <path d="M166 92h412v336H166z" strokeWidth="1" opacity="0.56" />
              <g className="save-vault-dial" transform="translate(392 260)">
                <g className="save-vault-dial-rotor">
                  <circle r="164" strokeWidth="1.4" />
                  <circle r="148" strokeWidth="1" opacity="0.58" />
                  <circle r="116" strokeWidth="1.1" />
                  <circle r="76" strokeWidth="1" opacity="0.72" />
                  <circle r="28" strokeWidth="1.25" />
                  <g className="save-vault-ticks" strokeWidth="1" opacity="0.62">
                    <path d="M0-154v14" transform="rotate(0)" />
                    <path d="M0-154v14" transform="rotate(30)" />
                    <path d="M0-154v14" transform="rotate(60)" />
                    <path d="M0-154v14" transform="rotate(90)" />
                    <path d="M0-154v14" transform="rotate(120)" />
                    <path d="M0-154v14" transform="rotate(150)" />
                    <path d="M0-154v14" transform="rotate(180)" />
                    <path d="M0-154v14" transform="rotate(210)" />
                    <path d="M0-154v14" transform="rotate(240)" />
                    <path d="M0-154v14" transform="rotate(270)" />
                    <path d="M0-154v14" transform="rotate(300)" />
                    <path d="M0-154v14" transform="rotate(330)" />
                  </g>
                  <g className="save-vault-spokes" strokeWidth="1.35" opacity="0.86">
                    <path d="M0-30L0-116" />
                    <path d="M0-30L0-116" transform="rotate(45)" />
                    <path d="M0-30L0-116" transform="rotate(90)" />
                    <path d="M0-30L0-116" transform="rotate(135)" />
                    <path d="M0-30L0-116" transform="rotate(180)" />
                    <path d="M0-30L0-116" transform="rotate(225)" />
                    <path d="M0-30L0-116" transform="rotate(270)" />
                    <path d="M0-30L0-116" transform="rotate(315)" />
                  </g>
                </g>
                <circle r="10" strokeWidth="1" />
                <path d="M-8 0h16M0-8v16" strokeWidth="1" />
              </g>
            </g>
            <path className="save-vault-motif-seam" d="M392 96a164 164 0 0 1 146 90" />
          </svg>
        </div>
        <h1>
          <span className="save-hero-save">SAVE</span>
          <strong className="save-hero-private">PRIVATELY.</strong>
        </h1>
        <p>Your encrypted savings position.</p>
      </header>

      <section className="save-private-position" aria-label="Private position">
        <div className="save-private-heading">
          <h2>PRIVATE POSITION</h2>
          <span>{revealed ? "UNVEILED LOCALLY" : unveil.busy === "reveal-vault" ? "UNVEILING" : "FHE SEALED"}</span>
        </div>
        <div className="save-private-grid" aria-label="Private wallet balances">
          <SavePrivateValue
            label="AVAILABLE"
            value={unveil.vault?.availablePrincipal}
            unit=" cUSDC"
            revealed={revealed}
          />
          <SavePrivateValue label="SAVED" value={unveil.vault?.activePrincipal} unit=" cUSDC" revealed={revealed} />
          <SavePrivateValue
            label="WITHDRAWING"
            value={unveil.vault?.reservedPrincipal}
            unit=" cUSDC"
            revealed={revealed}
          />
          <SavePrivateValue
            label="PRIZE"
            value={unveil.vault?.strategySharePrizeBalance}
            unit=" VAULT SHARE UNITS"
            revealed={revealed}
          />
        </div>
        {privateError && (
          <div className="save-private-error" role="alert">
            <strong>PRIVATE REVEAL ERROR</strong>
            <span>{privateError}</span>
            <button
              type="button"
              onClick={unveil.clearError}
              aria-label="Dismiss private reveal error"
              data-cursor="enter"
            >
              ×
            </button>
          </div>
        )}
        <div className="save-private-actions">
          <SplitActionButton
            className="save-reveal-action"
            type="button"
            disabled={Boolean(unveil.busy)}
            onClick={revealed ? unveil.hideVault : unveil.revealVaultStats}
            label={unveil.busy === "reveal-vault" ? "UNVEILING…" : revealed ? "VEIL BALANCES →" : "UNVEIL BALANCES →"}
          />
          <span>
            {revealed
              ? "Plaintext remains local to this browser session."
              : "Values remain sealed until you authorize a local reveal."}
          </span>
        </div>
        {personalSignal && (
          <div className="save-personal-rail" data-tour="save-maturity">
            <span aria-hidden="true">●</span>
            {personalSignal}
          </div>
        )}
      </section>

      {saveActions.length > 0 && (
        <section className="save-main-actions" aria-label="Useful savings actions" data-tour="save-action">
          <span className="save-main-actions-label">USEFUL ACTIONS</span>
          <div className="save-main-actions-list">
            {saveActions.map((action) => (
              <SplitActionButton
                className={`save-main-action save-main-action--${action.kind.toLowerCase()}`}
                type="button"
                key={action.kind}
                onClick={() => openAction(action.kind)}
                disabled={Boolean(unveil.busy)}
                label={action.label}
              />
            ))}
          </div>
        </section>
      )}

      <SaveDialog
        open={modalOpen}
        title={mode === "deposit" ? "SAVE PRIVATELY" : "WITHDRAW"}
        busy={Boolean(unveil.busy)}
        onClose={closeModal}
      >
        <section
          className="save-action-surface"
          aria-label={mode === "deposit" ? "Save privately" : "Withdraw privately"}
        >
          <form
            className={`save-action-form ${unveil.busy ? "is-busy" : ""} ${saveError ? "has-error" : ""}`}
            onSubmit={onSubmit}
          >
            {mode === "withdraw" && (
              <div className="save-source-selector" role="group" aria-label="Withdraw from">
                <span>FROM</span>
                <button
                  type="button"
                  className={withdrawSource === "saved" ? "active" : ""}
                  aria-pressed={withdrawSource === "saved"}
                  onClick={() => setWithdrawSource("saved")}
                  data-cursor="enter"
                >
                  SAVED BALANCE
                </button>
                <button
                  type="button"
                  className={withdrawSource === "prize" ? "active" : ""}
                  aria-pressed={withdrawSource === "prize"}
                  onClick={() => setWithdrawSource("prize")}
                  data-cursor="enter"
                >
                  PRIZE BALANCE
                </button>
              </div>
            )}

            <div className="save-action-fields">
              <div className="save-source-line">
                <span>{sourceLabel}</span>
                <strong>{sourceSummary}</strong>
              </div>
              <div className="save-amount-label">
                <span>AMOUNT</span>
              </div>
              <div className="save-amount-input">
                <AmountFragments amount={amount} active={saveStage === "LOCAL_ENCRYPTION"} />
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
                <span>{sourceUnit}</span>
              </div>
              <p className="save-action-note">
                {isPrizeRedemption
                  ? "Shares are routed privately; the live vault determines the returned cUSDC amount."
                  : mode === "deposit"
                    ? "Your deposit becomes confidential principal."
                    : "The requested amount remains encrypted."}
              </p>
            </div>

            <SaveProgressRail stage={saveStage} />
            {!unveil.connected || unveil.wrongNetwork ? (
              <p className="save-wallet-note">
                {unveil.wrongNetwork ? "Switch to Sepolia to continue." : "Connect a wallet to continue."}
              </p>
            ) : null}

            <div className="save-submit-row">
              <SplitActionButton
                className="save-primary-action"
                data-cursor="enter"
                disabled={
                  Boolean(unveil.busy) || !amount || (isPrizeRedemption && Boolean(unveil.prizeRedemptionRecovery))
                }
                type="submit"
                label={primaryActionLabel}
              />
              {saveError && (
                <div className="save-action-feedback error" role="alert">
                  <strong>{actionErrorLabel}</strong>
                  <span>{saveError}</span>
                  <button type="button" onClick={unveil.clearError} aria-label="Dismiss save error" data-cursor="enter">
                    ×
                  </button>
                </div>
              )}
              {!saveError && saveNotice && (
                <div className="save-action-feedback" role="status">
                  {saveNotice}
                </div>
              )}
            </div>

            {mode === "withdraw" && !isPrizeRedemption && (
              <div className="save-withdrawal-status">
                {latestWithdrawal ? (
                  <WithdrawalStatus
                    request={latestWithdrawal}
                    connected={unveil.connected}
                    address={unveil.address}
                    busy={unveil.busy}
                    onAdvance={unveil.advanceWithdrawal}
                    onCancel={unveil.cancelWithdrawal}
                  />
                ) : (
                  <span>NO ACTIVE WITHDRAWAL</span>
                )}
              </div>
            )}
            {mode === "withdraw" && isPrizeRedemption && (
              <PrizeRedemptionRoute
                state={unveil.prizeRedemption}
                recovery={unveil.prizeRedemptionRecovery}
                busy={unveil.busy}
                onAdvance={() => void unveil.advancePrizeRedemption()}
                onRecover={() => void unveil.recoverPrizeRedemption()}
              />
            )}
            {mode === "deposit" && (
              <div className="save-demo-faucet">
                <span>DEMO PRINCIPAL</span>
                <SplitActionButton
                  className="save-faucet-action"
                  disabled={Boolean(unveil.busy)}
                  type="button"
                  onClick={unveil.fundTestToken}
                  label={unveil.busy === "fund" ? "CHECKING + WRAPPING…" : "GET DEMO cUSDC →"}
                />
              </div>
            )}
          </form>
        </section>
      </SaveDialog>

      <section className="save-details" aria-label="Savings details">
        <span>LATEST WITHDRAWAL · {latestWithdrawalSummary}</span>
        <button
          className="save-history-inspection"
          type="button"
          onClick={() => setWeightModalOpen(true)}
          data-cursor="enter"
        >
          INSPECT DRAW WEIGHT →
        </button>
      </section>

      <section className="save-works" aria-labelledby="save-works-title">
        <header className="save-works-heading">
          <span className="eyebrow">HOW SAVE WORKS</span>
          <h2 id="save-works-title">A PRIVATE POSITION, KEPT FLEXIBLE.</h2>
        </header>
        <div className="save-works-grid">
          {[
            ["01", "SAVE", "Deposit cUSDC into a confidential position."],
            ["02", "MATURE", "New savings become prize-weight eligible after one complete draw period."],
            ["03", "STAY FLEXIBLE", "Save more or request withdrawal without publishing your private amount."],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <SaveDialog
        open={weightModalOpen}
        title="HISTORICAL DRAW WEIGHT"
        busy={unveil.busy === "reveal-weight"}
        onClose={closeWeightModal}
      >
        <section className="save-weight-modal-content" aria-label="Historical draw weight inspection">
          <div className="save-weight-modal-intro">
            <span className="eyebrow">PRIVATE SNAPSHOT</span>
            <strong>FHE SEALED</strong>
            <p>Only this wallet can unveil its own immutable mature snapshot weight.</p>
          </div>
          <div className="save-weight-modal-control">
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
          </div>
          <VeilReveal
            compact
            label={unveil.roundWeight ? "MY WEIGHT" : "PRIVATE SNAPSHOT"}
            value={unveil.roundWeight?.value}
            revealed={Boolean(unveil.roundWeight)}
            busy={unveil.busy === "reveal-weight"}
            detail={
              selectedRoundId ? `Immutable snapshot · Round ${selectedRoundId.padStart(2, "0")}` : "No round selected"
            }
            unit=" cUSDC"
          />
          <div className="save-weight-modal-actions">
            <SplitActionButton
              className="save-primary-action"
              type="button"
              disabled={Boolean(unveil.busy) || !selectedRoundId}
              onClick={() => selectedRoundId && void unveil.revealRound(BigInt(selectedRoundId))}
              label={unveil.busy === "reveal-weight" ? "UNVEILING…" : "UNVEIL WEIGHT →"}
            />
            {unveil.roundWeight && (
              <SplitActionButton
                className="save-secondary-action"
                type="button"
                onClick={unveil.hideRoundWeight}
                label="VEIL WEIGHT →"
              />
            )}
          </div>
        </section>
      </SaveDialog>

      <footer className="save-demo-footer">DEMO cUSDC INFRASTRUCTURE · NOT PRODUCTION MARKET YIELD.</footer>

      {showMotionDebug && MotionDebugVault && (
        <Suspense fallback={null}>
          <MotionDebugVault />
        </Suspense>
      )}
    </div>
  );
}
