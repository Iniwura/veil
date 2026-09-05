export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`unveil-mark ${compact ? "unveil-mark--compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <rect className="unveil-mark-frame" x="3" y="3" width="26" height="26" />
        <rect className="unveil-mark-door" x="5.5" y="5.5" width="21" height="21" />
        <g className="unveil-mark-rotor">
          <circle cx="16" cy="16" r="6.5" />
          <path className="unveil-mark-spoke" d="M16 9.5v-3M16 22.5v3M9.5 16h-3M22.5 16h3" />
          <circle cx="16" cy="16" r="1.4" />
        </g>
        <path className="unveil-mark-seam" d="M16 3v4" />
      </svg>
    </span>
  );
}
