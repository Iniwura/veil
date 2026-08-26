import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../hooks/useMotion";

export type CryptographicChamberState = "OPEN" | "READY" | "INSUFFICIENT" | "OVERDUE";

type Fragment = {
  angle: number;
  curve: number;
  distance: number;
  length: number;
  layer: number;
  phase: number;
  speed: number;
  width: number;
};

type ParticipantPulse = {
  angle: number;
  phase: number;
};

const MAX_PARTICIPANT_PULSES = 16;
const FRAGMENT_COUNT = 58;

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildFragments(): Fragment[] {
  return Array.from({ length: FRAGMENT_COUNT }, (_, index) => ({
    angle: seeded(index + 1) * Math.PI * 2,
    curve: seeded(index + 11) * 0.48 - 0.24,
    distance: 0.22 + seeded(index + 21) * 0.34,
    length: 3 + seeded(index + 31) * 9,
    layer: 0.35 + seeded(index + 41) * 0.65,
    phase: seeded(index + 51),
    speed: 0.018 + seeded(index + 61) * 0.026,
    width: 0.7 + seeded(index + 71) * 1.2,
  }));
}

function buildParticipants(count: number): ParticipantPulse[] {
  return Array.from({ length: count }, (_, index) => ({
    angle: index * ((Math.PI * 2) / Math.max(count, 1)) - Math.PI / 2,
    phase: index / Math.max(count, 1),
  }));
}

function stateIntensity(state: CryptographicChamberState) {
  if (state === "READY") return 1.22;
  if (state === "INSUFFICIENT") return 0.72;
  if (state === "OVERDUE") return 0.9;
  return 1;
}

