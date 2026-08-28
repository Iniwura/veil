type EncryptedMatterArtworkProps = {
  className?: string;
  idPrefix?: string;
};

/** A marketing-only abstraction for the sealed/private side of UNVEIL. */
export function EncryptedMatterArtwork({ className = "", idPrefix = "matter" }: EncryptedMatterArtworkProps) {
  const baseId = `${idPrefix}-base`;
  const foldId = `${idPrefix}-fold`;
  const edgeId = `${idPrefix}-edge`;
  const cutId = `${idPrefix}-cut`;
  return (
    <svg
      className={`encrypted-matter-artwork ${className}`}
      viewBox="0 0 900 760"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={baseId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24231e" />
          <stop offset="0.48" stopColor="#13130f" />
          <stop offset="1" stopColor="#080806" />
        </linearGradient>
        <linearGradient id={foldId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b0b08" />
          <stop offset="0.5" stopColor="#303027" />
          <stop offset="1" stopColor="#0a0a07" />
        </linearGradient>
        <linearGradient id={edgeId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2d515" stopOpacity="0" />
          <stop offset="0.48" stopColor="#f2d515" stopOpacity="0.82" />
          <stop offset="1" stopColor="#f2d515" stopOpacity="0" />
        </linearGradient>
        <clipPath id={cutId}>
          <path d="M96 76 794 28 860 606 174 720 42 454Z" />
        </clipPath>
      </defs>
      <path d="M94 112 790 58 862 626 182 744 40 470Z" fill="#000" opacity="0.55" />
      <path d="M96 76 794 28 860 606 174 720 42 454Z" fill={`url(#${baseId})`} />
      <g clipPath={`url(#${cutId})`} fill="none" strokeLinecap="round">
        <path d="M-42 630 812 -8" stroke="#3d3b31" strokeWidth="132" opacity="0.2" />
        <path d="M60 756 900 112" stroke="#666254" strokeWidth="92" opacity="0.12" />
        <path d="M178 772 930 196" stroke="#0a0a08" strokeWidth="120" opacity="0.58" />
        <path d="M308 786 946 294" stroke="#9a9275" strokeWidth="50" opacity="0.08" />
        <path d="M470 790 952 420" stroke="#050504" strokeWidth="94" opacity="0.72" />
        <path d="M-20 466 618 -18" stroke="#d2c89d" strokeWidth="17" opacity="0.08" />
        <path d="M28 512 670 8" stroke="#f2d515" strokeWidth="1" opacity="0.28" />
        <path d="M58 548 706 40" stroke="#e4dfc9" strokeWidth="1" opacity="0.2" />
        <path d="M98 596 752 82" stroke="#f2d515" strokeWidth="1" opacity="0.18" />
        <path d="M138 636 802 116" stroke="#e4dfc9" strokeWidth="1" opacity="0.14" />
        <path d="M188 676 842 164" stroke="#f2d515" strokeWidth="1" opacity="0.12" />
      </g>
      <path d="m516 46 278-18 66 578-286 72Z" fill={`url(#${foldId})`} opacity="0.74" />
      <path d="m516 46 58 606" fill="none" stroke="#030302" strokeWidth="30" opacity="0.52" />
      <path d="m530 45 46 607" fill="none" stroke="#b6af8a" strokeWidth="1" opacity="0.24" />
      <path d="m574 40 46 604" fill="none" stroke="#f2d515" strokeWidth="1" opacity="0.16" />
      <path d="M96 76 794 28 860 606 174 720 42 454Z" fill="none" stroke={`url(#${edgeId})`} strokeWidth="2" />
      <path d="M98 78 790 32 854 602" fill="none" stroke="#f2d515" strokeWidth="8" opacity="0.04" />
      <path
        d="m42 454 52-378M174 720 96 76M860 606 794 28"
        fill="none"
        stroke="#ede7cb"
        strokeWidth="1"
        opacity="0.22"
      />
      <path d="m68 438 20-4M180 694l-4-20M826 98l-22 2" stroke="#f2d515" strokeWidth="3" opacity="0.6" />
    </svg>
  );
}
