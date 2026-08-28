export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`unveil-mark ${compact ? "unveil-mark--compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <path className="aperture-plane aperture-plane--left" d="M8 7h23v50H8z" />
        <path className="aperture-plane aperture-plane--right" d="M37 15h19v34H37z" />
        <path className="aperture-slit" d="M33 13h2v38h-2z" />
      </svg>
    </span>
  );
}
