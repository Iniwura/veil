import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { RouteLink } from "./RouteLink";
import type { UnveilV4Controller } from "../hooks/useUnveilV4";
import type { AppRoute } from "../lib/routes";
import { walletActionLabel, walletButtonAction } from "../lib/walletPresentation";

const NAV: Array<[AppRoute, string, string]> = [
  ["/app", "01", "Home"],
  ["/app/save", "02", "Save"],
  ["/app/draw", "03", "Draw"],
];

export function AppShell({
  route,
  unveil,
  children,
  onReplayGuide,
}: {
  route: AppRoute;
  unveil: UnveilV4Controller;
  children: ReactNode;
  onReplayGuide: () => void;
}) {
  const walletLabel = walletActionLabel(unveil);
  const walletButtonActionState = walletButtonAction(unveil);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const walletButtonRef = useRef<HTMLButtonElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const globalNotice = unveil.noticeScope === "global" ? unveil.notice : "";
  const globalError = unveil.errorScope === "global" ? unveil.error : "";
  const publicState = unveil.publicError
    ? unveil.publicProtocol
      ? "PROTOCOL STALE"
      : "PROTOCOL UNAVAILABLE"
    : unveil.publicProtocol
      ? "PROTOCOL LIVE"
      : "PROTOCOL LOADING";
  const sessionLabel = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : unveil.walletState === "account-changed"
      ? "WALLET ACCOUNT CHANGED"
      : unveil.walletState === "reconnect-required"
        ? "RECONNECT REQUIRED"
        : globalError
          ? "ACTION NEEDS ATTENTION"
          : "WALLET SESSION";

  useEffect(() => {
    if (!unveil.connected) setSessionMenuOpen(false);
  }, [unveil.connected]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSessionMenuOpen(false);
      walletButtonRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sessionMenuOpen]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    sessionMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [sessionMenuOpen]);

  return (
    <div className="app-shell">
      <div className="app-workspace">
        <header className="app-topbar">
          <RouteLink to="/" className="wordmark app-brand" dataCursor="enter">
            <BrandMark compact />
            <strong>UNVEIL</strong>
          </RouteLink>
          <nav className="app-nav" aria-label="Application navigation">
            {NAV.map(([to, index, label]) => (
              <RouteLink
                to={to}
                className={route === to ? "active" : ""}
                dataCursor="enter"
                key={to}
              >
                <span>{index}</span>
                <strong>{label}</strong>
              </RouteLink>
            ))}
          </nav>
          <div className="app-topbar-status" aria-label="Network and public state">
            <div className="app-public-state">
              <span
                className={`live-dot ${unveil.publicError ? (unveil.publicProtocol ? "stale" : "unavailable") : ""}`}
              />
              {publicState}
            </div>
            <span className="network-chip">SEPOLIA</span>
          </div>
          <div className="app-topbar-tools">
            <button className="help-button" type="button" onClick={onReplayGuide} data-cursor="enter">
              HELP
            </button>
          </div>
          <div className="wallet-session-control">
            <button
              ref={walletButtonRef}
              className="wallet-button"
              type="button"
              onClick={() => {
                if (walletButtonActionState === "open-menu") {
                  setSessionMenuOpen((open) => !open);
                } else if (walletButtonActionState === "switch-network") {
                  void unveil.switchToSepolia();
                } else {
                  void unveil.connect();
                }
              }}
              disabled={unveil.busy === "connect" || unveil.busy === "switch-network"}
              aria-haspopup={unveil.connected ? "menu" : undefined}
              aria-expanded={unveil.connected ? sessionMenuOpen : false}
              aria-controls={unveil.connected ? "wallet-session-menu" : undefined}
              data-tour="wallet"
              data-cursor="enter"
            >
              {walletLabel}
            </button>
            {unveil.connected && sessionMenuOpen && (
              <div
                ref={sessionMenuRef}
                id="wallet-session-menu"
                className="wallet-session-menu"
                role="menu"
                aria-label="Wallet session"
              >
                <div role="none">
                  <span>CONNECTED SESSION</span>
                  <strong>{walletLabel}</strong>
                  <small>SEPOLIA</small>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSessionMenuOpen(false);
                    unveil.disconnectSession();
                    walletButtonRef.current?.focus();
                  }}
                >
                  DISCONNECT
                </button>
              </div>
            )}
          </div>
        </header>
        {(globalError || unveil.wrongNetwork || globalNotice) && (
          <div
            className={`session-status ${globalError || unveil.wrongNetwork ? "session-status--error" : ""}`}
            role={globalError || unveil.wrongNetwork ? "alert" : "status"}
          >
            <span>{sessionLabel}</span>
            <p>{globalError || globalNotice || "Switch to Sepolia to continue."}</p>
            {globalError && (
              <button type="button" onClick={unveil.clearError} aria-label="Dismiss error">
                ×
              </button>
            )}
          </div>
        )}
        <main className="app-content">{children}</main>
        <p className="app-demo-note">SEPOLIA · DEMO cUSDC · SIMULATED YIELD</p>
      </div>
      <nav className="mobile-nav" aria-label="Mobile application navigation">
        {NAV.map(([to, , label]) => (
          <RouteLink
            to={to}
            className={route === to ? "active" : ""}
            dataCursor="enter"
            key={to}
          >
            <i aria-hidden="true" />
            <span>{label}</span>
          </RouteLink>
        ))}
      </nav>
    </div>
  );
}
