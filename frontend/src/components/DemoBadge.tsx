export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return <span className={`demo-badge ${compact ? "demo-badge--compact" : ""}`}>TEST/DEMO · SIMULATED ERC4626</span>;
}
