import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { AppRoute } from "../lib/routes";
import { useProductTour, type TourRect } from "../hooks/useProductTour";

type CoachmarkSize = { width: number; height: number };
type Position = { top: number; left: number };

function overlaps(left: number, top: number, size: CoachmarkSize, target: TourRect) {
  return !(
    left + size.width <= target.left ||
    left >= target.right ||
    top + size.height <= target.top ||
    top >= target.bottom
  );
}

function coachmarkPosition(target: TourRect | null, size: CoachmarkSize): Position {
  if (!target) return { top: 16, left: 16 };

  const margin = 16;
  const gap = 18;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const hasMobileNavigation = viewportWidth <= 780;
  const safeBottom = viewportHeight - (hasMobileNavigation ? 84 : margin);
  const clampLeft = (left: number) => Math.max(margin, Math.min(viewportWidth - size.width - margin, left));
  const candidates = [
    { left: target.right + gap, top: target.top },
    { left: target.left, top: target.bottom + gap },
    { left: target.left - size.width - gap, top: target.top },
    { left: target.left, top: target.top - size.height - gap },
    { left: clampLeft(target.left), top: target.bottom + gap },
    { left: clampLeft(target.left), top: target.top - size.height - gap },
  ];

  const fits = (candidate: Position) =>
    candidate.left >= margin &&
    candidate.top >= margin &&
    candidate.left + size.width <= viewportWidth - margin + 1 &&
    candidate.top + size.height <= safeBottom + 1 &&
    !overlaps(candidate.left, candidate.top, size, target);
  const safeCandidate = candidates.find(fits);
  if (safeCandidate) return safeCandidate;

  return {
    left: clampLeft(target.left),
    top: Math.max(margin, Math.min(safeBottom - size.height, viewportHeight - size.height - margin)),
  };
}

function panelStyle(top: number, left: number, width: number, height: number): CSSProperties {
  return { top, left, width, height };
}

