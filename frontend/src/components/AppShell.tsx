import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { DemoBadge } from "./DemoBadge";
import { RouteLink } from "./RouteLink";
import type { UnveilController } from "../hooks/useUnveil";
import type { AppRoute } from "../lib/routes";
import { shortAddress } from "../lib/format";

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
  unveil: UnveilController;
  children: ReactNode;
  onReplayGuide: () => void;
}) {
  const walletAction = unveil.wrongNetwork ? unveil.switchToSepolia : unveil.connect;
  const walletLabel =
    unveil.busy === "switch-network"
      ? "SWITCHING…"
      : unveil.wrongNetwork
        ? "SWITCH TO SEPOLIA"
        : unveil.busy === "connect"
          ? "CONNECTING…"
          : unveil.address
            ? shortAddress(unveil.address)
            : unveil.walletState === "reconnect-required" || unveil.walletState === "account-changed"
              ? "RECONNECT WALLET"
              : "CONNECT WALLET";
  const globalNotice = unveil.noticeScope === "global" ? unveil.notice : "";
  const sessionLabel = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : unveil.walletState === "account-changed"
      ? "WALLET ACCOUNT CHANGED"
      : unveil.walletState === "reconnect-required"
        ? "RECONNECT REQUIRED"
        : unveil.error
          ? "ACTION NEEDS ATTENTION"
          : "WALLET SESSION";
  return (
    <div className="app-shell">
      <div className="app-workspace">
        <header className="app-topbar">
          <RouteLink to="/" className="wordmark app-brand">
            <BrandMark compact />
            <strong>UNVEIL</strong>
          </RouteLink>
          <nav className="app-nav" aria-label="Application navigation">
            {NAV.map(([to, index, label]) => (
              <RouteLink
                to={to}
                className={route === to ? "active" : ""}
                dataTour={to === "/app/save" ? "nav-save" : to === "/app/draw" ? "nav-draw" : "nav-home"}
                key={to}
              >
                <span>{index}</span>
                <strong>{label}</strong>
              </RouteLink>
            ))}
          </nav>
          <div className="app-public-state">
            <span className={`live-dot ${unveil.publicError ? "unavailable" : ""}`} />
            {unveil.publicError ? "PUBLIC V2 STATE UNAVAILABLE" : "PUBLIC V2 STATE LIVE"}
          </div>
          <DemoBadge compact />
          <span className="theme-chip" aria-label="Current theme: dark">
            DARK
          </span>
          <button className="help-button" onClick={onReplayGuide}>
            HELP
          </button>
          <span className="network-chip">SEPOLIA</span>
          <button className="wallet-button" onClick={walletAction} disabled={Boolean(unveil.busy)} data-tour="wallet">
            {walletLabel}
          </button>
        </header>
        {(unveil.error || unveil.wrongNetwork || globalNotice) && (
          <div
            className={`session-status ${unveil.error || unveil.wrongNetwork ? "session-status--error" : ""}`}
            role={unveil.error || unveil.wrongNetwork ? "alert" : "status"}
          >
            <span>{sessionLabel}</span>
            <p>{unveil.error || globalNotice || "Switch to Sepolia to continue."}</p>
            {unveil.error && (
              <button onClick={unveil.clearError} aria-label="Dismiss error">
                ×
              </button>
            )}
          </div>
        )}
        <main className="app-content">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile application navigation">
        {NAV.map(([to, , label]) => (
          <RouteLink to={to} className={route === to ? "active" : ""} key={to}>
            <i aria-hidden="true" />
            <span>{label}</span>
          </RouteLink>
        ))}
      </nav>
    </div>
  );
}
