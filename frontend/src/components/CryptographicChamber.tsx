import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../hooks/useMotion";

export type CryptographicChamberState = "OPEN" | "READY" | "INSUFFICIENT" | "OVERDUE";
export type CryptographicChamberPhase =
  | "SEALED"
  | "SNAPSHOT"
  | "BLIND_DRAW"
  | "VERIFY"
  | "DELIVER"
  | "SKIP"
  | "BACKLOG"
  | "COMPLETE";

type Fragment = {
  side: -1 | 1;
  lane: number;
  phase: number;
  speed: number;
  length: number;
  thickness: number;
};

type ParticipantTick = {
  distance: number;
};

const MAX_PARTICIPANT_TICKS = 16;
const FRAGMENT_COUNT = 42;

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildFragments(): Fragment[] {
  return Array.from({ length: FRAGMENT_COUNT }, (_, index) => ({
    side: seeded(index + 1) > 0.5 ? 1 : -1,
    lane: 0.14 + seeded(index + 11) * 0.72,
    phase: seeded(index + 21),
    speed: 0.025 + seeded(index + 31) * 0.035,
    length: 4 + seeded(index + 41) * 10,
    thickness: 0.7 + seeded(index + 51) * 1.1,
  }));
}

function buildParticipantTicks(count: number): ParticipantTick[] {
  const visibleCount = Math.min(Math.max(count, 0), MAX_PARTICIPANT_TICKS);
  return Array.from({ length: visibleCount }, (_, index) => ({
    distance: index / Math.max(visibleCount, 1),
  }));
}

function phaseForState(state: CryptographicChamberState): CryptographicChamberPhase {
  if (state === "INSUFFICIENT") return "SKIP";
  if (state === "OVERDUE") return "BACKLOG";
  if (state === "READY") return "SNAPSHOT";
  return "SEALED";
}

function phaseLabel(phase: CryptographicChamberPhase) {
  return phase === "BLIND_DRAW" ? "BLIND DRAW" : phase;
}

function phaseDescription(phase: CryptographicChamberPhase, conceptual: boolean) {
  if (conceptual) {
    if (phase === "SNAPSHOT") return "Weights lock without becoming readable.";
    if (phase === "BLIND_DRAW") return "Selection happens behind the sealed aperture.";
    if (phase === "DELIVER") return "One verified path exits; private amounts stay sealed.";
    return "Equal markers show public ingress, never private weight.";
  }
  if (phase === "SNAPSHOT") return "The snapshot locks without exposing private weights.";
  if (phase === "BLIND_DRAW") return "The draw runs behind the sealed aperture.";
  if (phase === "VERIFY") return "Verification crosses the slit without opening the veil.";
  if (phase === "DELIVER") return "One settlement path exits; the financial interior stays sealed.";
  if (phase === "SKIP") return "Insufficient participation; no encrypted winner exists.";
  if (phase === "BACKLOG") return "Earlier lifecycle work remains queued; encryption stays intact.";
  if (phase === "COMPLETE") return "Round settled with no prize due; the lifecycle can advance.";
  return "Equal markers represent public participants, never private weight.";
}

function perimeterPoint(distance: number, width: number, height: number) {
  const inset = Math.min(24, Math.max(12, Math.min(width, height) * 0.06));
  const perimeter = 2 * (width - inset * 2) + 2 * (height - inset * 2);
  let remaining = distance * perimeter;
  if (remaining <= width - inset * 2) return { x: inset + remaining, y: inset, dx: 0, dy: 1 };
  remaining -= width - inset * 2;
  if (remaining <= height - inset * 2) return { x: width - inset, y: inset + remaining, dx: -1, dy: 0 };
  remaining -= height - inset * 2;
  if (remaining <= width - inset * 2) {
    return { x: width - inset - remaining, y: height - inset, dx: 0, dy: -1 };
  }
  remaining -= width - inset * 2;
  return { x: inset, y: height - inset - remaining, dx: 1, dy: 0 };
}

