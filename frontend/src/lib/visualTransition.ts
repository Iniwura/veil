import { flushSync } from "react-dom";

type Transition = { finished: Promise<void>; skipTransition: () => void };
type TransitionDocument = { startViewTransition?: (update: () => void) => Transition };

let activeTransition: Transition | undefined;

function hasSensitiveSurface() {
  return Boolean(document.querySelector('[data-reveal-state]:not([data-reveal-state="SEALED"]), [role="dialog"]'));
}

/** Cosmetic route/theme transitions never snapshot an open private value. */
export function visualTransition(update: () => void, kind: "route" | "theme") {
  const reduced =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.motionReduced === "true";
  const start = (document as unknown as TransitionDocument).startViewTransition;
  activeTransition?.skipTransition();
  if (!start || reduced || document.hidden || hasSensitiveSurface()) {
    update();
    return;
  }

  document.documentElement.dataset.visualTransition = kind;
  let transition: Transition;
  try {
    transition = start.call(document, () => flushSync(update));
  } catch {
    delete document.documentElement.dataset.visualTransition;
    update();
    return;
  }
  activeTransition = transition;
  const observer = new MutationObserver(() => {
    if (hasSensitiveSurface()) transition.skipTransition();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-reveal-state"],
  });
  void transition.finished
    .catch(() => {})
    .finally(() => {
      observer.disconnect();
      if (activeTransition === transition) {
        activeTransition = undefined;
        delete document.documentElement.dataset.visualTransition;
      }
    });
}
