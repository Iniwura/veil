export function isHistoricalRoundNotIncluded(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("UNVEIL_ROUND_WEIGHT_UNAVAILABLE:");
}

export function historicalRoundNotIncludedMessage(roundId: bigint | number | string) {
  return `NOT INCLUDED IN ROUND ${roundId.toString()} · This wallet was not part of that historical snapshot. Select another round.`;
}

export function drawStateLabel(schedule?: {
  insufficientParticipants: boolean;
  ready: boolean;
  timeReady: boolean;
  overdue: boolean;
}) {
  if (!schedule) return "LOADING";
  if (schedule.overdue) return "KEEPER SETTLING";
  if (schedule.insufficientParticipants) return "INSUFFICIENT";
  if (schedule.ready) return "READY";
  if (schedule.timeReady) return "CLOSED";
  return "OPEN";
}
