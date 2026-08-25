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
  const [notice, setNotice] = useState("Connect a Sepolia wallet to access private account actions.");
  const [error, setError] = useState("");

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
    async (active = signerRef.current) => {
      const epoch = walletEpoch.current;
      await refreshPublic();
      if (!active) return;
      try {
        const next = await readDashboard(active);
        if (walletEpoch.current === epoch) setDashboard(next);
      } catch (cause) {
        if (walletEpoch.current === epoch) setError(productError(cause));
      }
    },
    [refreshPublic],
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
        setNotice("A Sepolia wallet is available. Reconnect to load its private account state.");
      } else {
        updateWalletState("wrong-network");
        setNotice("Connected wallet is on the wrong network. Public Sepolia V2 state remains available.");
      }
    });
    const unsubscribe = subscribeWalletLifecycle({
      accountsChanged(accounts) {
        clearAccountState();
        updateWalletState(accounts.length === 0 ? "disconnected" : "account-changed");
        setNotice(
          accounts.length === 0
            ? "Wallet disconnected. Private values were cleared."
            : "Wallet account changed. Reconnect to load this account.",
        );
      },
      chainChanged(chainId) {
        clearAccountState();
        const nextChainId = parseWalletChainId(chainId);
        setWalletChainId(nextChainId);
        if (nextChainId === UNVEIL_NETWORK.chainId) {
          updateWalletState("reconnect-required");
          setNotice("Wallet returned to Sepolia. Reconnect before using private account actions.");
        } else {
          updateWalletState("wrong-network");
          setNotice("Connected wallet is on the wrong network. Public Sepolia V2 state remains available.");
        }
      },
      disconnect() {
        clearAccountState();
        setWalletChainId(undefined);
        updateWalletState("disconnected");
        setNotice("Wallet disconnected. Private values were cleared.");
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clearAccountState, updateWalletState]);

  async function connect() {
    const attempt = ++connectAttempt.current;
    clearAccountState();
    updateWalletState("reconnect-required");
    setBusy("connect");
    setNotice("Waiting for wallet connection and Sepolia network confirmation…");
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
      setNotice(
        next.joined
          ? "Your V2 position is connected and remains sealed."
          : "Wallet connected. Save TEST principal to enter the pool.",
      );
    } catch (cause) {
      if (connectAttempt.current !== attempt) return;
      const wallet = await readInjectedWalletState();
      if (connectAttempt.current !== attempt) return;
      clearAccountState();
      setWalletChainId(wallet?.chainId);
      if (wallet?.accounts.length && wallet.chainId !== UNVEIL_NETWORK.chainId) {
        updateWalletState("wrong-network");
        setNotice("Connected wallet is on the wrong network. Public Sepolia V2 state remains available.");
      } else if (wallet?.accounts.length) {
        updateWalletState("reconnect-required");
        setNotice("Reconnect to load the current Sepolia account.");
      } else {
        updateWalletState("disconnected");
      }
      setError(productError(cause));
    } finally {
      if (connectAttempt.current === attempt) setBusy("");
    }
  }

  async function switchToSepolia() {
    clearAccountState();
    updateWalletState("reconnect-required");
    setBusy("switch-network");
    setNotice("Requesting a wallet switch to Sepolia…");
    const epoch = walletEpoch.current;
    try {
      await ensureSepolia();
      if (walletEpoch.current !== epoch) return;
      setWalletChainId(UNVEIL_NETWORK.chainId);
      setNotice("Wallet is on Sepolia. Reconnect before using private account actions.");
    } catch (cause) {
      if (walletEpoch.current !== epoch) return;
      updateWalletState("wrong-network");
      setError(productError(cause));
    } finally {
      if (walletEpoch.current === epoch) setBusy("");
    }
  }

  function privateWallet() {
    const currentWalletState = walletStateRef.current;
    const currentSigner = signerRef.current;
    if (currentWalletState === "wrong-network") {
      setError("WRONG NETWORK. Switch the connected wallet to Sepolia before using private actions.");
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
      setError("");
      setBusy("fund");
      setNotice("Checking confidential TEST principal before minting or wrapping…");
      const result = await fundDemoWallet(wallet.signer, 100n);
      if (walletEpoch.current !== wallet.epoch) return;
      setNotice(
        result.alreadyFunded
          ? "This wallet already has enough wrapped TEST principal."
          : `${result.wrapped} TEST units wrapped into confidential principal.`,
      );
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function deposit(amount: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setError("");
      setBusy("deposit");
      await sealDeposit(wallet.signer, amount, (nextNotice) => {
        if (walletEpoch.current === wallet.epoch) setNotice(nextNotice);
      });
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(undefined);
      await refresh(wallet.signer);
      if (walletEpoch.current === wallet.epoch) {
        setNotice("Encrypted deposit confirmed. Your position is eligible according to the live seat state.");
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function withdraw(amount: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setError("");
      setBusy("withdraw");
      setNotice("Encrypting your withdrawal request for the V2 pool…");
      const result = await withdrawPrivate(wallet.signer, amount);
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(undefined);
      await refresh(wallet.signer);
      if (walletEpoch.current === wallet.epoch) {
        setNotice(`Withdrawal request #${result.requestId} recorded · ${result.request.status}.`);
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function revealVaultStats() {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setError("");
      setVault(undefined);
      setBusy("reveal-vault");
      setNotice("Awaiting your wallet signature for private decryption…");
      const nextVault = await revealMyVault(wallet.signer);
      if (walletEpoch.current !== wallet.epoch) return;
      setVault(nextVault);
      setNotice("Private values are unveiled locally for this browser session only.");
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function revealRound(roundId: bigint) {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setError("");
      setRoundWeight(undefined);
      setBusy("reveal-weight");
      setNotice(`Awaiting signature to unveil your Round ${roundId} weight…`);
      const value = await revealMyRoundWeight(wallet.signer, roundId);
      if (walletEpoch.current !== wallet.epoch) return;
      setRoundWeight({ roundId, value });
      setNotice(`Your Round ${roundId} weight is displayed locally. Exact odds remain unavailable.`);
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  const schedule = dashboard?.schedule ?? publicProtocol?.schedule;
  const history = dashboard?.history ?? publicProtocol?.history ?? [];
  const latestFinalized = dashboard?.latestFinalized ?? publicProtocol?.latestFinalized;
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
      setError("This round is not a processed finalized prize won by the connected wallet.");
      return;
    }
    try {
      setError("");
      setPrize(undefined);
      setBusy(`reveal-prize-${roundId}`);
      setNotice(`Awaiting the winner wallet signature for Round ${roundId} prize decryption…`);
      const value = await revealPrize(wallet.signer, roundId);
      if (walletEpoch.current !== wallet.epoch) return;
      setPrize({ roundId, value });
      setNotice(`Round ${roundId} TEST strategy shares are unveiled locally for this wallet.`);
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
    } finally {
      if (walletEpoch.current === wallet.epoch) setBusy("");
    }
  }

  async function renewSeat() {
    const wallet = privateWallet();
    if (!wallet) return;
    try {
      setError("");
      setBusy("renew-seat");
      setNotice("Waiting for wallet confirmation to renew the draw seat…");
      await renewDrawSeat(wallet.signer);
      if (walletEpoch.current !== wallet.epoch) return;
      await refresh(wallet.signer);
      if (walletEpoch.current === wallet.epoch) {
        setNotice("Draw seat renewed without exposing or changing private principal.");
      }
    } catch (cause) {
      if (walletEpoch.current === wallet.epoch) setError(productError(cause));
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
    latestFinalized,
    connectedWinner,
    myDeliveredPrizes,
    vault,
    roundWeight,
    prize,
    busy,
    notice,
    error,
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
