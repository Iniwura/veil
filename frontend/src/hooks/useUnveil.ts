import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { UNVEIL_NETWORK } from "../contracts";
import {
  connectWallet,
  deliveredPrizeForRound,
  deliveredPrizesForAddress,
  ensureSepolia,
  fundDemoWallet,
  isConnectedWinner,
  parseWalletChainId,
  readDashboard,
  readInjectedWalletState,
  readPublicProtocol,
  renewDrawSeat,
  resetWalletRelayer,
  revealMyRoundWeight,
  revealMyVault,
  revealPrize,
  sealDeposit,
  subscribeWalletLifecycle,
  withdrawPrivate,
  type MyVault,
} from "../veilClient";
import { productError } from "../lib/errors";

type Dashboard = Awaited<ReturnType<typeof readDashboard>>;
type PublicProtocol = Awaited<ReturnType<typeof readPublicProtocol>>;
type WalletState = "disconnected" | "connected" | "account-changed" | "wrong-network" | "reconnect-required";
type NoticeScope = "global" | "save" | "draw";

export function useUnveil() {
  const walletEpoch = useRef(0);
  const connectAttempt = useRef(0);
  const signerRef = useRef<JsonRpcSigner | undefined>(undefined);
  const addressRef = useRef("");
  const walletStateRef = useRef<WalletState>("disconnected");
  const [signer, setSigner] = useState<JsonRpcSigner>();
  const [address, setAddress] = useState("");
  const [walletState, setWalletState] = useState<WalletState>("disconnected");
  const [walletChainId, setWalletChainId] = useState<number>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [publicProtocol, setPublicProtocol] = useState<PublicProtocol>();
  const [publicError, setPublicError] = useState("");
  const [vault, setVault] = useState<MyVault>();
  const [roundWeight, setRoundWeight] = useState<{ roundId: bigint; value: bigint }>();
  const [prize, setPrize] = useState<{ roundId: bigint; value: bigint }>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeScope, setNoticeScope] = useState<NoticeScope>("global");
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState<NoticeScope>("global");

  const setScopedNotice = useCallback((scope: NoticeScope, message: string) => {
    setNoticeScope(scope);
    setNotice(message);
  }, []);

  const setScopedError = useCallback((scope: NoticeScope, message: string) => {
    setErrorScope(scope);
    setError(message);
  }, []);

  const updateWalletState = useCallback((next: WalletState) => {
    walletStateRef.current = next;
    setWalletState(next);
  }, []);

  const clearAccountState = useCallback(() => {
    walletEpoch.current += 1;
    resetWalletRelayer();
    signerRef.current = undefined;
    addressRef.current = "";
    setSigner(undefined);
    setAddress("");
    setDashboard(undefined);
    setVault(undefined);
    setRoundWeight(undefined);
    setPrize(undefined);
    setBusy("");
    setErrorScope("global");
    setError("");
  }, []);

  const refreshPublic = useCallback(async () => {
    try {
      setPublicProtocol(await readPublicProtocol());
      setPublicError("");
    } catch (cause) {
      console.error("[UNVEIL] public protocol read", cause);
      setPublicError("Public Sepolia V2 state is temporarily unavailable.");
    }
  }, []);

  const refresh = useCallback(
    async (active = signerRef.current, scope: NoticeScope = "global") => {
      const epoch = walletEpoch.current;
      await refreshPublic();
      if (!active) return;
      try {
        const next = await readDashboard(active);
        if (walletEpoch.current === epoch) setDashboard(next);
      } catch (cause) {
        if (walletEpoch.current === epoch) setScopedError(scope, productError(cause));
      }
    },
    [refreshPublic, setScopedError],
  );

  useEffect(() => {
    void refreshPublic();
    const timer = window.setInterval(() => void refreshPublic(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshPublic]);

  useEffect(() => {
    let active = true;
    const initialEpoch = walletEpoch.current;
    void readInjectedWalletState().then((wallet) => {
      if (!active || walletEpoch.current !== initialEpoch || !wallet?.accounts.length) return;
      clearAccountState();
      setWalletChainId(wallet.chainId);
      if (wallet.chainId === UNVEIL_NETWORK.chainId) {
        updateWalletState("reconnect-required");
        setScopedNotice("global", "A Sepolia wallet is available. Reconnect to load its private account state.");
      } else {
        updateWalletState("wrong-network");
        setScopedNotice(
          "global",
          "Connected wallet is on the wrong network. Public Sepolia V2 state remains available.",
        );
      }
    });
    const unsubscribe = subscribeWalletLifecycle({
      accountsChanged(accounts) {
        clearAccountState();
        updateWalletState(accounts.length === 0 ? "disconnected" : "account-changed");
        setScopedNotice(
          "global",
          accounts.length === 0 ? "" : "Wallet account changed. Reconnect to load this account.",
        );
      },
      chainChanged(chainId) {
        clearAccountState();
        const nextChainId = parseWalletChainId(chainId);
        setWalletChainId(nextChainId);
        if (nextChainId === UNVEIL_NETWORK.chainId) {
          updateWalletState("reconnect-required");
          setScopedNotice("global", "Wallet returned to Sepolia. Reconnect before using private account actions.");
        } else {
          updateWalletState("wrong-network");
          setScopedNotice(
            "global",
            "Connected wallet is on the wrong network. Public Sepolia V2 state remains available.",
          );
        }
      },
      disconnect() {
        clearAccountState();
        setWalletChainId(undefined);
        updateWalletState("disconnected");
        setScopedNotice("global", "");
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clearAccountState, setScopedNotice, updateWalletState]);

  async function connect() {
    const attempt = ++connectAttempt.current;
    clearAccountState();
    updateWalletState("reconnect-required");
    setBusy("connect");
    setScopedNotice("global", "");
    try {
      const wallet = await connectWallet();
      if (connectAttempt.current !== attempt) return;
      clearAccountState();
      const connectedEpoch = walletEpoch.current;
      signerRef.current = wallet.signer;
      addressRef.current = wallet.address;
      setSigner(wallet.signer);
      setAddress(wallet.address);
      setWalletChainId(UNVEIL_NETWORK.chainId);
      updateWalletState("connected");
      setBusy("connect");
      const next = await readDashboard(wallet.signer);
      if (connectAttempt.current !== attempt || walletEpoch.current !== connectedEpoch) return;
      setDashboard(next);
      setScopedNotice("global", "");
    } catch (cause) {
      if (connectAttempt.current !== attempt) return;
      const wallet = await readInjectedWalletState();
      if (connectAttempt.current !== attempt) return;
      clearAccountState();
      setWalletChainId(wallet?.chainId);
      if (wallet?.accounts.length && wallet.chainId !== UNVEIL_NETWORK.chainId) {
        updateWalletState("wrong-network");
        setScopedNotice(
          "global",
          "Connected wallet is on the wrong network. Public Sepolia V2 state remains available.",
        );
      } else if (wallet?.accounts.length) {
        updateWalletState("reconnect-required");
        setScopedNotice("global", "Reconnect to load the current Sepolia account.");
      } else {
        updateWalletState("disconnected");
      }
      setScopedError("global", productError(cause));
    } finally {
      if (connectAttempt.current === attempt) setBusy("");
    }
  }

  async function switchToSepolia() {
    clearAccountState();
    updateWalletState("reconnect-required");
    setBusy("switch-network");
    setScopedNotice("global", "");
    const epoch = walletEpoch.current;
    try {
      await ensureSepolia();
      if (walletEpoch.current !== epoch) return;
      setWalletChainId(UNVEIL_NETWORK.chainId);
      setScopedNotice("global", "");
    } catch (cause) {
      if (walletEpoch.current !== epoch) return;
      updateWalletState("wrong-network");
      setScopedError("global", productError(cause));
    } finally {
      if (walletEpoch.current === epoch) setBusy("");
    }
  }

  function privateWallet() {
    const currentWalletState = walletStateRef.current;
    const currentSigner = signerRef.current;
    if (currentWalletState === "wrong-network") {
      setScopedError("global", "WRONG NETWORK. Switch the connected wallet to Sepolia before using private actions.");
      return undefined;
    }
    if (!currentSigner || currentWalletState !== "connected") {
      void connect();
      return undefined;
    }
    return { signer: currentSigner, address: addressRef.current, epoch: walletEpoch.current };
  }

  async function fundTestToken() {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setBusy("fund");
      setScopedNotice("save", "Checking confidential TEST principal before minting or wrapping…");
      const result = await fundDemoWallet(wallet.signer, 100n);
      if (walletEpoch.current !== wallet.epoch) return;
      setScopedNotice(
        "save",
        result.alreadyFunded
          ? "This wallet already has enough wrapped TEST principal."
          : `${result.wrapped} TEST units wrapped into confidential principal.`,
      );
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function deposit(amount: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setBusy("deposit");
      await sealDeposit(wallet.signer, amount, (nextNotice) => {
        if (walletEpoch.current === wallet.epoch) setScopedNotice("save", nextNotice);
      });
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(undefined);
      await refresh(wallet.signer, "save");
      if (walletEpoch.current === wallet.epoch) {
        setScopedNotice(
          "save",
          "Encrypted deposit confirmed. Your position is eligible according to the live seat state.",
        );
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function withdraw(amount: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setBusy("withdraw");
      setScopedNotice("save", "Encrypting your withdrawal request for the V2 pool…");
      const result = await withdrawPrivate(wallet.signer, amount);
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(undefined);
      await refresh(wallet.signer, "save");
      if (walletEpoch.current === wallet.epoch) {
        setScopedNotice("save", `Withdrawal request #${result.requestId} recorded · ${result.request.status}.`);
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function revealVaultStats() {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setVault(undefined);
      setBusy("reveal-vault");
      setScopedNotice("save", "Awaiting your wallet signature for private decryption…");
      const nextVault = await revealMyVault(wallet.signer);
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(nextVault);
      setScopedNotice("save", "Private values are unveiled locally for this browser session only.");
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function revealRound(roundId: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setRoundWeight(undefined);
      setBusy("reveal-weight");
      setScopedNotice("save", `Awaiting signature to unveil your Round ${roundId} weight…`);
      const value = await revealMyRoundWeight(wallet.signer, roundId);
      if (walletEpoch.current !== wallet.epoch) return;
      setRoundWeight({ roundId, value });
      setScopedNotice("save", `Your Round ${roundId} weight is displayed locally. Exact odds remain unavailable.`);
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  const schedule = dashboard?.schedule ?? publicProtocol?.schedule;
  const history = dashboard?.history ?? publicProtocol?.history ?? [];
  const latestFinalized = dashboard?.latestFinalized ?? publicProtocol?.latestFinalized;
  const latestResult = history[0];
  const connectedWinner = useMemo(
    () => Boolean(address && latestFinalized && isConnectedWinner(address, latestFinalized)),
    [address, latestFinalized],
  );
  const myDeliveredPrizes = useMemo(() => deliveredPrizesForAddress(history, address), [address, history]);

  async function revealPrizeForRound(roundId: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    const eligibleRound = deliveredPrizeForRound(history, wallet.address, roundId);
    if (!eligibleRound) {
      setScopedError("draw", "This round is not a processed finalized prize won by the connected wallet.");
      return;
    }
    try {
      setScopedError("draw", "");
      setPrize(undefined);
      setBusy(`reveal-prize-${roundId}`);
      setScopedNotice("draw", `Awaiting the winner wallet signature for Round ${roundId} prize decryption…`);
      const value = await revealPrize(wallet.signer, roundId);
      if (walletEpoch.current !== wallet.epoch) return;
      setPrize({ roundId, value });
      setScopedNotice("draw", `Round ${roundId} TEST strategy shares are unveiled locally for this wallet.`);
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("draw", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function renewSeat() {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("draw", "");
      setBusy("renew-seat");
      setScopedNotice("draw", "Waiting for wallet confirmation to renew the draw seat…");
      await renewDrawSeat(wallet.signer);
      if (walletEpoch.current !== wallet.epoch) return;
      await refresh(wallet.signer, "draw");
      if (walletEpoch.current === wallet.epoch) {
        setScopedNotice("draw", "Draw seat renewed without exposing or changing private principal.");
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("draw", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  return {
    signer,
    address,
    connected: Boolean(address) && walletState === "connected",
    walletState,
    walletChainId,
    wrongNetwork: walletState === "wrong-network",
    dashboard,
    publicProtocol,
    publicError,
    schedule,
    history,
    latestResult,
    latestFinalized,
    connectedWinner,
    myDeliveredPrizes,
    vault,
    roundWeight,
    prize,
    busy,
    notice,
    noticeScope,
    error,
    errorScope,
    connect,
    switchToSepolia,
    fundTestToken,
    deposit,
    withdraw,
    revealVaultStats,
    revealRound,
    revealPrizeForRound,
    renewSeat,
    hideVault: () => setVault(undefined),
    hideRoundWeight: () => setRoundWeight(undefined),
    hidePrize: () => setPrize(undefined),
    clearError: () => setError(""),
    refresh,
  };
}

export type UnveilController = ReturnType<typeof useUnveil>;
