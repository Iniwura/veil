import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { DemoBadge } from "./DemoBadge";
import { RouteLink } from "./RouteLink";
import type { UnveilController } from "../hooks/useUnveil";
import type { AppRoute } from "../lib/routes";
import { shortAddress } from "../lib/format";

const DESKTOP_NAV: Array<[AppRoute, string, string]> = [
  ["/app", "01", "Overview"],
  ["/app/save", "02", "Save"],
  ["/app/draws", "03", "Draws"],
  ["/app/vault", "04", "My Vault"],
  ["/app/prizes", "05", "Prizes"],
  ["/app/history", "06", "History"],
  ["/app/more", "07", "More"],
];

const MOBILE_NAV: Array<[AppRoute, string]> = [
  ["/app", "Home"],
  ["/app/save", "Save"],
  ["/app/draws", "Draws"],
  ["/app/prizes", "Prizes"],
  ["/app/vault", "Me"],
];

export function AppShell({
  route,
  unveil,
  children,
}: {
  route: AppRoute;
  unveil: UnveilController;
  children: ReactNode;
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
  const sessionLabel = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : unveil.walletState === "account-changed"
      ? "WALLET ACCOUNT CHANGED"
      : unveil.walletState === "reconnect-required"
        ? "RECONNECT REQUIRED"
        : unveil.error
          ? "ACTION NEEDS ATTENTION"
          : unveil.busy
            ? "ACTION IN PROGRESS"
            : "SESSION";
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <RouteLink to="/" className="wordmark">
          <BrandMark compact />
          <strong>UNVEIL</strong>
        </RouteLink>
        <nav aria-label="Application navigation">
          {DESKTOP_NAV.map(([to, index, label]) => (
            <RouteLink to={to} className={route === to ? "active" : ""} key={to}>
              <span>{index}</span>
              <strong>{label}</strong>
            </RouteLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <DemoBadge compact />
          <p>
            Encrypted to everyone.
            <br />
            Unveiled only to you.
          </p>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="app-topbar">
          <RouteLink to="/" className="wordmark mobile-brand">
            <BrandMark compact />
            <strong>UNVEIL</strong>
          </RouteLink>
          <div>
            <span className={`live-dot ${unveil.publicError ? "unavailable" : ""}`} />
            {unveil.publicError ? "PUBLIC V2 STATE UNAVAILABLE" : "PUBLIC V2 STATE LIVE"}
          </div>
          <DemoBadge compact />
          <button className="wallet-button" onClick={walletAction} disabled={Boolean(unveil.busy)}>
            {walletLabel}
          </button>
        </header>
        {(unveil.error || unveil.notice) && (
          <div
            className={`session-status ${unveil.error || unveil.wrongNetwork ? "session-status--error" : ""}`}
            role={unveil.error || unveil.wrongNetwork ? "alert" : "status"}
          >
            <span>{sessionLabel}</span>
            <p>{unveil.error || unveil.notice}</p>
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
        {MOBILE_NAV.map(([to, label]) => (
          <RouteLink to={to} className={route === to ? "active" : ""} key={to}>
            <i aria-hidden="true" />
            <span>{label}</span>
          </RouteLink>
        ))}
      </nav>
    </div>
  );
}
