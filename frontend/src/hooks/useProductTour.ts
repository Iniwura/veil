import { useEffect, useState } from "react";
import { navigate, type AppRoute } from "../lib/routes";
import { usePrefersReducedMotion } from "./useMotion";

export const PRODUCT_TOUR_STORAGE_KEY = "unveil.guide.completed.v1";

export const PRODUCT_TOUR_STEPS = [
  {
    target: "wallet",
    route: "/app",
    title: "CONNECT YOUR WALLET",
    copy: "Connect a Sepolia wallet to save, unveil private values, or permissionlessly advance a draw. Public draw state remains visible without connecting.",
  },
  {
    target: "nav-save",
    route: "/app/save",
    title: "SAVE",
    copy: "Your money lives here. Deposit confidential TEST principal, request withdrawals, and inspect your private position from one place.",
  },
  {
    target: "save-amount",
    route: "/app/save",
    title: "CHOOSE AN AMOUNT",
    copy: "Enter the TEST amount you want to save. The value is encrypted locally before the pool receives the confidential request.",
  },
  {
    target: "save-submit",
    route: "/app/save",
    title: "SAVE PRIVATELY",
    copy: "This starts the real encrypted deposit flow. Your wallet remains in control of every transaction.",
  },
  {
    target: "private-position",
    route: "/app/save",
    title: "YOUR PRIVATE POSITION",
    copy: "Your active principal, reserved withdrawal and confidential strategy shares stay sealed until your wallet authorizes a reveal.",
  },
  {
    target: "private-reveal",
    route: "/app/save",
    title: "UNVEIL ONLY TO YOU",
    copy: "Your wallet authorizes decryption of values this account is allowed to see. VEIL removes the plaintext from the interface again.",
  },
  {
    target: "nav-draw",
    route: "/app/draw",
    title: "DRAW",
    copy: "Draw timing and lifecycle are public. Participant balances and draw weights remain encrypted.",
  },
  {
    target: "draw-current",
    route: "/app/draw",
    title: "THE ENCRYPTED DRAW",
    copy: "The chamber reflects the public lifecycle without revealing private weights. Any Sepolia wallet can advance an available protocol step.",
  },
  {
    target: "draw-advance",
    route: "/app/draw",
    title: "PERMISSIONLESS PROGRESSION",
    copy: "When a step becomes available, anyone can snapshot the round, run the BlindDraw, verify the winner, or complete prize processing. No privileged draw operator is required.",
  },
  {
    target: "draw-result",
    route: "/app/draw",
    title: "PUBLIC RESULT",
    copy: "The finalized winner is public and verifiable. The participants' financial positions remain private.",
  },
  {
    target: "draw-prize",
    route: "/app/draw",
    title: "AUTOMATIC PRIVATE PRIZE",
    copy: "A finalized winner receives confidential strategy shares automatically. There is no separate claim or authorize transaction.",
  },
] as const satisfies ReadonlyArray<{ target: string; route: AppRoute; title: string; copy: string }>;

export type ProductTourStep = (typeof PRODUCT_TOUR_STEPS)[number];

export type TourRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type ProductTourMode = "invite" | "tour" | null;

function completed() {
  return window.localStorage.getItem(PRODUCT_TOUR_STORAGE_KEY) === "true";
}

function isVisibleTarget(element: HTMLElement) {
  if (!element.isConnected || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (Number.parseFloat(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function resolveProductTourTarget(target: string) {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)]
    .filter(isVisibleTarget)
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
    });
  return candidates[0] ?? null;
}

function rectFor(element: HTMLElement): TourRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function sufficientlyVisible(element: HTMLElement, rect: TourRect) {
  const viewportHeight = window.innerHeight;
  const position = window.getComputedStyle(element).position;
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  if (position === "fixed" || position === "sticky") {
    return visibleHeight >= Math.min(rect.height, 48) && rect.top < viewportHeight && rect.bottom > 0;
  }
  if (rect.height >= viewportHeight * 0.78) {
    const center = rect.top + rect.height / 2;
    return center >= viewportHeight * 0.22 && center <= viewportHeight * 0.78;
  }
  const requiredHeight = Math.min(rect.height, Math.max(100, viewportHeight * 0.46));
  return visibleHeight >= requiredHeight && rect.top < viewportHeight * 0.86 && rect.bottom > viewportHeight * 0.14;
}

