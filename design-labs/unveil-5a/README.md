# VEIL ENGINE / UNVEIL 5A

An isolated visual and motion laboratory. **Not production UI. No protocol data, wallet, signatures, or transactions.**

Created on `design/unveil-5a-motion-lab` from production commit `919f7cd89b2b93a0959758ca3c69301e1a827e08`. Everything added lives under this folder. The production branch, frontend, contracts, deployments, and dependency files are unchanged.

## Open locally

From the repository root, with an existing Node installation:

```sh
node design-labs/unveil-5a/server.mjs 5190
```

Open [the laboratory](http://127.0.0.1:5190/). This server binds to loopback, serves only the lab directory, and forbids external connections with CSP. No installation or build step is needed. Stop with Ctrl+C.

- [96 scene presets](http://127.0.0.1:5190/qa.html)
- [Rendered scene evidence](http://127.0.0.1:5190/screenshots/index.html)
- [Rendered motion sequences](http://127.0.0.1:5190/recordings/index.html)
- [System studies](http://127.0.0.1:5190/index.html?scene=studies&intro=off)
- [Private reveal study](http://127.0.0.1:5190/index.html?scene=private&intro=off)

Choose A/B/C, dark/light, scene, and motion controls in the lab toolbar. A additionally offers Canvas2D, raw WebGL2, and static material. The desktop Type selector and System studies compare three local/system stacks. `?reduce=1` forces the reduced treatment; the actual OS preference is also honored. `?intro=off` suppresses the entrance for repeatable inspection.

## Recommendation

**Advance A / Canvas2D for a subsequent, separately approved design iteration.** Its directional material and narrow proof edge best connect the private object, local encryption, and public Draw lifecycle. Raw WebGL did not clearly improve the image. C is the stronger alternative for a more architectural brand. Reject B as the lead direction: its optical vault still risks generic sci-fi.

This is not a claim of 10/10 production readiness. See the [hostile review and 17-category scores](notes/review.md). The main remaining design debts are small telemetry, mobile vertical density, and insufficient differentiation between all three worlds' shared Save/reveal composition.

## What is built

| Brief items                | Implementation                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–3: base, branch, tooling | Exact base above; separate worktree/branch; Node 22.23.1, npm 10.9.8, Git and installed in-app browser. No ffmpeg, standalone Playwright/Puppeteer, Canvas package, WebGL helper, or additional dependency used. |
| 4: A                       | Six broad Canvas material folds and a raw GLSL alternative; vertical mechanical seam; asymmetric private instrument.                                                                                             |
| 5: B                       | Horizontal vault lip, matte optical layers, tiny diffraction accents near the proof boundary; no full-screen rainbow.                                                                                            |
| 6: C                       | Offset slabs, stepped silhouette, DOM/SVG/clip-path and named View Transitions. No shader.                                                                                                                       |
| 7: marks                   | Offset bookends, horizontal threshold, stepped joint; 16/24/34/64/128px specimens; dark/light/mono/animated SVGs under `concepts/`.                                                                              |
| 8–10: loading and engines  | Intro/public-read/user-operation classes; lazy Canvas/WebGL init, static fallback; [measured comparison](performance/README.md).                                                                                 |
| 11–14: system              | Three system typography treatments; 4px rhythm; three primary curves; 15 microinteractions in System studies. [Tokens](notes/design-system.md).                                                                  |
| 15–17: continuity          | IntersectionObserver proof rail, scroll-linked physical shutter, 480ms theme seam, named route aperture with fallback.                                                                                           |
| 18–19: Save                | Amount-first input, masked position, six explicit simulated stages, manual stepping, 8s replay and interruption state. No invented percentages or real encryption.                                               |
| 20: position reveal        | Labeled demo 128 TEST only in the reveal study; waiting seam, 16px separation, one outline stroke; veiling removes plaintext from DOM immediately.                                                               |
| 21: Draw                   | OPEN → SNAPSHOT → BLIND DRAW → VERIFY → DELIVER; equal-size signals; narrowed computation seam; proof stroke; encrypted delivery packet without plaintext.                                                       |
| 22: SKIPPED                | OPEN complete; remaining steps bypassed; one conceptual public participant; no encrypted winner.                                                                                                                 |
| 23: CANCELLED              | First four steps complete; DELIVER inactive; ZERO WINNER / NO DELIVERY.                                                                                                                                          |
| 24: COMPLETE               | Unknown origin: OPEN complete, other four inactive. No inferred intermediate history.                                                                                                                            |
| 25: prize reveal           | Labeled demo 4 TEST SHARES; no confetti; immediate plaintext removal on veil. No winning wallet is invented.                                                                                                     |
| 26–28: visual evidence     | A/B/C × dark/light × 1440×900/390×844 × eight requested scenes = 96 presets. All rendered and checked for horizontal overflow; 12 contact sheets reviewed.                                                       |
| 29: reduced                | Twelve additional light/mobile treatments: landing, encryption, BlindDraw, prize in each world. HUD reports REDUCED; inspected animation durations 0s; state information remains.                                |
| 30: performance            | Eight 5.6s A renderer samples, approximately 60fps, p95 cadence 16.8–16.9ms. Limits below.                                                                                                                       |
| 31: files                  | `screenshots/`, `recordings/`, `performance/`, and machine-readable QA under `notes/`.                                                                                                                           |
| 32–34: review              | [Hostile review, scores, recommendation](notes/review.md).                                                                                                                                                       |
| 35–39: Git handoff         | Exact committed SHA, push output, remote SHA/equality and final clean status are reported in the delivery message, after commit/push. A commit cannot embed its own SHA.                                         |

## Semantics and safety

This lab simulates visual states, not protocol operations. Demo amounts appear only in editable input or explicitly labeled reveal studies. The hero contains masked values and conceptual public round/count data only. The Draw does not select a winner or depict participant probabilities. The module graph imports only this lab's modules. The local server's `connect-src 'none'` prevents protocol/RPC connections.

| State                    | OPEN     | SNAPSHOT | BLIND DRAW | VERIFY   | DELIVER  |
| ------------------------ | -------- | -------- | ---------- | -------- | -------- |
| OPEN                     | current  | future   | future     | future   | future   |
| SNAPSHOT                 | complete | current  | future     | future   | future   |
| BLIND DRAW               | complete | complete | current    | future   | future   |
| VERIFY                   | complete | complete | complete   | current  | future   |
| DELIVER                  | complete | complete | complete   | complete | current  |
| DELIVERED                | complete | complete | complete   | complete | complete |
| SKIPPED                  | complete | bypassed | bypassed   | bypassed | bypassed |
| CANCELLED                | complete | complete | complete   | complete | inactive |
| COMPLETE, unknown origin | complete | inactive | inactive   | inactive | inactive |

## Validation

Run the isolated tests without installing anything:

```sh
node --test design-labs/unveil-5a/js/state.test.mjs
node --check design-labs/unveil-5a/js/lab.mjs
node --check design-labs/unveil-5a/js/engine.mjs
git diff --check
```

21 Node tests cover the complete lifecycle table, invalid-state failure, named encryption stages, input validation/escaping, import isolation, and banned repeated-grid backgrounds. Browser QA separately exercised all eight stage controls in all three worlds, the six automatic lifecycle states, four route transitions, both reveal/veil paths, pause/static/offscreen behavior, scroll rail, repeat entrance, logo sizes and reduced treatments. Details are JSON files in `notes/`.

Root protocol tests and production frontend builds are not claimed as rerun: neither production source nor its dependency graph was changed.

## Evidence limitations — read before judging captures

The installed browser's wide/full-page screenshot stitching repeats regions at host display scaling. Evidence therefore uses bounded, unaltered JPEG tiles and detail crops; these are **not pristine full-viewport screenshots**. The JSON records the intended CSS viewport and actual DOM dimensions. Contact sheets are navigation aids, not substitutes for opening the lab. Font sizes in a reduced contact sheet cannot be assessed accurately.

No screen recorder was available. Motion evidence consists of actual rendered timed frames with observed timestamps, not video. The first A automatic Draw capture stalled and missed stages; it is retained as failed capture evidence, then supplemented by paced manual stage captures for all three worlds and a separate successful automatic DOM observation. See [motion evidence notes](recordings/README.md).

Frame timing is not GPU timing. The browser reports session-level heap, not isolated renderer memory; no GPU utilization, paint/composite profile, physical-phone testing, or full assistive-technology audit was available. The browser host did not set `document.hidden` when a second lab tab opened, so hidden-page pausing is implemented and source-inspected, not claimed as a successful runtime visibility test.

## Folder map

- `index.html`, `styles/lab.css`, `js/`: self-contained prototype and tests.
- `concepts/a|b|c/`: direction rationale and exportable mark studies.
- `qa.html`: explicit scene matrix.
- `screenshots/`: 96-preset tiles/details, 12 boards and supplementary QA.
- `recordings/`: timed rendered sequences and contact sheet.
- `performance/`: renderer samples and limitations.
- `notes/`: design system, hostile review and browser QA data.
- `build-evidence.mjs`: rebuilds static HTML galleries from capture manifests; does not create or repaint screenshots.
