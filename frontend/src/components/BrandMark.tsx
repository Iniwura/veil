export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`unveil-mark ${compact ? "unveil-mark--compact" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
