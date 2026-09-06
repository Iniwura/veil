import { useCallback, useEffect, useMemo, useState } from "react";

import type { TourStep } from "../components/ProductTour";

const TOUR_STORAGE_KEY = "unveil-product-tour-complete";
const TOUR_CONTROL_EVENT = "unveil:tour-control";

export type TourControlDetail =
  | { action: "open-save-dialog"; stepId: "save-faucet" | "save-amount" }
  | { action: "close-save-dialog" };

export function dispatchTourControl(detail: TourControlDetail): void {
  window.dispatchEvent(new CustomEvent<TourControlDetail>(TOUR_CONTROL_EVENT, { detail }));
}

export function useProductTour() {
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  const steps = useMemo<TourStep[]>(
    () => [
      {
        id: "welcome",
        title: "Welcome to UNVEIL",
        body: "Save privately, build encrypted draw weight, and follow public prize settlement without exposing your balance.",
        target: '[data-tour="welcome"]',
        route: "/app",
      },
      {
        id: "private-position",
        title: "Your private position",
        body: "UNVEIL keeps your available cUSDC, saved principal, pending withdrawal, and prize value sealed until you authorize a reveal.",
        target: '[data-tour="private-position"]',
        route: "/app",
      },
      {
        id: "save-faucet",
        title: "First save",
        body: "A fresh demo wallet can claim demo cUSDC from the first-save faucet before making its first private deposit.",
        target: '[data-tour="save-faucet"]',
        route: "/app/save",
      },
      {
        id: "save-amount",
        title: "Choose an amount",
        body: "Enter the cUSDC amount to save. The browser encrypts it before the wallet submits the transaction.",
        target: '[data-tour="save-amount"]',
        route: "/app/save",
      },
      {
        id: "save-position",
        title: "Private savings",
        body: "Your saved principal remains confidential. New savings mature for one complete draw period before contributing prize weight.",
        target: '[data-tour="save-position"]',
        route: "/app/save",
      },
      {
        id: "withdraw",
        title: "Withdraw principal",
        body: "Draw maturity does not lock principal. Withdrawals follow a separate confidential settlement path.",
        target: '[data-tour="withdraw"]',
        route: "/app/save",
      },
      {
        id: "draw-round",
        title: "Current draw",
        body: "The round closes on a fixed onchain schedule. Mature encrypted weights are frozen before winner selection.",
        target: '[data-tour="draw-round"]',
        route: "/app/draw",
      },
      {
        id: "draw-rotor",
        title: "Encrypted weighted draw",
        body: "UNVEIL selects a weighted shard, then a weighted member inside that shard using FHE randomness and encrypted balances.",
        target: '[data-tour="draw-rotor"]',
        route: "/app/draw",
      },
      {
        id: "verified-result",
        title: "Verified winner",
        body: "The final winner is publicly verifiable while the balances and weights that produced the result remain encrypted.",
        target: '[data-tour="verified-result"]',
        route: "/app/draw",
      },
      {
        id: "history",
        title: "Round history",
        body: "Review completed rounds and settlement evidence without revealing private saver balances.",
        target: '[data-tour="history"]',
        route: "/app/draw",
      },
      {
        id: "prize-vault",
        title: "Prize Vault",
        body: "Winners receive confidential strategy-share prizes automatically. Reveal each delivered prize independently when you choose.",
        target: '[data-tour="prize-vault"]',
        route: "/app/draw",
      },
    ],
    [],
  );

  const activeStep = activeStepIndex === null ? null : steps[activeStepIndex] ?? null;

  const closeTour = useCallback(() => {
    setActiveStepIndex(null);
    dispatchTourControl({ action: "close-save-dialog" });
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {
      // Ignore storage failures; the tour can still function for the current session.
    }
  }, []);

  const startTour = useCallback(() => {
    setActiveStepIndex(0);
  }, []);

  const goToStep = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= steps.length) {
        closeTour();
        return;
      }
      setActiveStepIndex(nextIndex);
    },
    [closeTour, steps.length],
  );

  const nextStep = useCallback(() => {
    if (activeStepIndex === null) return;
    goToStep(activeStepIndex + 1);
  }, [activeStepIndex, goToStep]);

  const previousStep = useCallback(() => {
    if (activeStepIndex === null) return;
    goToStep(activeStepIndex - 1);
  }, [activeStepIndex, goToStep]);

  useEffect(() => {
    if (!activeStep) return;

    if (activeStep.id === "save-faucet" || activeStep.id === "save-amount") {
      dispatchTourControl({ action: "open-save-dialog", stepId: activeStep.id });
      return;
    }

    dispatchTourControl({ action: "close-save-dialog" });
  }, [activeStep]);

  useEffect(() => {
    if (activeStepIndex !== null) return;

    try {
      if (window.localStorage.getItem(TOUR_STORAGE_KEY) === "true") return;
    } catch {
      // Ignore storage failures and show the tour for this session.
    }

    const timer = window.setTimeout(() => setActiveStepIndex(0), 500);
    return () => window.clearTimeout(timer);
  }, [activeStepIndex]);

  return {
    activeStep,
    activeStepIndex,
    steps,
    startTour,
    closeTour,
    nextStep,
    previousStep,
    goToStep,
    isTourActive: activeStepIndex !== null,
  };
}

export { TOUR_CONTROL_EVENT };
