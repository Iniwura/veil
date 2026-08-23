import { useEffect, useMemo, useState } from "react";
import { readPublicState, type PublicState, type RoundRecord } from "./veilClient";

type EthereumReader = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  urgent?: boolean;
};

function injectedProvider() {
  return (window as Window & { ethereum?: EthereumReader }).ethereum;
}

function sameAddress(a: string | undefined, b: string | undefined) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function noticesFor(state: PublicState | undefined, account: string, now: number): Notice[] {
  if (!state) return [];
  const notices: Notice[] = [];
  const latest: RoundRecord | undefined = state.rounds[0];

  if (BigInt(now) >= state.nextDrawClosesAt) {
    notices.push({
      id: "draw-ready",
      title: "Draw ready to close",
      body: "The contract deadline has passed. Anyone can freeze the encrypted weights and advance the round.",
      href: "/app/draws",
      urgent: true,
    });
  }

  if (latest?.state === 1) {
    notices.push({
      id: `snapshot-${latest.id}`,
      title: `Round #${latest.id} snapshot sealed`,
      body: "Encrypted weights are frozen. Permissionless BlindDraw is ready.",
      href: "/app/draws",
      urgent: true,
    });
  } else if (latest?.state === 2) {
    notices.push({
      id: `proof-${latest.id}`,
      title: `Round #${latest.id} winner encrypted`,
      body: "BlindDraw finished. The Zama public-decryption proof can now finalize the winner.",
      href: "/app/draws",
      urgent: true,
    });
  } else if (latest?.state === 3) {
    const isWinner = sameAddress(account, latest.winner);

    if (isWinner && latest.delivered) {
      notices.push({
        id: `won-delivered-${latest.id}`,
        title: `You won round #${latest.id}`,
        body: "Your confidential prize has already been delivered. Unveil the amount privately in Prizes.",
        href: "/app/prizes",
        urgent: true,
      });
    } else if (isWinner) {
      notices.push({
        id: `won-${latest.id}`,
        title: `You won round #${latest.id}`,
        body: latest.funded
          ? "The encrypted prize is funded and ready for permissionless delivery."
          : "Your winner proof is final. The confidential yield bucket is still settling.",
        href: "/app/prizes",
        urgent: true,
      });
    } else if (!latest.funded) {
      notices.push({
        id: `yield-${latest.id}`,
        title: `Round #${latest.id} winner proved`,
        body: "The draw is final. Confidential realized yield is still settling into the prize bucket.",
        href: "/app/draws",
      });
    } else if (!latest.delivered) {
      notices.push({
        id: `delivery-${latest.id}`,
        title: `Round #${latest.id} prize ready`,
        body: "The prize is funded. Any keeper can deliver it directly to the fixed winner.",
        href: "/app/prizes",
      });
    }
  } else if (latest?.state === 4) {
    notices.push({
      id: `cancelled-${latest.id}`,
      title: `Round #${latest.id} cancelled by proof`,
      body: "No eligible encrypted weight was selected. Sealed yield carries forward without exposing the amount.",
      href: "/app/history",
    });
  }

  return notices;
}

export default function NotificationCenter() {
  const [state, setState] = useState<PublicState>();
  const [account, setAccount] = useState("");
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await readPublicState();
        if (!cancelled) setState(next);
      } catch {
        // The main product surface already owns RPC error messaging. Notifications fail closed.
      }
    }

    void refresh();
    const id = window.setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;

    async function readAccount() {
      try {
        const result = await provider.request({ method: "eth_accounts" });
        const accounts = Array.isArray(result) ? result.filter((value): value is string => typeof value === "string") : [];
        setAccount(accounts[0] ?? "");
      } catch {
        setAccount("");
      }
    }

    const onAccounts = (value: unknown) => {
      const accounts = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      setAccount(accounts[0] ?? "");
    };

    void readAccount();
    provider.on?.("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const notices = useMemo(() => noticesFor(state, account, now), [state, account, now]);
  const urgentCount = notices.filter((notice) => notice.urgent).length;

  function navigate(href: string) {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setOpen(false);
  }

  return (
    <div className={`notification-center ${open ? "open" : ""}`}>
      <button
        className="notification-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Protocol notifications"
      >
        <span className="notification-bell" aria-hidden="true">
          ◌
        </span>
        {notices.length > 0 && <b>{notices.length}</b>}
        {urgentCount > 0 && <i />}
      </button>

      {open && (
        <section className="notification-drawer" aria-label="UNVEIL notifications">
          <header>
            <div>
              <span>LIVE SIGNALS</span>
              <strong>Notifications</strong>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">
              ×
            </button>
          </header>

          <div className="notification-list">
            {notices.length === 0 ? (
              <div className="notification-empty">
                <i />
                <strong>Protocol caught up</strong>
                <p>No draw, proof, yield, or prize action needs attention right now.</p>
              </div>
            ) : (
              notices.map((notice) => (
                <button
                  className={`notification-item ${notice.urgent ? "urgent" : ""}`}
                  type="button"
                  key={notice.id}
                  onClick={() => navigate(notice.href)}
                >
                  <span className="notification-pulse" />
                  <span>
                    <strong>{notice.title}</strong>
                    <small>{notice.body}</small>
                  </span>
                  <b aria-hidden="true">→</b>
                </button>
              ))
            )}
          </div>

          <footer>
            <span>Derived from live Sepolia state</span>
            <span>No private amount is decrypted</span>
          </footer>
        </section>
      )}
    </div>
  );
}
