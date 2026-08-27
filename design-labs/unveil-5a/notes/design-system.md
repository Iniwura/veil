# One boundary, three material worlds

## Primitive

Two asymmetric solid forms approach without becoming a mirrored X. Their negative space is the seam. Private material stays closed; only public evidence crosses it. The primitive repeats in marks, nav, the hero instrument, scroll rail, input aperture, encryption stages, verification, reveal and route changes.

A is vertical and layered. B is horizontal and optical. C is stepped and architectural. They share truthful content and controls, not just three color palettes.

## Typography

No font downloads, package installs or external requests. The installed system decides the exact face.

| Study      | Stack                                   | Judgment                                                             |
| ---------- | --------------------------------------- | -------------------------------------------------------------------- |
| Humanist   | Segoe UI, Arial, sans-serif             | Recommended: clear amounts, approachable prose, least performative.  |
| Editorial  | Georgia, Times New Roman, serif         | Strong landing contrast; less coherent with compact proof telemetry. |
| Industrial | Arial Narrow, Impact, Arial, sans-serif | Useful stress test; too forceful for the everyday financial surface. |

Desktop display is `clamp(56px,6.7vw,100px)`, typically 96.48px at 1440; mobile 56px. Main display tracking is −.035em, mobile −.03em. Body uses the humanist stack; section headings use sentence case. Uppercase primarily identifies states, stages, telemetry and lab warnings. Numeric amounts, round/count values and the countdown use tabular numerics.

Known debt: 8–11px telemetry still asks too much of users on a small screen. It is subordinate, but it should become larger in a production iteration rather than be defended as premium density.

## Space

4, 8, 12, 16, 24, 32, 48, 64, 96px rhythm. Desktop gutters `clamp(24px,5.5vw,96px)`; mobile 24px. Optical exceptions: 1–3px proof strokes, 5–7px compressed marks, 6px participant rails, type-driven intrinsic widths, proportional clip paths and responsive geometry. They encode the seam rather than form a second spacing scale.

## Motion

| Token       | Duration | Purpose                                                |
| ----------- | -------- | ------------------------------------------------------ |
| Press       | 140ms    | Small compression                                      |
| Hover/focus | 180ms    | Arrow, focus or seam response                          |
| Control     | 240ms    | Tabs, icon, numbers                                    |
| Panel       | 320ms    | Compact state feedback                                 |
| Route/theme | 480ms    | Close → swap → reopen; swap at 220ms, cleanup at 500ms |
| Reveal      | 680ms    | Waiting/reveal and one proof stroke                    |
| Cinema      | 1100ms   | First-session seam introduction                        |
| Returning   | 240ms    | No repeat long intro                                   |
| Logo        | 450ms    | OPEN → ALIGN → SEAL → PROOF                            |
| Ambient     | 24s      | Slow material drift                                    |

Only three primary curves: inward `cubic-bezier(.55,0,.8,.3)`, outward `cubic-bezier(.16,1,.3,1)`, machine `cubic-bezier(.65,0,.35,1)`. Continuous cipher travel and scroll-following interpolation use linear time, not another expressive curve.

The hero exists underneath the intro. Its masked value never cycles through financial plaintext. After the 1100ms sequence the object settles; only environmental/status ambience continues. Reduced motion removes entrance and transition overlays and sets animation/transition duration to zero.

Context: Home material intensity 13%; attention 15%; encrypt 32% with time advancing at 8% speed. CSS layer opacity further restrains Home/attention. Focus converges a material layer toward Save. No pointer-follow effect. Offscreen observer, page visibility handler and Pause cancel the animation loop. Heavy renderer initialization waits for visibility. Max DPR 2 desktop, 1.25 mobile.

## Microinteraction inventory

1. Nav: active seam grows from the selected boundary.
2. Button hover: a thin sweep, not a glow.
3. Press: 98% compression.
4. Arrow: 3px outward travel.
5. Public status: low-frequency opacity pulse; no flashing.
6. Number: tabular roll from Round 02 to 03, explicitly conceptual.
7. Copy: copy the lab label only, with confirmation/failure text.
8. Tooltip: pointer and keyboard focus reveal explanatory text.
9. Input: two focus rails form an aperture.
10. Success: single check stroke.
11. Error: interruption message, not shake spectacle.
12. Mobile nav: local active seam/glide.
13. Countdown: 00:59 → 00:58 demonstration.
14. Proof: one verified underline.
15. Theme: asymmetric icon changes orientation with the seam transition.

Three loader classes remain separate: short first-session intro; tiny indeterminate public-read seam; contextual operation pipeline with named stages. No percentage or generic spinner is used as primary feedback.

## Interaction notes

Save's 8s replay is explicitly simulated. Manual controls allow inspecting each stage. Interrupted simulations never imply a transaction was sent. A real future integration must drive stages from actual protocol state, not reuse these timers.

Reveal values are demo-only. Closing a reveal reconstructs the masked DOM without the plaintext node; it does not merely hide plaintext with opacity. The waiting state is not a wallet integration.

Draw's five stage states remain visible in text and accessible labels. Equal participant signals are 6×16px; tiny subpixel differences in recorded bounding boxes result from transforms, not weights. SKIPPED/CANCELLED/unknown COMPLETE are separate presentations and tested.

View Transitions apply to the named stage only, not a root crossfade. Unsupported browsers still get the seam and simple stage entrance. Theme change updates theme tokens without re-rendering/restarting the hero choreography.

## Accessibility scope

Native buttons/selects, labeled input, skip link, focus-visible outline, stage labels and status messaging are included. Mobile landing button/select targets were measured; the one undersized Pause width was corrected to a minimum 44px. Performance output is excluded from live announcements.

Measured base-background text contrast: primary 12.46–16.72:1, muted 4.88–8.41:1, signal 4.73–11.43:1 across all six world/theme combinations. These are base-token calculations, **not a complete contrast audit over every moving layer**. Fine proof strokes are decorative; text states carry meaning.

Remaining accessibility work before production: assistive-technology testing, comprehensive focus restoration after inner-stage replacement, 200% zoom, a full target/contrast audit on every scene, and larger mobile telemetry. The lab must not be presented as WCAG-certified.
