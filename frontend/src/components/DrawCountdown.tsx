import { useEffect, useState } from "react";
import { drawCountdownLabel } from "../lib/format";

function remaining(closesAt?: bigint) {
  if (!closesAt) return { display: "—", closed: false, seconds: undefined };
  const seconds = Math.max(0, Number(closesAt) - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return {
    display:
      days > 0
        ? `${days}D ${hours.toString().padStart(2, "0")}H`
        : `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
    closed: seconds === 0,
    seconds,
  };
}

export function DrawCountdown({
  closesAt,
  timeReady,
  ready,
  insufficientParticipants,
}: {
  closesAt?: bigint;
  timeReady?: boolean;
  ready?: boolean;
  insufficientParticipants?: boolean;
}) {
  const [value, setValue] = useState(() => remaining(closesAt));
  useEffect(() => {
    setValue(remaining(closesAt));
    const timer = window.setInterval(() => setValue(remaining(closesAt)), 1000);
    return () => window.clearInterval(timer);
  }, [closesAt]);
  const closed = timeReady || value.closed;
  const label = drawCountdownLabel({
    closed: Boolean(closed),
    ready,
    insufficientParticipants,
    display: value.display,
  });
  const finalMinute = !closed && value.seconds !== undefined && value.seconds < 60;
  const finalTen = !closed && value.seconds !== undefined && value.seconds < 10;
  return (
    <span
      className={`draw-countdown ${finalMinute ? "draw-countdown--final-minute" : ""} ${finalTen ? "draw-countdown--final-ten" : ""}`}
      aria-label="Time until scheduled draw close"
    >
      {label}
    </span>
  );
}
