import { useEffect, useRef, useState } from "react";

type CursorIntent = "default" | "enter" | "sealed" | "verify";

const CURSOR_LABELS: Record<CursorIntent, string> = {
  default: "",
  enter: "ENTER ↗",
  sealed: "SEALED",
  verify: "VERIFY",
};

/** A small marketing-only pointer aid. It never runs in the application shell. */
export function LandingCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const intentRef = useRef<CursorIntent>("default");
  const [intent, setIntent] = useState<CursorIntent>("default");

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          ref.current?.style.setProperty("transform", `translate3d(${event.clientX}px, ${event.clientY}px, 0)`);
        });
      }
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-cursor]");
      const next = target?.dataset.cursor;
      const nextIntent: CursorIntent = next === "enter" || next === "sealed" || next === "verify" ? next : "default";
      if (nextIntent !== intentRef.current) {
        intentRef.current = nextIntent;
        setIntent(nextIntent);
      }
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div className={`landing-cursor landing-cursor--${intent}`} ref={ref} aria-hidden="true">
      <i />
      {intent !== "default" && <span>{CURSOR_LABELS[intent]}</span>}
    </div>
  );
}
