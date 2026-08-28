type EncryptedMatterArtworkProps = {
  className?: string;
  idPrefix?: string;
  variant?: "hero" | "privacy" | "cta";
};

/** A marketing-only abstraction for the sealed/private side of UNVEIL. */
export function EncryptedMatterArtwork({
  className = "",
  idPrefix = "matter",
  variant = "hero",
}: EncryptedMatterArtworkProps) {
  const baseId = `${idPrefix}-base`;
  const foldId = `${idPrefix}-fold`;
  const edgeId = `${idPrefix}-edge`;
  const isCta = variant === "cta";
  return (
    <svg
      className={`encrypted-matter-artwork encrypted-matter-artwork--${variant} ${className}`}
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
      </defs>
      {isCta ? (
        <>
          <path d="M180 212 C286 148 544 120 760 188 L708 612 C512 664 316 642 154 548Z" fill="#000" opacity="0.62" />
          <path d="M136 178 C294 96 572 114 786 210 L688 592 C492 642 286 604 112 486Z" fill={`url(#${baseId})`} />
          <path
            d="M218 156 C370 112 594 140 742 220 L676 514 C508 554 342 526 188 438Z"
            fill={`url(#${foldId})`}
            opacity="0.85"
          />
          <path
            d="M138 442 C310 510 506 512 690 448 L676 592 C492 642 286 604 112 486Z"
            fill="#080806"
            opacity="0.72"
          />
          <path d="M164 462 C328 530 506 530 666 478" fill="none" stroke={`url(#${edgeId})`} strokeWidth="2" />
          <path d="M216 158 C370 112 594 140 742 220" fill="none" stroke="#f2d515" strokeWidth="2" opacity="0.42" />
          <path d="M286 530 C410 550 534 540 636 506" fill="none" stroke="#e4dfc9" strokeWidth="1" opacity="0.24" />
        </>
      ) : (
        <>
          <path
            d="M76 208 C214 106 554 84 820 178 L866 556 C674 696 316 752 74 578 L38 382Z"
            fill="#000"
            opacity="0.64"
          />
          <path d="M84 170 C244 74 572 72 836 190 L802 520 C630 670 328 704 78 556 L38 360Z" fill={`url(#${baseId})`} />
          <path
            d="M162 132 C312 74 590 96 790 198 L754 454 C600 580 376 612 152 500 L104 342Z"
            fill={`url(#${foldId})`}
            opacity="0.7"
          />
          <path
            d="M106 362 C304 490 540 500 770 388 L754 454 C600 580 376 612 152 500Z"
            fill="#060605"
            opacity="0.76"
          />
          <path d="M112 556 C330 694 622 646 802 520" fill="none" stroke={`url(#${edgeId})`} strokeWidth="2" />
          <path d="M208 124 C362 84 594 114 786 208" fill="none" stroke="#f2d515" strokeWidth="2" opacity="0.44" />
          <path d="M136 380 C318 492 534 500 738 410" fill="none" stroke="#e4dfc9" strokeWidth="1" opacity="0.2" />
        </>
      )}
    </svg>
  );
}
