# Rendered timed-frame evidence, not video

No recorder/ffmpeg was installed. These JPEGs came from actual browser-rendered states using the installed browser screenshot interface. No generated motion frames or repainted pixels are substituted.

Open [the contact sheet](index.html). [manifest.json](manifest.json) records actual elapsed timestamps, target sample times and observed stages. Tool-call latency means frames are not evenly spaced and the first returned frame may already be partway through an animation.

For each A/B/C:

- Intro/hero: nominal 10s capture window; actual entrance is 1100ms.
- Theme: nominal 2.5s observation; transition is 480ms.
- Save: nominal 8s observation; all six named stages captured.
- Draw: 12s paced manual sequence captures OPEN/SNAPSHOT/BLIND DRAW/VERIFY/DELIVER plus the finished packet state.
- Prize: nominal 4s sequence, masked/waiting/revealed.

A's first automatic Draw screenshot sequence stalled and jumped from OPEN to DELIVERED. It is kept as `a-draw` for honesty, not accepted as full-lifecycle motion coverage. `a-draw-paced`, `b-draw-paced`, `c-draw-paced` use actual stage buttons with paced timing; they are not claimed as a continuous video or a continuous automatic playback capture. A separate screenshot-free automatic observation in `../notes/autoplay-qa.json` successfully recorded all six successive states.

All three worlds' intro, theme, Save, paced Draw and prize frames were rendered. Representative frames and the scene contact sheets were visually inspected. Frame sequences cannot establish continuous-motion smoothness; manual live viewing remains necessary for final direction approval.

The Save and Draw timers are lab pacing only. They must never become fabricated production loading progress.
