import { UNVEIL_NETWORK } from "../contracts";

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function explorerAddress(address: string) {
  return `${UNVEIL_NETWORK.explorer}/address/${address}`;
}

export function formatDate(timestamp?: bigint) {
  if (!timestamp) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function drawStateLabel(schedule?: {
  insufficientParticipants: boolean;
  ready: boolean;
  timeReady: boolean;
  overdue: boolean;
}) {
  if (!schedule) return "LOADING";
  if (schedule.overdue) return "OVERDUE";
  if (schedule.insufficientParticipants) return "INSUFFICIENT";
  if (schedule.ready) return "READY";
  if (schedule.timeReady) return "CLOSED";
  return "OPEN";
}

export function drawCountdownLabel({
  closed,
  ready,
  insufficientParticipants,
  display,
}: {
  closed: boolean;
  ready?: boolean;
  insufficientParticipants?: boolean;
  display: string;
}) {
  if (!closed && !ready) return display;
  return insufficientParticipants ? "READY TO SKIP" : "READY TO DRAW / ADVANCE";
}
