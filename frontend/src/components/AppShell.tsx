import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { DemoBadge } from "./DemoBadge";
import { RouteLink } from "./RouteLink";
import type { UnveilController } from "../hooks/useUnveil";
import type { AppRoute } from "../lib/routes";
import { walletActionLabel } from "../lib/walletPresentation";

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
  const walletLabel = walletActionLabel(unveil);
  const globalNotice = unveil.noticeScope === "global" ? unveil.notice : "";
  const globalError = unveil.errorScope === "global" ? unveil.error : "";
  const publicState = unveil.publicError
    ? unveil.publicProtocol
      ? "PUBLIC V2 STATE STALE"
      : "PUBLIC V2 STATE UNAVAILABLE"
    : unveil.publicProtocol
      ? "PUBLIC V2 STATE LIVE"
      : "PUBLIC V2 STATE LOADING";
  const sessionLabel = unveil.wrongNetwork
    ? "WRONG NETWORK"
    : unveil.walletState === "account-changed"
      ? "WALLET ACCOUNT CHANGED"
      : unveil.walletState === "reconnect-required"
        ? "RECONNECT REQUIRED"
        : globalError
          ? "ACTION NEEDS ATTENTION"
          : "WALLET SESSION";
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
                dataTour={to === "/app/save" ? "nav-save" : to === "/app/draw" ? "nav-draw" : "nav-home"}
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
            <DemoBadge compact />
            <button className="help-button" onClick={onReplayGuide}>
              HELP
            </button>
          </div>
          <button
            className="wallet-button"
            onClick={walletAction}
            disabled={Boolean(unveil.busy)}
            data-tour="wallet"
            data-cursor="enter"
          >
            {walletLabel}
          </button>
        </header>
        {(globalError || unveil.wrongNetwork || globalNotice) && (
          <div
            className={`session-status ${globalError || unveil.wrongNetwork ? "session-status--error" : ""}`}
            role={globalError || unveil.wrongNetwork ? "alert" : "status"}
          >
            <span>{sessionLabel}</span>
            <p>{globalError || globalNotice || "Switch to Sepolia to continue."}</p>
            {globalError && (
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
          <RouteLink
            to={to}
            className={route === to ? "active" : ""}
            dataCursor="enter"
            dataTour={to === "/app/save" ? "nav-save" : to === "/app/draw" ? "nav-draw" : "nav-home"}
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
