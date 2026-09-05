export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`demo-badge ${compact ? "demo-badge--compact" : ""}`}>
      SEPOLIA · DEMO cUSDC · SIMULATED YIELD
    </span>
  );
}