export function CryptographicChamber({
  roundId,
  participantCount,
  state,
  phase,
  compact = false,
  conceptual = false,
}: {
  roundId?: bigint;
  participantCount?: number;
  state: CryptographicChamberState;
  phase?: CryptographicChamberPhase;
  compact?: boolean;
  conceptual?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const activePhase = phase ?? phaseForState(state);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    const stageElement = stageRef.current;
    if (!canvasElement || !stageElement) return;
    const canvas = canvasElement;
    const stage = stageElement;
    const contextElement = canvas.getContext("2d");
    if (!contextElement) return;
    const context = contextElement;

    const fragments = buildFragments();
    const participants = buildParticipantTicks(conceptual ? 8 : (participantCount ?? 0));
    let width = 0;
    let height = 0;
    let active = !document.hidden;
    let visible = true;
    let frame = 0;
    let lightTheme = document.documentElement.dataset.theme === "light";

    function resize() {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(timestamp: number) {
      if (!width || !height) resize();
      const time = reducedMotion ? 0 : timestamp * 0.001;
      const centerX = width * 0.5;
      const apertureEdge = width * 0.13;
      context.clearRect(0, 0, width, height);
      context.lineCap = "square";

      if (activePhase !== "SKIP" && activePhase !== "BACKLOG" && activePhase !== "COMPLETE") {
        fragments.forEach((fragment) => {
          const motionScale = activePhase === "BLIND_DRAW" ? 1.35 : activePhase === "SNAPSHOT" ? 0.45 : 0.8;
          const progress = reducedMotion ? fragment.phase : (fragment.phase + time * fragment.speed * motionScale) % 1;
          const startX = fragment.side < 0 ? -fragment.length : width + fragment.length;
          const endX = fragment.side < 0 ? centerX - apertureEdge : centerX + apertureEdge;
          const x = startX + (endX - startX) * progress;
          const y = height * fragment.lane + Math.sin((progress + fragment.phase) * Math.PI * 2) * 3;
          const fading = progress > 0.82 ? 1 - (progress - 0.82) / 0.18 : 1;
          context.globalAlpha = (0.16 + seeded(Math.round(fragment.phase * 1000)) * 0.18) * fading;
          context.strokeStyle = lightTheme ? "#6b6659" : "#d8d4c8";
          context.lineWidth = fragment.thickness;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - fragment.side * fragment.length, y + (fragment.side * 0.35 + fragment.phase) * 4);
          context.stroke();
        });
      }

      participants.forEach((participant) => {
        const point = perimeterPoint(participant.distance, width, height);
        context.globalAlpha = 0.72;
        context.strokeStyle = lightTheme ? "#8d7100" : "#f2d515";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + point.dx * 7, point.y + point.dy * 7);
        context.stroke();
      });

      if (activePhase === "BACKLOG") {
        context.globalAlpha = 0.5;
        context.strokeStyle = lightTheme ? "#8a836f" : "#aaa79d";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(centerX - 18, height * 0.18);
        context.lineTo(centerX + 18, height * 0.18);
        context.stroke();
      }

      context.globalAlpha = 1;
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }

    function loop(timestamp: number) {
      draw(timestamp);
      if (!reducedMotion && active && visible) frame = window.requestAnimationFrame(loop);
    }

    function restart() {
      stop();
      draw(0);
      if (!reducedMotion && active && visible) frame = window.requestAnimationFrame(loop);
    }

    function handleVisibility() {
      active = !document.hidden;
      restart();
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      restart();
    });
    const themeObserver = new MutationObserver(() => {
      lightTheme = document.documentElement.dataset.theme === "light";
      draw(0);
    });
    resizeObserver.observe(stage);
    intersectionObserver.observe(stage);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", handleVisibility);
    resize();
    restart();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activePhase, conceptual, participantCount, reducedMotion]);

  const displayPhase = phaseLabel(activePhase);
  const description = phaseDescription(activePhase, conceptual);

  return (
    <section
      className={`cryptographic-chamber cryptographic-chamber--${state.toLowerCase()} cryptographic-chamber--phase-${activePhase.toLowerCase().replace("_", "-")} ${compact ? "cryptographic-chamber--compact" : ""} ${conceptual ? "cryptographic-chamber--conceptual" : ""}`}
      data-chamber-state={state}
      data-chamber-phase={activePhase}
      aria-label={`${conceptual ? "Conceptual " : "Live "}cryptographic chamber. ${displayPhase}.`}
    >
      <div className="chamber-header">
        <span>{conceptual ? "CRYPTOGRAPHIC CHAMBER" : `ROUND ${roundId?.toString().padStart(2, "0") ?? "—"}`}</span>
        <span>{conceptual ? "CONCEPTUAL · NOT LIVE STATE" : `${participantCount ?? "—"} PUBLIC PARTICIPANTS`}</span>
      </div>
      <div className="chamber-stage" ref={stageRef} aria-hidden="true">
        <canvas ref={canvasRef} />
        <div className="chamber-aperture">
          <span className="chamber-shutter chamber-shutter--left" />
          <span className="chamber-shutter chamber-shutter--right" />
          <i className="chamber-slit" />
          <i className="chamber-lock-line" />
          <i className="chamber-output" />
          <i className="chamber-skip-mark" />
          <i className="chamber-backlog-mark" />
          <i className="chamber-complete-mark" />
        </div>
      </div>
      <div className="chamber-footer">
        <span className="chamber-state-indicator">{displayPhase}</span>
        <p>{description}</p>
      </div>
    </section>
  );
}
