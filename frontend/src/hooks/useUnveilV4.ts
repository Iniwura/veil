import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import { UNVEIL_NETWORK } from "../contracts";
import {
  connectWallet,
  advanceWithdrawal as advanceWithdrawalTransaction,
  cancelWithdrawal as cancelWithdrawalTransaction,
  ensureSepolia,
  fundDemoWallet,
  parseWalletChainId,
  readInjectedWalletState,
  readWithdrawalRequest,
  renewDrawSeat,
  resetWalletRelayer,
  revealMyRoundWeight,
  revealMyVault,
  sealDeposit,
  subscribeWalletLifecycle,
  withdrawPrivate,
  type MyVault,
} from "../veilClient";
import {
  advanceDrawV4,
  deliveredPrizeSlotForRoundV4,
  deliveredPrizesForAddressV4,
  isConnectedWinnerV4,
  readDashboardV4,
  readPublicProtocolV4,
  resetV4Relayer,
  revealPrizeV4,
} from "../v4DrawClient";
import type { DrawAction } from "../lib/drawAdvance";
import type { WithdrawalLifecycleAction } from "../../../shared/withdrawalLifecycle";
import { productError } from "../lib/errors";
import { advanceWalletSessionEpoch } from "../lib/walletSession";

type Dashboard = Awaited<ReturnType<typeof readDashboardV4>>;
type PublicProtocol = Awaited<ReturnType<typeof readPublicProtocolV4>>;
type WalletState = "disconnected" | "connected" | "account-changed" | "wrong-network" | "reconnect-required";
type NoticeScope = "global" | "save" | "draw";

