import { useEffect, useState } from "react";

function remaining(closesAt?: bigint) {
  if (!closesAt) return { display: "—", closed: false };
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
  };
}

export function DrawCountdown({ closesAt, ready }: { closesAt?: bigint; ready?: boolean }) {
  const [value, setValue] = useState(() => remaining(closesAt));
  useEffect(() => {
    setValue(remaining(closesAt));
    const timer = window.setInterval(() => setValue(remaining(closesAt)), 1000);
    return () => window.clearInterval(timer);
  }, [closesAt]);
  return (
    <span className="draw-countdown" aria-label="Time until scheduled draw close">
      {ready || value.closed ? "READY TO ADVANCE" : value.display}
    </span>
  );
}
