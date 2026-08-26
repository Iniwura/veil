export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`unveil-mark ${compact ? "unveil-mark--compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <path className="aperture-plane aperture-plane--left" d="M8 8h16l12 24-12 24H8l10-24z" />
        <path className="aperture-plane aperture-plane--right" d="M56 8H40L28 32l12 24h16L46 32z" />
        <rect className="aperture-slit" x="30" y="11" width="4" height="42" rx="2" />
      </svg>
    </span>
  );
}