export function CryptographicChamber({
  roundId,
  participantCount,
  state,
  compact = false,
  conceptual = false,
}: {
  roundId?: bigint;
  participantCount?: number;
  state: CryptographicChamberState;
  compact?: boolean;
  conceptual?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

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
    const pulseCount = conceptual ? 8 : Math.min(Math.max(participantCount ?? 0, 0), MAX_PARTICIPANT_PULSES);
    const participants = buildParticipants(pulseCount);
    const pointer = { x: 0, y: 0 };
    const intensity = stateIntensity(state);
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
      const centerX = width * 0.5 + pointer.x * 8;
      const centerY = height * 0.5 + pointer.y * 6;
      const radius = Math.min(width, height) * 0.43;
      context.clearRect(0, 0, width, height);

      const glow = context.createRadialGradient(centerX, centerY, radius * 0.06, centerX, centerY, radius * 1.1);
      glow.addColorStop(0, "rgba(242, 213, 21, 0.08)");
      glow.addColorStop(0.45, "rgba(242, 213, 21, 0.025)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(centerX, centerY);
      context.lineCap = "round";
      fragments.forEach((fragment) => {
        const progress = (fragment.phase + time * fragment.speed * intensity) % 1;
        const orbit = fragment.distance * radius * (0.72 + progress * 0.28);
        const angle = fragment.angle + fragment.curve * Math.sin(progress * Math.PI * 2);
        const x = Math.cos(angle) * orbit;
        const y = Math.sin(angle) * orbit * 0.72;
        const alpha = (0.14 + fragment.layer * 0.22) * (state === "INSUFFICIENT" ? 0.78 : 1);
        context.globalAlpha = alpha;
        context.strokeStyle = lightTheme ? "#5d5a50" : state === "OVERDUE" ? "#aaa79d" : "#d8d4c8";
        context.lineWidth = fragment.width;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle + 0.42) * fragment.length, y + Math.sin(angle + 0.42) * fragment.length);
        context.stroke();
      });

      const pulseRadius = radius * (state === "READY" ? 0.94 : state === "INSUFFICIENT" ? 0.82 : 0.88);
      participants.forEach((participant) => {
        const pulse = reducedMotion ? 0 : Math.sin((time * 1.4 + participant.phase) * Math.PI * 2) * 0.5 + 0.5;
        const x = Math.cos(participant.angle + pointer.x * 0.03) * pulseRadius;
        const y = Math.sin(participant.angle + pointer.y * 0.03) * pulseRadius * 0.68;
        context.globalAlpha = 0.58 + pulse * 0.15;
        context.fillStyle = lightTheme ? "#b89400" : "#f2d515";
        context.beginPath();
        context.arc(x, y, 2.6, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 0.18;
        context.beginPath();
        context.arc(x, y, 7 + pulse * 2, 0, Math.PI * 2);
        context.strokeStyle = lightTheme ? "#b89400" : "#f2d515";
        context.lineWidth = 1;
        context.stroke();
      });

      const beamProgress = (time * (state === "OVERDUE" ? 0.12 : state === "READY" ? 0.2 : 0.065)) % 1;
      const beamX = -width * 0.62 + beamProgress * width * 1.8;
      context.globalAlpha = reducedMotion ? 0.45 : state === "INSUFFICIENT" ? 0.2 : 0.72;
      context.strokeStyle = lightTheme ? "#b89400" : "#f2d515";
      context.lineWidth = state === "READY" ? 1.5 : 1;
      context.beginPath();
      context.moveTo(beamX, -height * 0.65);
      context.lineTo(beamX + height * 0.36, height * 0.65);
      context.stroke();
      if (state === "OVERDUE") {
        context.globalAlpha *= 0.35;
        context.beginPath();
        context.moveTo(beamX - 12, -height * 0.65);
        context.lineTo(beamX + height * 0.36 - 12, height * 0.65);
        context.stroke();
      }
      context.restore();
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

    function handlePointer(event: PointerEvent) {
      if (reducedMotion || !window.matchMedia("(pointer: fine)").matches) return;
      const rect = stage.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width - 0.5;
      pointer.y = (event.clientY - rect.top) / rect.height - 0.5;
    }

    function resetPointer() {
      pointer.x = 0;
      pointer.y = 0;
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
    stage.addEventListener("pointermove", handlePointer);
    stage.addEventListener("pointerleave", resetPointer);
    resize();
    restart();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      stage.removeEventListener("pointermove", handlePointer);
      stage.removeEventListener("pointerleave", resetPointer);
    };
  }, [compact, conceptual, participantCount, reducedMotion, state]);

  const centerLabel =
    state === "INSUFFICIENT"
      ? "READY TO SKIP"
      : state === "READY"
        ? "DRAW READY"
        : state === "OVERDUE"
          ? "LIFECYCLE BACKLOG"
          : "FHE SEALED";
  const description = conceptual
    ? "Conceptual identity study · encrypted inputs remain unreadable"
    : "Public participants only · visual pulses never represent private weight";

  return (
    <section
      className={`cryptographic-chamber cryptographic-chamber--${state.toLowerCase()} ${compact ? "cryptographic-chamber--compact" : ""} ${conceptual ? "cryptographic-chamber--conceptual" : ""}`}
      data-chamber-state={state}
      aria-label={`${conceptual ? "Conceptual " : "Live "}cryptographic chamber. ${centerLabel}.`}
    >
      <div className="chamber-header">
        <span>{conceptual ? "SIGNATURE VISUAL · CONCEPTUAL" : `ROUND ${roundId?.toString().padStart(2, "0") ?? "—"}`}</span>
        <span>{conceptual ? "PRIVATE INPUTS" : `${participantCount ?? "—"} PUBLIC PARTICIPANTS`}</span>
      </div>
      <div className="chamber-stage" ref={stageRef} aria-hidden="true">
        <canvas ref={canvasRef} />
        <div className="chamber-aperture">
          <span className="chamber-shutter chamber-shutter--left" />
          <span className="chamber-shutter chamber-shutter--right" />
          <i className="chamber-slit" />
          <div className="chamber-core-label">
            <span>SEALED CORE</span>
            <strong>{centerLabel}</strong>
          </div>
        </div>
      </div>
      <div className="chamber-footer">
        <span className="chamber-state-indicator">{state}</span>
        <p>{description}</p>
      </div>
      {state === "OVERDUE" && <small className="chamber-warning">EARLIER LIFECYCLE STEP UNSETTLED · ENCRYPTION INTACT</small>}
    </section>
  );
}
