export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`demo-badge ${compact ? "demo-badge--compact" : ""}`}>
      SEPOLIA TESTNET · DEMO ASSET · SIMULATED ERC4626
    </span>
  );
}
