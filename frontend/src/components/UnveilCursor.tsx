import { useEffect, useRef, useState } from "react";

type CursorIntent = "default" | "enter" | "sealed" | "verify";

const CURSOR_LABELS: Record<CursorIntent, string> = {
  default: "",
  enter: "ENTER",
  sealed: "SEALED",
  verify: "VERIFY",
};

function isNativeCursorTarget(target: Element | null) {
  return Boolean(
    target?.closest(
      "input, textarea, select, [contenteditable=\"true\"], [data-native-cursor], [role=\"textbox\"], [role=\"dialog\"]",
    ),
  );
}

/** Product-wide pointer language for fine pointers; touch and forms keep native behavior. */
export function UnveilCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const magneticRef = useRef<HTMLElement | null>(null);
  const intentRef = useRef<CursorIntent>("default");
  const [intent, setIntent] = useState<CursorIntent>("default");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const queryReducedMotion = () => new URLSearchParams(window.location.search).get("motionReduce") === "1";

    const updateEnabled = () => setEnabled(finePointer.matches && !reducedMotion.matches && !queryReducedMotion());
    updateEnabled();
    finePointer.addEventListener("change", updateEnabled);
    reducedMotion.addEventListener("change", updateEnabled);
    return () => {
      finePointer.removeEventListener("change", updateEnabled);
      reducedMotion.removeEventListener("change", updateEnabled);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let dialogOpen = Boolean(document.querySelector('[role="dialog"]'));

    const resetMagnetic = () => {
      magneticRef.current?.style.removeProperty("--magnet-x");
      magneticRef.current?.style.removeProperty("--magnet-y");
      magneticRef.current = null;
    };

    const setNextIntent = (next: CursorIntent) => {
      if (next === intentRef.current) return;
      intentRef.current = next;
      setIntent(next);
    };

    const move = (event: PointerEvent) => {
      if (dialogOpen || isNativeCursorTarget(event.target as Element | null)) {
        setNextIntent("default");
        resetMagnetic();
      } else {
        if (!frame) {
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            ref.current?.style.setProperty("transform", `translate3d(${event.clientX}px, ${event.clientY}px, 0)`);
          });
        }
        const target = (event.target as Element | null)?.closest<HTMLElement>("[data-cursor]");
        const next = target?.dataset.cursor;
        setNextIntent(next === "enter" || next === "sealed" || next === "verify" ? next : "default");

        const magnetic = (event.target as Element | null)?.closest<HTMLElement>(".button-primary");
        if (magnetic) {
          const rect = magnetic.getBoundingClientRect();
          const x = Math.max(-3, Math.min(3, (event.clientX - (rect.left + rect.width / 2)) / 18));
          const y = Math.max(-3, Math.min(3, (event.clientY - (rect.top + rect.height / 2)) / 18));
          magnetic.style.setProperty("--magnet-x", `${x}px`);
          magnetic.style.setProperty("--magnet-y", `${y}px`);
          magneticRef.current = magnetic;
        } else {
          resetMagnetic();
        }
      }
    };
    const onWindowBlur = () => {
      setNextIntent("default");
      resetMagnetic();
    };
    const observeDialog = () => {
      const next = Boolean(document.querySelector('[role="dialog"]'));
      if (next === dialogOpen) return;
      dialogOpen = next;
      document.documentElement.dataset.unveilCursor = dialogOpen ? "paused" : "active";
      if (dialogOpen) {
        setNextIntent("default");
        resetMagnetic();
      }
    };

    document.documentElement.dataset.unveilCursor = dialogOpen ? "paused" : "active";
    document.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", onWindowBlur);
    const observer = new MutationObserver(observeDialog);
    observer.observe(document.body, { childList: true, subtree: true });
    observeDialog();

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      window.removeEventListener("blur", onWindowBlur);
      observer.disconnect();
      resetMagnetic();
      delete document.documentElement.dataset.unveilCursor;
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className={`unveil-cursor unveil-cursor--${intent}`} ref={ref} aria-hidden="true">
      <i />
      {intent !== "default" && <span>{CURSOR_LABELS[intent]}</span>}
    </div>
  );
}
