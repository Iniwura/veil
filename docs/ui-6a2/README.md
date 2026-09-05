# UNVEIL 6A.2 visual QA evidence

These deterministic browser frames record the 6A.2 landing and dark-only app
checks from the local Vite production preview.

- Hero fit: `after/landing-1920-dark.png`, `after/landing-1440-dark.png`,
  `after/landing-1366-dark.png`, and `after/landing-390-dark.png`.
- App dark lock: `after/app-dark.png`, `after/save-dark.png`, and
  `after/draw-dark.png`.
- Motion sequence: `motion/hero-settled-10s.png`,
  `motion/hero-interaction.png`, `motion/privacy-phase-1.png` through
  `motion/privacy-phase-4.png`, `motion/live-proof.png`,
  `motion/final-cta.png`, `motion/landing-full-scroll.png`, and
  `motion/mobile-hero.png` plus `motion/mobile-scroll.png`.
- Mobile app: `motion/app-mobile-dark.png`.

The Browser QA surface exposes screenshots rather than video recording, so
the motion checks are represented by named frames at the corresponding scroll
and interaction checkpoints. The local development-only motion harness was
also checked at `/app/vault?motionDebug=1`; the production preview rendered
the ordinary Save page for the same URL.
