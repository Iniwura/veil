import { useCallback, useEffect, useMemo, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import {
  connectWallet,
  fundDemoWallet,
  isConnectedWinner,
  readDashboard,
  readPublicProtocol,
  renewDrawSeat,
  revealMyRoundWeight,
  revealMyVault,
  revealPrize,
  sealDeposit,
  withdrawPrivate,
  type MyVault,
} from "../veilClient";
import { productError } from "../lib/errors";

type Dashboard = Awaited<ReturnType<typeof readDashboard>>;
type PublicProtocol = Awaited<ReturnType<typeof readPublicProtocol>>;

export function useUnveil() {
  const [signer, setSigner] = useState<JsonRpcSigner>();
  const [address, setAddress] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [publicProtocol, setPublicProtocol] = useState<PublicProtocol>();
  const [vault, setVault] = useState<MyVault>();
  const [roundWeight, setRoundWeight] = useState<{ roundId: bigint; value: bigint }>();
  const [prize, setPrize] = useState<{ roundId: bigint; value: bigint }>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Connect a Sepolia wallet to access private account actions.");
  const [error, setError] = useState("");

  const refreshPublic = useCallback(async () => {
    try {
      setPublicProtocol(await readPublicProtocol());
    } catch (cause) {
      console.error("[UNVEIL] public protocol read", cause);
      setError("Live Sepolia state is temporarily unavailable. Public contract links remain accessible.");
    }
  }, []);

  const refresh = useCallback(
    async (active = signer) => {
      await refreshPublic();
      if (active) setDashboard(await readDashboard(active));
    },
    [refreshPublic, signer],
  );

  useEffect(() => {
    void refreshPublic();
    const timer = window.setInterval(() => void refreshPublic(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshPublic]);

  async function connect() {
    try {
      setError("");
      setBusy("connect");
      setNotice("Waiting for wallet connection and Sepolia network confirmation…");
      const wallet = await connectWallet();
      setSigner(wallet.signer);
      setAddress(wallet.address);
      const next = await readDashboard(wallet.signer);
      setDashboard(next);
      setNotice(
        next.joined
          ? "Your V2 position is connected and remains sealed."
          : "Wallet connected. Save TEST principal to enter the pool.",
      );
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function fundTestToken() {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("fund");
      setNotice("Checking confidential TEST principal before minting or wrapping…");
      const result = await fundDemoWallet(signer, 100n);
      setNotice(
        result.alreadyFunded
          ? "This wallet already has enough wrapped TEST principal."
          : `${result.wrapped} TEST units wrapped into confidential principal.`,
      );
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function deposit(amount: bigint) {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("deposit");
      await sealDeposit(signer, amount, setNotice);
      setVault(undefined);
      await refresh(signer);
      setNotice("Encrypted deposit confirmed. Your position is eligible according to the live seat state.");
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function withdraw(amount: bigint) {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("withdraw");
      setNotice("Encrypting your withdrawal request for the V2 pool…");
      const result = await withdrawPrivate(signer, amount);
      setVault(undefined);
      await refresh(signer);
      setNotice(`Withdrawal request #${result.requestId} recorded · ${result.request.status}.`);
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function revealVaultStats() {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("reveal-vault");
      setNotice("Awaiting your wallet signature for private decryption…");
      setVault(await revealMyVault(signer));
      setNotice("Private values are unveiled locally for this browser session only.");
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function revealRound(roundId: bigint) {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("reveal-weight");
      setNotice(`Awaiting signature to unveil your Round ${roundId} weight…`);
      setRoundWeight({ roundId, value: await revealMyRoundWeight(signer, roundId) });
      setNotice(`Your Round ${roundId} weight is displayed locally. Exact odds remain unavailable.`);
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function revealLatestPrize() {
    const round = dashboard?.latestFinalized ?? publicProtocol?.latestFinalized;
    if (!signer || !round) return connect();
    try {
      setError("");
      setBusy("reveal-prize");
      setNotice("Awaiting the winner wallet signature for private prize decryption…");
      setPrize({ roundId: round.id, value: await revealPrize(signer, round.id) });
      setNotice("Delivered TEST strategy shares are unveiled locally for this wallet.");
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  async function renewSeat() {
    if (!signer) return connect();
    try {
      setError("");
      setBusy("renew-seat");
      setNotice("Waiting for wallet confirmation to renew the draw seat…");
      await renewDrawSeat(signer);
      await refresh(signer);
      setNotice("Draw seat renewed without exposing or changing private principal.");
    } catch (cause) {
      setError(productError(cause));
    } finally {
      setBusy("");
    }
  }

  const schedule = dashboard?.schedule ?? publicProtocol?.schedule;
  const history = dashboard?.history ?? publicProtocol?.history ?? [];
  const latestFinalized = dashboard?.latestFinalized ?? publicProtocol?.latestFinalized;
  const connectedWinner = useMemo(
    () => Boolean(address && latestFinalized && isConnectedWinner(address, latestFinalized)),
    [address, latestFinalized],
  );

  return {
    signer,
    address,
    connected: Boolean(address),
    dashboard,
    publicProtocol,
    schedule,
    history,
    latestFinalized,
    connectedWinner,
    vault,
    roundWeight,
    prize,
    busy,
    notice,
    error,
    connect,
    fundTestToken,
    deposit,
    withdraw,
    revealVaultStats,
    revealRound,
    revealLatestPrize,
    renewSeat,
    hideVault: () => setVault(undefined),
    hideRoundWeight: () => setRoundWeight(undefined),
    hidePrize: () => setPrize(undefined),
    clearError: () => setError(""),
    refresh,
  };
}

export type UnveilController = ReturnType<typeof useUnveil>;
