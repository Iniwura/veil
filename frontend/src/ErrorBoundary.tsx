import { Component, type ErrorInfo, type ReactNode } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean; detail: string }
> {
  state = { crashed: false, detail: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      crashed: true,
      detail: error instanceof Error ? error.message : "Unexpected interface error",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[UNVEIL] frontend boundary", error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;

    return (
      <main className="fatal-screen">
        <div className="fatal-grid" aria-hidden="true" />
        <div className="fatal-mark" aria-hidden="true">
          <i />
          <b />
        </div>
        <span className="fatal-kicker">INTERFACE RECOVERY</span>
        <h1>
          YOUR FUNDS DID NOT CRASH.
          <em>THE PAGE DID.</em>
        </h1>
        <p>
          UNVEIL is non-custodial. This screen only means the browser interface hit an unexpected state. Reload the
          app to reconnect to the contracts and your wallet.
        </p>
        <div className="fatal-actions">
          <button onClick={() => window.location.reload()}>RELOAD UNVEIL ↗</button>
          <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer">
            OPEN SEPOLIA EXPLORER →
          </a>
        </div>
        <details>
          <summary>Technical detail</summary>
          <code>{this.state.detail}</code>
        </details>
      </main>
    );
  }
}