export function useProductTour({ route, replayToken }: { route: AppRoute; replayToken: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<ProductTourMode>(() => (route === "/app" && !completed() ? "invite" : null));
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);

  useEffect(() => {
    if (replayToken === 0) return;
    setMode("tour");
    setStepIndex(0);
  }, [replayToken]);

  useEffect(() => {
    if (mode === "invite" && route !== "/app") setMode(null);
  }, [mode, route]);

  useEffect(() => {
    if (mode !== "tour") {
      setTargetRect(null);
      return;
    }

    const step = PRODUCT_TOUR_STEPS[stepIndex];
    if (route !== step.route) {
      setTargetRect(null);
      if (window.location.pathname !== step.route) navigate(step.route);
      return;
    }

    let cancelled = false;
    let frame = 0;
    let target: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let scrollRequested = false;
    let previousSignature = "";
    let stableFrames = 0;
    const startedAt = performance.now();

    const update = () => {
      if (cancelled) return;
      frame = 0;
      const candidate = resolveProductTourTarget(step.target);
      if (!candidate) {
        target = null;
        resizeObserver?.disconnect();
        resizeObserver = undefined;
        stableFrames = 0;
        previousSignature = "";
        setTargetRect(null);
        if (performance.now() - startedAt < 5000) frame = requestAnimationFrame(update);
        return;
      }

      if (target !== candidate) {
        target = candidate;
        resizeObserver?.disconnect();
        if ("ResizeObserver" in window) {
          resizeObserver = new ResizeObserver(scheduleUpdate);
          resizeObserver.observe(candidate);
        }
        scrollRequested = false;
        stableFrames = 0;
        previousSignature = "";
      }

      const currentRect = rectFor(candidate);
      if (!scrollRequested && !sufficientlyVisible(candidate, currentRect)) {
        candidate.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: reducedMotion ? "auto" : "smooth",
        });
        scrollRequested = true;
      }

      const signature = [currentRect.top, currentRect.left, currentRect.width, currentRect.height].join(":");
      stableFrames = signature === previousSignature ? stableFrames + 1 : 0;
      previousSignature = signature;
      if (stableFrames >= 2 || reducedMotion || performance.now() - startedAt >= 5000) {
        setTargetRect((previous) => {
          if (
            previous &&
            previous.top === currentRect.top &&
            previous.right === currentRect.right &&
            previous.bottom === currentRect.bottom &&
            previous.left === currentRect.left &&
            previous.width === currentRect.width &&
            previous.height === currentRect.height
          ) {
            return previous;
          }
          return currentRect;
        });
      } else {
        frame = requestAnimationFrame(update);
      }
    };

    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
    };
  }, [mode, reducedMotion, route, stepIndex]);

  function start() {
    setStepIndex(0);
    setMode("tour");
  }

  function finish() {
    window.localStorage.setItem(PRODUCT_TOUR_STORAGE_KEY, "true");
    setMode(null);
  }

  function dismiss() {
    setMode(null);
  }

  function next() {
    if (stepIndex === PRODUCT_TOUR_STEPS.length - 1) finish();
    else setStepIndex((value) => value + 1);
  }

  function back() {
    setStepIndex((value) => Math.max(0, value - 1));
  }

  return {
    mode,
    stepIndex,
    step: PRODUCT_TOUR_STEPS[stepIndex],
    targetRect,
    start,
    next,
    back,
    finish,
    dismiss,
    skip: finish,
    isOpen: mode === "tour",
    totalSteps: PRODUCT_TOUR_STEPS.length,
  };
}
