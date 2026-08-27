# Canvas2D versus raw WebGL2

Installed in-app browser, loopback server, 5.6-second observation windows, last 300 requestAnimationFrame intervals. Desktop CSS viewport 1440×900; mobile emulation 390×844. Both themes. Raw samples: [results.json](results.json). Matching bounded image crops are beside this file.

| Theme / width | Renderer |   FPS | p95 frame interval | Mean JS paint submission |
| ------------- | -------- | ----: | -----------------: | -----------------------: |
| Dark / 1440   | Canvas   | 59.79 |             16.8ms |                  0.075ms |
| Dark / 1440   | WebGL    | 59.99 |             16.8ms |                  0.043ms |
| Dark / 390    | Canvas   | 59.99 |             16.8ms |                  0.081ms |
| Dark / 390    | WebGL    | 59.59 |             16.8ms |                  0.048ms |
| Light / 1440  | Canvas   | 59.99 |             16.8ms |                  0.076ms |
| Light / 1440  | WebGL    | 59.99 |             16.8ms |                  0.037ms |
| Light / 390   | Canvas   | 59.99 |             16.9ms |                  0.086ms |
| Light / 390   | WebGL    | 59.99 |             16.9ms |                  0.054ms |

Canvas has clearer physical folds in the inspected light and dark material crops. WebGL appears flatter, with less intentional separation. Neither showed a material cadence problem in this short host-browser run. **Choose Canvas**: WebGL did not clearly win visually.

## What these numbers do not mean

- FPS is rAF cadence, not an independently measured presented-frame rate.
- JS time surrounds draw submission; GPU work is asynchronous and is not included.
- Paint/composite/GPU utilization and GPU memory were not available through the installed browser interface.
- Reported JS heap ranges approximately 119.7–128.3MB across the browser session. Automation and previous navigations contribute; this is not attributable renderer memory.
- Effective DPR during recorded samples was approximately 1, despite host scaling behavior in captures. Code caps DPR at 2 desktop/1.25 mobile; this does not prove testing at those maxima.
- Responsive 390px is not a physical mobile device. No thermal, battery or low-end hardware conclusions.
- B/C use DOM/CSS; their HUD's JS cost excludes CSS animation/compositor work. A near-zero JS value is not a free GPU claim.
- Static mode disables the Canvas/WebGL renderer but leaves the CSS material fallback available. Use Pause or Reduce motion to stop ambient CSS too.

## Scheduling guarantees in the prototype

Renderer initialization is deferred until the canvas region intersects the viewport. ResizeObserver sets bounded resolution. Offscreen, reduced, explicit pause and hidden-page conditions stop the rAF loop. WebGL unavailability/context loss exposes CSS material. No pointer tracking or per-participant rendering work exists.

Offscreen and Pause were runtime-tested. Hidden-page behavior is implemented/source-inspected; opening a second in-app tab did not change the host's document.hidden, so that runtime condition remains unverified. OS preference handling is implemented; the explicit Reduce motion control was used for recorded QA.
