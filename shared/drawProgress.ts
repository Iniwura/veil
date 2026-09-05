export function drawRoundProgressPercent(
  opensAt?: bigint,
  closesAt?: bigint,
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
) {
  if (opensAt === undefined || closesAt === undefined || closesAt <= opensAt) return 0;
  if (nowSeconds <= opensAt) return 0;
  if (nowSeconds >= closesAt) return 100;
  return Number(((nowSeconds - opensAt) * 100n) / (closesAt - opensAt));
}

export function drawRoundCountdownSeconds(closesAt?: bigint, nowSeconds = BigInt(Math.floor(Date.now() / 1000))) {
  if (closesAt === undefined || nowSeconds >= closesAt) return 0;
  return Number(closesAt - nowSeconds);
}

export function formatDrawCountdown(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return [hours, minutes, remainder].map((value) => value.toString().padStart(2, "0")).join(":");
}