function focusableCoachmarkControls(coachmark: HTMLElement) {
  return [...coachmark.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
}

function TourInvitation({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <aside className="product-tour-invite" aria-label="UNVEIL product tour invitation">
      <span className="eyebrow">NEW TO UNVEIL?</span>
      <strong>TAKE THE 60-SECOND PRODUCT TOUR.</strong>
      <p>See the real controls behind private saving, draws, and automatic prizes.</p>
      <div className="product-tour-invite-actions">
        <button className="button-primary" type="button" onClick={onStart}>
          START TOUR
        </button>
        <button className="button-quiet" type="button" onClick={onDismiss}>
          NOT NOW
        </button>
      </div>
    </aside>
  );
}

function TourOverlay({ target }: { target: TourRect }) {
  const inset = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(0, target.left - inset);
  const top = Math.max(0, target.top - inset);
  const right = Math.min(viewportWidth, target.right + inset);
  const bottom = Math.min(viewportHeight, target.bottom + inset);
  return (
    <div className="product-tour-layer" aria-hidden="true">
      <div className="product-tour-shade" style={panelStyle(0, 0, viewportWidth, top)} />
      <div className="product-tour-shade" style={panelStyle(bottom, 0, viewportWidth, viewportHeight - bottom)} />
      <div className="product-tour-shade" style={panelStyle(top, 0, left, bottom - top)} />
      <div className="product-tour-shade" style={panelStyle(top, right, viewportWidth - right, bottom - top)} />
      <div className="product-tour-spotlight-guard" style={panelStyle(top, left, right - left, bottom - top)} />
      <div className="product-tour-spotlight" style={panelStyle(top, left, right - left, bottom - top)} />
    </div>
  );
}

export function ProductTour({ route, replayToken }: { route: AppRoute; replayToken: number }) {
  const tour = useProductTour({ route, replayToken });
  const coachmarkRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [coachmarkSize, setCoachmarkSize] = useState<CoachmarkSize>({ width: 360, height: 280 });

  useEffect(() => {
    if (tour.isOpen && !wasOpen.current) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!tour.isOpen && wasOpen.current) {
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
      previousFocus.current = null;
    }
    wasOpen.current = tour.isOpen;
  }, [tour.isOpen]);

  useEffect(() => {
    if (!tour.isOpen) return;
    const focusFirstAction = () => {
      const coachmark = coachmarkRef.current;
      if (!coachmark) return;
      focusableCoachmarkControls(coachmark)[0]?.focus({ preventScroll: true });
    };
    const onFocusIn = (event: FocusEvent) => {
      const coachmark = coachmarkRef.current;
      if (!coachmark || (event.target instanceof Node && coachmark.contains(event.target))) return;
      focusFirstAction();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const coachmark = coachmarkRef.current;
      if (!coachmark) return;
      if (event.key === "Escape") {
        event.preventDefault();
        tour.skip();
        return;
      }

      const insideCoachmark = event.target instanceof Node && coachmark.contains(event.target);
      if (!insideCoachmark) {
        if (
          event.key === "Tab" ||
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight"
        ) {
          event.preventDefault();
          focusFirstAction();
        }
        return;
      }

      if (event.key === "Tab") {
        const actions = focusableCoachmarkControls(coachmark);
        if (actions.length === 0) {
          event.preventDefault();
          coachmark.focus({ preventScroll: true });
          return;
        }
        const currentIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? actions.length - 1
            : currentIndex - 1
          : currentIndex < 0 || currentIndex === actions.length - 1
            ? 0
            : currentIndex + 1;
        event.preventDefault();
        actions[nextIndex].focus({ preventScroll: true });
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        tour.next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        tour.back();
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    const frame = requestAnimationFrame(focusFirstAction);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(frame);
    };
  }, [tour.isOpen, tour.stepIndex]);

  useLayoutEffect(() => {
    if (!tour.isOpen || !coachmarkRef.current) return;
    const measure = () => {
      const rect = coachmarkRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoachmarkSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(measure) : undefined;
    if (resizeObserver && coachmarkRef.current) resizeObserver.observe(coachmarkRef.current);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tour.isOpen, tour.stepIndex, tour.targetRect]);

  if (tour.mode === "invite") return <TourInvitation onStart={tour.start} onDismiss={tour.dismiss} />;
  if (tour.mode !== "tour") return null;

  const position = coachmarkPosition(tour.targetRect, coachmarkSize);
  const coachmarkStyle = { top: position.top, left: position.left } satisfies CSSProperties;
  const titleId = `product-tour-title-${tour.stepIndex}`;
  const copyId = `product-tour-copy-${tour.stepIndex}`;

  return (
    <>
      {tour.targetRect && <TourOverlay target={tour.targetRect} />}
      <aside
        ref={coachmarkRef}
        className={`product-tour-coachmark ${tour.targetRect ? "" : "product-tour-coachmark--waiting"}`}
        style={coachmarkStyle}
        role="dialog"
        aria-modal="true"
        aria-busy={!tour.targetRect}
        aria-labelledby={titleId}
        aria-describedby={copyId}
        tabIndex={-1}
      >
        <div className="product-tour-step">
          STEP {tour.stepIndex + 1} OF {tour.totalSteps}
        </div>
        <span className="eyebrow">UNVEIL PRODUCT TOUR</span>
        <h2 id={titleId}>{tour.step.title}</h2>
        <p id={copyId}>{tour.step.copy}</p>
        {!tour.targetRect && <small className="product-tour-waiting">LOCATING THE CURRENT CONTROL…</small>}
        <div className="product-tour-actions">
          <button className="button-quiet" type="button" onClick={tour.back} disabled={tour.stepIndex === 0}>
            BACK
          </button>
          <button className="button-primary" type="button" onClick={tour.next}>
            {tour.stepIndex === tour.totalSteps - 1 ? "DONE" : "NEXT"}
          </button>
          <button className="button-quiet product-tour-skip" type="button" onClick={tour.skip}>
            SKIP
          </button>
        </div>
      </aside>
    </>
  );
}
