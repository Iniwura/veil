export type RevealedPrizeValues = Readonly<Record<string, bigint>>;

export function prizeRevealKey(roundId: bigint, prizeIndex: number) {
  return `${roundId.toString()}-${prizeIndex}`;
}

export function revealPrizeValue(values: RevealedPrizeValues, key: string, value: bigint): RevealedPrizeValues {
  return { ...values, [key]: value };
}

export function veilPrizeValue(values: RevealedPrizeValues, key: string): RevealedPrizeValues {
  const next = { ...values };
  delete next[key];
  return next;
}

export function clearPrizeValues(): RevealedPrizeValues {
  return {};
}