export function useUnveilV4() {
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
  const [prize, setPrize] = useState<{ roundId: bigint; prizeIndex: number; value: bigint }>();
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

  const clearAccountState = useCallback((invalidateConnectAttempt = true) => {
    const nextEpoch = advanceWalletSessionEpoch(
      { walletEpoch: walletEpoch.current, connectAttempt: connectAttempt.current },
      invalidateConnectAttempt,
    );
    walletEpoch.current = nextEpoch.walletEpoch;
    connectAttempt.current = nextEpoch.connectAttempt;
    resetWalletRelayer();
    resetV4Relayer();
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
      setPublicProtocol(await readPublicProtocolV4());
      setPublicError("");
    } catch (cause) {
      console.error("[UNVEIL] public V4 protocol read", cause);
      setPublicError("Public Sepolia V4 state is temporarily unavailable.");
    }
  }, []);

  const refresh = useCallback(
    async (active = signerRef.current, scope: NoticeScope = "global") => {
      const epoch = walletEpoch.current;
      await refreshPublic();
      if (!active) return;
      try {
        const next = await readDashboardV4(active);
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
          "Connected wallet is on the wrong network. Public Sepolia V4 state remains available.",
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
            "Connected wallet is on the wrong network. Public Sepolia V4 state remains available.",
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
    clearAccountState();
    const attempt = ++connectAttempt.current;
    updateWalletState("reconnect-required");
    setBusy("connect");
    setScopedNotice("global", "");
    try {
      const wallet = await connectWallet();
      if (connectAttempt.current !== attempt) return;
      clearAccountState(false);
      const connectedEpoch = walletEpoch.current;
      signerRef.current = wallet.signer;
      addressRef.current = wallet.address;
      setSigner(wallet.signer);
      setAddress(wallet.address);
      setWalletChainId(UNVEIL_NETWORK.chainId);
      updateWalletState("connected");
      const next = await readDashboardV4(wallet.signer);
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
          "Connected wallet is on the wrong network. Public Sepolia V4 state remains available.",
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

  function disconnectSession() {
    clearAccountState();
    setWalletChainId(undefined);
    updateWalletState("disconnected");
    setScopedNotice("global", "");
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
          "Encrypted V4 deposit confirmed. New savings become prize-eligible after one complete draw period.",
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
      setScopedNotice("save", "Encrypting your withdrawal request for the V4 pool…");
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

  async function advanceWithdrawal(expectedAction: WithdrawalLifecycleAction) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setBusy("withdrawal-lifecycle");
      setScopedNotice("save", expectedAction.description);
      await advanceWithdrawalTransaction(
        wallet.signer,
        expectedAction,
        (nextNotice) => {
          if (walletEpoch.current === wallet.epoch) setScopedNotice("save", nextNotice);
        },
        () => walletEpoch.current === wallet.epoch,
      );
      if (walletEpoch.current !== wallet.epoch) return;
      await refresh(wallet.signer, "save");
      if (walletEpoch.current === wallet.epoch) {
        setScopedNotice("save", "Withdrawal lifecycle advanced. The latest V4 state is now loaded.");
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setScopedError("save", productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function cancelWithdrawal(requestId: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("save", "");
      setBusy("withdrawal-cancel");
      const live = await readWithdrawalRequest(requestId);
      if (walletEpoch.current !== wallet.epoch) return;
      if (live.account.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error("UNVEIL_WITHDRAWAL_NOT_ACTIONABLE: Only the request owner can cancel this withdrawal.");
      }
      if (live.settled || live.canceled || live.committed) {
        throw new Error("UNVEIL_WITHDRAWAL_NOT_ACTIONABLE: This withdrawal can no longer be canceled.");
      }
      setScopedNotice("save", "Waiting for wallet confirmation to cancel the encrypted request…");
      await cancelWithdrawalTransaction(wallet.signer, requestId, () => walletEpoch.current === wallet.epoch);
      if (walletEpoch.current !== wallet.epoch) return;
      await refresh(wallet.signer, "save");
      if (walletEpoch.current === wallet.epoch) setScopedNotice("save", "Withdrawal request canceled.");
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
    () => Boolean(address && latestFinalized && isConnectedWinnerV4(address, latestFinalized)),
    [address, latestFinalized],
  );
  const myDeliveredPrizes = useMemo(() => deliveredPrizesForAddressV4(history, address), [address, history]);

  async function revealPrizeForRound(roundId: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    const eligible = deliveredPrizeSlotForRoundV4(history, wallet.address, roundId);
    if (!eligible) {
      setScopedError("draw", "This round has no delivered V4 prize slot owned by the connected wallet.");
      return;
    }
    try {
      setScopedError("draw", "");
      setPrize(undefined);
      setBusy(`reveal-prize-${roundId}`);
      setScopedNotice(
        "draw",
        `Awaiting the winner wallet signature for Round ${roundId} prize ${eligible.prize.index + 1} decryption…`,
      );
      const value = await revealPrizeV4(wallet.signer, roundId, eligible.prize.index);
      if (walletEpoch.current !== wallet.epoch) return;
      setPrize({ roundId, prizeIndex: eligible.prize.index, value });
      setScopedNotice(
        "draw",
        `Round ${roundId} prize ${eligible.prize.index + 1} TEST strategy shares are unveiled locally for this wallet.`,
      );
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
      setScopedNotice("draw", "Waiting for wallet confirmation to renew the V4 draw seat…");
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

  async function advanceDraw(expectedAction: DrawAction) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setScopedError("draw", "");
      setBusy("advance-draw");
      const kmsStep = expectedAction.kind === "FINALIZE_SHARD" || expectedAction.kind === "FINALIZE_MEMBER";
      setScopedNotice("draw", kmsStep ? "REQUESTING ZAMA KMS PROOF…" : expectedAction.description);
      await advanceDrawV4(
        wallet.signer,
        expectedAction,
        (nextNotice) => {
          if (walletEpoch.current === wallet.epoch) setScopedNotice("draw", nextNotice);
        },
        () => walletEpoch.current === wallet.epoch,
      );
      if (walletEpoch.current !== wallet.epoch) return;
      await refresh(wallet.signer, "draw");
      if (walletEpoch.current === wallet.epoch) {
        setScopedNotice(
          "draw",
          `Round ${expectedAction.roundId} advanced. The next V4 permissionless step is now loaded.`,
        );
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
    drawAction: dashboard?.drawAction ?? publicProtocol?.drawAction,
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
    disconnectSession,
    switchToSepolia,
    fundTestToken,
    deposit,
    withdraw,
    advanceWithdrawal,
    cancelWithdrawal,
    revealVaultStats,
    revealRound,
    revealPrizeForRound,
    renewSeat,
    advanceDraw,
    hideVault: () => setVault(undefined),
    hideRoundWeight: () => setRoundWeight(undefined),
    hidePrize: () => setPrize(undefined),
    clearError: () => setError(""),
    refresh,
  };
}

export type UnveilV4Controller = ReturnType<typeof useUnveilV4>;
