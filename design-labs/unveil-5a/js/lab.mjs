import { STEPS, PIPELINE, DIRECTIONS, DRAW_COPY, lifecycle, escapeHtml, amountLabel } from "./state.mjs";
import { MaterialEngine } from "./engine.mjs";
const root = document.documentElement,
  stage = document.querySelector("#stage"),
  params = new URLSearchParams(location.search);
const reducedPreference = matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  direction: DIRECTIONS[params.get("direction")] ? params.get("direction") : "a",
  theme: params.get("theme") === "light" ? "light" : "dark",
  scene: "landing",
  engine: ["canvas", "webgl", "static"].includes(params.get("engine")) ? params.get("engine") : "canvas",
  type: "humanist",
  paused: false,
  reduced: reducedPreference.matches || params.get("reduce") === "1",
  draw: "OPEN",
  pipeline: -1,
  amount: "100",
  mode: "Deposit",
  revealed: false,
  waiting: false,
  error: false,
};
const allowedScenes = [...document.querySelector("#scene").options].map((o) => o.value);
if (allowedScenes.includes(params.get("scene"))) state.scene = params.get("scene");
const material = new MaterialEngine(document.querySelector(".environment"), document.querySelector("#perf"));
let timers = [],
  transitioning = false,
  scrollFrame = 0;
let sceneObserver;
function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}
function cancelSequence() {
  timers.forEach(clearTimeout);
  timers = [];
}
function mark(which = state.direction, size = 34) {
  const forms = {
    a: ["M4 3H17V31H4Z", "M20 7H30V27H20Z", "M18.5 5V29"],
    b: ["M3 6H30V17H3Z", "M7 20H27V30H7Z", "M5 18.5H29"],
    c: ["M3 3H15V24H3Z", "M18 10H30V31H18Z", "M16.5 6V28"],
  }[which];
  return `<svg class="seam-mark" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 34 34" aria-hidden="true"><path class="mark-left" d="${forms[0]}"/><path class="mark-right" d="${forms[1]}"/><path class="mark-proof" d="${forms[2]}"/></svg>`;
}
function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
function sync() {
  root.dataset.direction = state.direction;
  root.dataset.theme = state.theme;
  root.dataset.type = state.type;
  root.dataset.reduced = String(state.reduced);
  root.dataset.paused = String(state.paused);
  root.dataset.scene = state.scene;
  document.querySelectorAll("[data-direction]").forEach((el) => {
    if (el.tagName === "BUTTON") el.setAttribute("aria-pressed", String(el.dataset.direction === state.direction));
  });
  document.querySelector("#scene").value = state.scene;
  document.querySelector("#engine").value = state.engine;
  document.querySelector("#theme span:last-child").textContent = state.theme === "dark" ? "Light" : "Dark";
  document.querySelector("#reduce").setAttribute("aria-pressed", String(state.reduced));
  document.querySelector("#pause").setAttribute("aria-pressed", String(state.paused));
  document.querySelector("#world-name").textContent = DIRECTIONS[state.direction].name;
  document.querySelector("#brand-mark").innerHTML = mark();
  document.querySelector("#intro-mark").innerHTML = mark(state.direction, 64);
  document.querySelector(".engine-select").hidden = state.direction !== "a";
  document
    .querySelectorAll("[data-route]")
    .forEach((el) =>
      el.classList.toggle(
        "active",
        el.dataset.route === state.scene || (el.dataset.route === "draw-open" && state.scene.startsWith("draw")),
      ),
    );
  configureEngine();
}
function configureEngine(activity) {
  material.configure({
    mode: state.engine,
    direction: state.direction,
    light: state.theme === "light",
    paused: state.paused,
    reduced: state.reduced,
    activity:
      activity ||
      (state.waiting || state.pipeline === 0
        ? "attention"
        : state.pipeline === 2
          ? "encrypt"
          : state.scene === "home"
            ? "home"
            : state.scene.startsWith("draw")
              ? "draw"
              : "landing"),
  });
}
function instrument() {
  return `<div class="instrument" aria-label="Conceptual sealed position, no wallet data"><div class="instrument-private"><span class="eyebrow">Private position</span><div><div class="principal" aria-label="Masked encrypted principal">••••••<small>TEST</small></div><p class="principal-label">Encrypted principal</p></div><div class="instrument-fields"><div><span>DRAW WEIGHT</span><strong>SEALED</strong></div><div><span>PRIVATE SHARES</span><strong aria-label="Masked private shares">••••••</strong></div></div></div><div class="instrument-seam" aria-hidden="true"></div><div class="proof-edge"><span class="public-stamp">PUBLIC EDGE<br>CONCEPT ONLY</span><div><span>ROUND</span><strong>02</strong></div><div><strong class="status">READY</strong></div><div><strong>03</strong><span>PARTICIPANTS</span></div></div></div>`;
}
function privacyBoundary() {
  return `<div class="privacy-boundary"><div class="public-record"><span class="eyebrow">Exposed / public proof</span><div class="record-row"><span>Round</span><strong>02 · CONCEPT</strong></div><div class="record-row"><span>State</span><strong>READY</strong></div><div class="record-row"><span>Participants</span><strong>03</strong></div><div class="record-row"><span>Winner / verification</span><strong>NOT SIMULATED</strong></div></div><div class="private-record" aria-label="Financial fields physically concealed"><div class="record-row"><span>Principal</span><strong>••••••</strong></div><div class="record-row"><span>Weight</span><strong>••••••</strong></div><div class="record-row"><span>Prize</span><strong>••••••</strong></div><div class="record-row"><span>Shares</span><strong>••••••</strong></div><div class="privacy-shutter">FINANCIAL STATE / CONCEALED</div></div></div><div class="privacy-key"><span>Verification remains legible.</span><span>Occlusion, not disappearance.</span></div>`;
}
function landing() {
  return `<section class="scene hero" id="position"><div class="hero-copy"><span class="eyebrow">${DIRECTIONS[state.direction].subtitle}</span><h1>${DIRECTIONS[state.direction].headline}</h1><p>A private position. A public proof. Save without making your financial life a public record.</p><div class="hero-actions"><button class="cta" data-route="save">Explore Save <span class="arrow">↗</span></button><a class="text-action" href="#privacy">What stays private <span>↓</span></a></div><div class="hero-caption">The boundary is the product.</div></div>${instrument()}</section><section class="chapter" id="privacy"><div class="chapter-heading"><h2>Proof can be public.<br>Your position cannot.</h2><p>Scroll across the boundary. The public record remains sharp while financial fields stay behind material.</p></div>${privacyBoundary()}</section><section class="chapter" id="proof"><div class="chapter-heading"><h2>A draw you can verify.<br>Not a balance you can inspect.</h2><p>The visual engine exposes stages, never weights. Every public participant signal has the same size.</p></div><div class="proof-summary"><div><strong>02</strong><span>Concept round</span></div><div><strong>03</strong><span>Equal public signals</span></div><div><strong>0</strong><span>Private values exposed</span></div></div><button class="text-action" data-route="draw-open">Inspect the draw engine <span class="arrow">↗</span></button></section><section class="chapter enter-chapter" id="enter"><h2>Cross the boundary.<br>Keep your position.</h2><button class="cta" data-route="home">Enter the prototype <span class="arrow">↗</span></button></section>`;
}
function privacy() {
  return `<section class="scene privacy-scene"><div class="privacy-pin"><div class="chapter-heading"><span class="eyebrow">The privacy boundary</span><h1>Visible proof.<br>Concealed value.</h1><p>Public facts stay sharp. Financial state is covered by a physical shutter, not faded into ambiguity.</p></div>${privacyBoundary()}<p class="scroll-cue">Scroll to close the material over the financial fields. No financial plaintext is present in this scene.</p></div></section>`;
}
function home() {
  return `<section class="scene hero"><div class="hero-copy"><span class="eyebrow">A quieter environment / 13% intensity</span><h1>Your place<br>behind the seam.</h1><p>The everyday surface is deliberately calm. Deposit, inspect a public draw, or rehearse an authorized reveal.</p><div class="hero-actions"><button class="cta" data-route="save">Save privately <span class="arrow">↗</span></button><button class="text-action" data-private-reveal>Unveil demo position</button></div><p class="hero-caption">No account or wallet is connected.</p></div>${instrument()}</section>`;
}
function pipeline() {
  return `<div class="operation" aria-live="polite"><div class="operation-heading"><span class="seam-loader" aria-hidden="true"></span>${state.pipeline === 5 ? "POSITION SEALED" : state.pipeline >= 0 ? "SEALING YOUR POSITION" : "LOCAL ENCRYPTION PIPELINE"}</div><ol class="pipeline">${PIPELINE.map((s, i) => `<li class="${i < state.pipeline ? "complete" : i === state.pipeline ? "current" : "future"}" ${i === state.pipeline ? 'aria-current="step"' : ""}>${s}</li>`).join("")}</ol><p class="op-note">${state.pipeline === 0 ? "Demo authorization attention. No wallet signature is requested." : state.pipeline === 2 ? "The entered amount is unchanged. Only its visual fragments move." : state.pipeline === 5 ? "Simulation complete. Private balance remains masked." : "SIMULATED STAGES · manual steps or paced replay · no percentage invented"}</p></div>`;
}
function save() {
  return `<section class="scene save-scene ${state.pipeline === 2 ? "encrypting" : ""}"><div class="save-copy"><span class="eyebrow">Save privately</span><h1>Seal a position.</h1><div class="mode-tabs" aria-label="Conceptual operation"><button data-mode="Deposit" class="${state.mode === "Deposit" ? "active" : ""}">Deposit</button><button data-mode="Withdraw" class="${state.mode === "Withdraw" ? "active" : ""}">Withdraw</button></div><label class="amount-wrap"><input id="amount" aria-label="Demo entered amount in TEST" inputmode="numeric" value="${escapeHtml(state.amount)}" maxlength="9"><span>TEST</span></label><p>${state.mode === "Deposit" ? "Your entered amount will be encrypted locally before submission to the pool." : "A withdrawal request remains confidential. This lab does not model liquidity or settlement."}</p><button class="cta" id="seal">${state.mode === "Deposit" ? "SEAL" : "REQUEST"} ${escapeHtml(state.amount)} TEST <span class="arrow">↗</span></button><p class="save-meta">DEMO INPUT, NOT A BALANCE · NO PROTOCOL DATA</p>${state.error ? '<p class="operation-error" role="alert">Simulation interrupted. No transaction was submitted. Edit the amount and retry.</p>' : ""}${pipeline()}<div class="demo-controls"><button id="next-stage">Next demo stage</button><button id="play-save">Replay 8s pipeline</button><button id="fail-save">Simulate interruption</button><button id="reset-save">Reset</button></div></div><div>${instrument()}<div class="reveal-actions"><button class="text-action" data-private-reveal>Unveil demo position <span>→</span></button></div></div></section>`;
}
function drawEngine() {
  const s = state.draw;
  const count = s === "SKIPPED" ? 1 : 3;
  return `<div class="draw-engine" data-state="${s}" aria-label="${s} encrypted draw visualization; no weight information"><span class="engine-status">SEALED INTERIOR / ${s}</span><div class="cipher-lane" aria-hidden="true">⌁ ⁝ ╱ ∣ ⌁ ┃ ╲ ⁝ ∣ ╱ ⌁ ╲ ⁝ ┃ ⌁ ∣ ╱ ╲ ⁝ ┃ ⌁ ∣ ╲ ⁝ ╱ ┃ ⌁ ∣ ╲ ⁝ ╱</div><div class="engine-plate"></div><div class="engine-plate right"></div><div class="engine-seam"></div><div class="participants" aria-label="${count} equal-size conceptual public participant signals">${Array.from({ length: count }, () => '<i aria-hidden="true"></i>').join("")}</div><div class="proof-stroke"></div><svg class="verification-glyph" viewBox="0 0 36 36" aria-hidden="true"><path d="M5 18L14 27L31 9" fill="none" stroke="#e4edde" stroke-width="2"/></svg><div class="packet" aria-hidden="true"></div><span class="engine-caption">${s === "CANCELLED" ? "ZERO WINNER / NO DELIVERY" : s === "SKIPPED" ? "NO ENCRYPTED WINNER EXISTS" : s === "COMPLETE" ? "UNKNOWN ORIGIN / NO HISTORY INFERRED" : s === "DELIVERED" ? "CONFIDENTIAL PRIZE DELIVERED" : "COMPUTATION ≠ EXPOSURE"}</span></div>`;
}
function draw() {
  const copy = DRAW_COPY[state.draw];
  return `<section class="scene draw-scene"><div class="scene-title"><div><span class="eyebrow">Live draw engine / conceptual round 02</span><h1>${copy[0]}</h1></div><p>${copy[1]}</p></div><ol class="draw-rail" aria-label="Conceptual draw lifecycle">${lifecycle(
    state.draw,
  )
    .map(
      (s, i) =>
        `<li class="${s}" ${s === "current" ? 'aria-current="step"' : ""} aria-label="${STEPS[i]} ${s}">${STEPS[i]}</li>`,
    )
    .join(
      "",
    )}</ol><div class="draw-layout">${drawEngine()}<aside class="public-action"><div><span class="eyebrow">Next public action</span><h3>${copy[2]}</h3><p>Anyone can advance a valid round. Private values remain encrypted.</p></div><button class="cta" id="advance" ${["SKIPPED", "CANCELLED", "COMPLETE"].includes(state.draw) ? "disabled" : ""}>${state.draw === "DELIVERED" ? "REPLAY" : "ADVANCE DEMO"} <span>→</span></button></aside></div><p class="draw-stage-copy">SIMULATION ONLY · no winner, odds, prize amount, or wallet is invented. No private-weight visualization.</p><div class="demo-controls">${[...STEPS, "SKIPPED", "CANCELLED", "COMPLETE"].map((s) => `<button data-draw="${s}" class="${state.draw === s ? "active" : ""}">${s}</button>`).join("")}<button id="play-draw">Replay 12s lifecycle</button><button data-route="prize">Prize reveal study →</button></div></section>`;
}
function reveal(privatePosition = false) {
  const kind = privatePosition ? "position" : "prize";
  return `<section class="scene reveal-scene"><div class="scene-title"><div><span class="eyebrow">${privatePosition ? "Private position" : "Confidential prize"} / reveal study</span><h1>${privatePosition ? "For your eyes.\nOnly." : "The reward is private, too."}</h1></div><p>${privatePosition ? "A wallet-authorized opening, rehearsed without any wallet connection." : "Only the winning wallet can unveil in the product. This is an explicitly labeled conceptual reveal."}</p></div><div class="reveal-object ${state.revealed ? "revealed" : ""} ${state.waiting ? "waiting" : ""}" aria-live="polite">${state.revealed ? `<div class="reveal-value">${privatePosition ? "128" : "4"}<small>${privatePosition ? "TEST" : "TEST SHARES"}</small></div><span class="demo-value-label">DEMO VALUE · NO PROTOCOL DATA</span>` : `<div class="reveal-mask" aria-label="Masked ${kind}">••••••</div><span class="demo-value-label">${state.waiting ? "DEMO AUTHORIZATION / WAITING" : privatePosition ? "TEST / SEALED" : "TEST SHARES / SEALED"}</span>`}</div><div class="reveal-actions"><button class="cta" id="reveal" data-kind="${kind}">${state.revealed ? "VEIL AGAIN" : state.waiting ? "DEMO AUTHORIZATION…" : `UNVEIL ${kind.toUpperCase()}`} <span>→</span></button><p>Plane separation: 16px. A single proof stroke. Private plaintext is removed immediately when veiled.</p></div><div class="demo-controls"><button id="play-prize" data-kind="${kind}">Replay 4s reveal</button><button data-route="home">Back to Home →</button></div></section>`;
}
function studies() {
  const micro = [
    [
      "01 / Nav active seam",
      '<div class="routes"><button class="active">Position</button><button>Proof</button></div>',
    ],
    ["02 / Hover seam sweep", '<button class="cta">Inspect boundary <span>→</span></button>'],
    ["03 / Press compression", '<button class="cta">Press and hold</button>'],
    ["04 / External arrow", '<a href="./qa.html">Evidence index <span class="arrow">↗</span></a>'],
    ["05 / Public status", '<span class="status">PUBLIC READ</span>'],
    ["06 / Tabular number roll", '<button data-micro="number" class="num">Round 02</button>'],
    ["07 / Copy confirmation", '<button data-micro="copy">Copy lab label</button>'],
    [
      "08 / Tooltip reveal",
      '<div class="tooltip-wrap"><button aria-describedby="tip">Why concealed?</button><span class="tooltip" role="tooltip" id="tip">Proof is public. Financial values are not.</span></div>',
    ],
    [
      "09 / Input aperture",
      '<label class="amount-wrap"><input aria-label="Focus aperture study" placeholder="Focus the seam"></label>',
    ],
    ["10 / Success stroke", '<button data-micro="success">Draw success stroke</button>'],
    ["11 / Error interruption", '<button data-micro="error">Interrupt simulation</button>'],
    [
      "12 / Mobile nav glide",
      '<div class="mobile-nav-demo"><button class="active" data-micro="nav">Home</button><button data-micro="nav">Save</button><button data-micro="nav">Draw</button></div>',
    ],
    ["13 / Countdown digit", '<button data-micro="countdown" class="num">00:59</button>'],
    ["14 / Proof underline", '<button data-micro="proof">Verified proof</button>'],
    [
      "15 / Theme icon morph",
      '<button data-micro="theme" aria-label="Toggle theme study"><span class="theme-icon"></span></button>',
    ],
  ];
  return `<section class="scene studies"><div class="study-section"><span class="eyebrow">Seam mark / three candidates</span><h1>Access, in negative space.</h1><p class="muted">Asymmetric solid forms. No eye, lock, butterfly, or mirrored X. OPEN → ALIGN → SEAL → PROOF in 450ms.</p>${["a", "b", "c"].map((d, i) => `<h3>${["Offset bookends", "Horizontal threshold", "Stepped joint"][i]}</h3><div class="logo-specimens">${[16, 24, 34, 64, 128].map((s) => `<figure>${mark(d, s)}<figcaption>${s}px</figcaption></figure>`).join("")}</div><div class="mark-demo">${mark(d, 34)} Dark ${mark(d, 64)}</div><div class="mark-demo light">${mark(d, 34)} Light ${mark(d, 64)}</div><div class="mark-demo mono">${mark(d, 34)} Monochrome ${mark(d, 64)}</div>`).join("")}<button class="cta" id="animate-marks">Animate all marks <span>→</span></button></div><div class="study-section"><h2>Three voices. No downloaded fonts.</h2>${[
    ["Humanist", "Segoe UI, Arial, sans-serif"],
    ["Editorial", "Georgia, Times New Roman, serif"],
    ["Industrial", "Arial Narrow, Impact, Arial, sans-serif"],
  ]
    .map(
      ([name, font]) =>
        `<div class="type-specimen"><small>${name} / system stack / 0 font requests / tracking −.03em</small><p style="font-family:${font}">Private by nature. Public by proof.</p></div>`,
    )
    .join(
      "",
    )}</div><div class="study-section"><h2>Every gesture belongs to the seam.</h2><div class="micro-library">${micro.map(([name, html]) => `<div class="micro-tile"><span>${name}</span>${html}</div>`).join("")}</div></div><div class="study-section"><h2>Three loads. Three meanings.</h2><div class="micro-library"><div class="micro-tile"><span>First session / 1100ms</span>${mark()}<button id="study-intro">Rehearse introduction</button></div><div class="micro-tile"><span>Public read / indeterminate</span><span class="seam-loader"></span><p>Waiting for public facts.</p></div><div class="micro-tile"><span>User operation / named stage</span><button data-route="encryption">Inspect stage pipeline →</button></div></div></div></section>`;
}
function render() {
  sync();
  stage.innerHTML =
    state.scene === "landing"
      ? landing()
      : state.scene === "privacy"
        ? privacy()
        : state.scene === "home"
          ? home()
          : ["save", "encryption"].includes(state.scene)
            ? save()
            : state.scene.startsWith("draw")
              ? draw()
              : state.scene === "studies"
                ? studies()
                : reveal(state.scene === "private");
  const rail = document.querySelector("#proof-rail");
  rail.innerHTML =
    state.scene === "landing"
      ? ["position", "privacy", "proof", "enter"]
          .map(
            (s, i) =>
              `<a href="#${s}" aria-current="${i === 0}">${String(i + 1).padStart(2, "0")} ${s.toUpperCase()}</a>`,
          )
          .join("")
      : "";
  rail.hidden = state.scene !== "landing";
  if (state.revealed)
    document
      .querySelector(".reveal-object")
      ?.insertAdjacentHTML(
        "beforeend",
        '<svg class="reveal-outline" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><path d="M1 1H999V299H1Z"/></svg>',
      );
  observeSections();
  updateScroll();
}
function setScene(scene) {
  cancelSequence();
  state.scene = scene;
  state.error = false;
  state.revealed = false;
  state.waiting = false;
  state.pipeline = scene === "encryption" ? 2 : -1;
  state.draw = scene === "draw-blind" ? "BLIND DRAW" : scene === "draw-verify" ? "VERIFY" : "OPEN";
  render();
  window.scrollTo(0, 0);
}
function transition(change, native = false) {
  if (transitioning) return;
  if (state.reduced) {
    change();
    return;
  }
  transitioning = true;
  root.classList.add("transitioning");
  setTimeout(() => {
    if (native && document.startViewTransition) document.startViewTransition(change);
    else change();
  }, 220);
  setTimeout(() => {
    root.classList.remove("transitioning");
    transitioning = false;
  }, 500);
}
function intro(repeat = false) {
  if (state.reduced) return;
  window.scrollTo(0, 0);
  const el = document.querySelector(".intro");
  el.className = `intro play${repeat ? " repeat" : ""}`;
  setTimeout(() => (el.className = "intro"), repeat ? 240 : 1100);
}
function observeSections() {
  sceneObserver?.disconnect();
  sceneObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const links = [...document.querySelectorAll("#proof-rail a")];
          const index = links.findIndex((a) => a.hash === `#${e.target.id}`);
          links.forEach((a, i) => {
            a.setAttribute("aria-current", String(i === index));
            a.classList.toggle("done", i < index);
          });
        }
      }
    },
    { rootMargin: "-15% 0px -45% 0px" },
  );
  stage.querySelectorAll("section[id]").forEach((s) => sceneObserver.observe(s));
}
function updateScroll() {
  scrollFrame = 0;
  stage.querySelectorAll(".privacy-boundary").forEach((el) => {
    const rect = el.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (innerHeight * 0.8 - rect.top) / Math.max(innerHeight * 0.7, 1)));
    el.style.setProperty("--occlusion", String(state.reduced ? 1 : progress));
  });
}
addEventListener(
  "scroll",
  () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  },
  { passive: true },
);
function nextPipeline() {
  state.error = false;
  state.pipeline = Math.min(5, state.pipeline + 1);
  render();
}
function playSave() {
  cancelSequence();
  if (!amountLabel(state.amount)) {
    state.error = true;
    render();
    return;
  }
  state.pipeline = 0;
  render();
  if (state.reduced || state.paused) return;
  [1, 2, 3, 4, 5].forEach((n, i) =>
    later(
      () => {
        state.pipeline = n;
        render();
      },
      (i + 1) * 1400,
    ),
  );
}
function playDraw() {
  cancelSequence();
  state.draw = "OPEN";
  render();
  if (state.reduced || state.paused) return;
  ["SNAPSHOT", "BLIND DRAW", "VERIFY", "DELIVER", "DELIVERED"].forEach((s, i) =>
    later(
      () => {
        state.draw = s;
        render();
      },
      (i + 1) * 2100,
    ),
  );
}
function revealValue(kind) {
  cancelSequence();
  if (state.revealed) {
    state.revealed = false;
    state.waiting = false;
    render();
    return;
  }
  state.waiting = true;
  render();
  later(
    () => {
      state.waiting = false;
      state.revealed = true;
      render();
    },
    state.reduced ? 0 : 680,
  );
}
document.addEventListener("click", (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  if (b.dataset.direction) {
    transition(() => {
      state.direction = b.dataset.direction;
      render();
    });
    return;
  }
  if (b.dataset.route) {
    transition(() => setScene(b.dataset.route), true);
    return;
  }
  if (b.hasAttribute("data-private-reveal")) {
    transition(() => setScene("private"));
    return;
  }
  if (b.dataset.mode) {
    cancelSequence();
    state.mode = b.dataset.mode;
    state.pipeline = -1;
    render();
    return;
  }
  if (b.dataset.draw) {
    cancelSequence();
    state.draw = b.dataset.draw;
    render();
    return;
  }
  if (b.dataset.micro) {
    const action = b.dataset.micro;
    if (action === "copy") {
      navigator.clipboard
        ?.writeText("VEIL ENGINE / DESIGN LAB")
        .then(() => toast("Lab label copied"))
        .catch(() => toast("Clipboard unavailable; label is VEIL ENGINE"));
    }
    if (action === "number" || action === "countdown") {
      b.classList.remove("rolling");
      void b.offsetWidth;
      b.classList.add("rolling");
      b.textContent = action === "number" ? "Round 03" : "00:58";
    }
    if (action === "success")
      b.innerHTML =
        '<svg class="success-check" viewBox="0 0 28 28" aria-label="Success"><path d="M4 14l7 7L25 6"/></svg>';
    if (action === "error") {
      b.textContent = "Interrupted / retry";
      b.classList.add("operation-error");
    }
    if (action === "nav") {
      b.parentElement.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    }
    if (action === "proof") b.classList.add("verified-line");
    if (action === "theme")
      transition(() => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        sync();
      });
    return;
  }
  switch (b.id) {
    case "theme":
      transition(() => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        sync();
      });
      break;
    case "reduce":
      cancelSequence();
      state.reduced = !state.reduced || reducedPreference.matches;
      state.waiting = false;
      render();
      break;
    case "pause":
      cancelSequence();
      state.paused = !state.paused;
      sync();
      break;
    case "replay-intro":
    case "study-intro":
      intro();
      break;
    case "repeat-intro":
      intro(true);
      break;
    case "seal":
    case "play-save":
      playSave();
      break;
    case "next-stage":
      cancelSequence();
      nextPipeline();
      break;
    case "reset-save":
      cancelSequence();
      state.pipeline = -1;
      state.error = false;
      render();
      break;
    case "fail-save":
      cancelSequence();
      state.error = true;
      state.pipeline = -1;
      render();
      break;
    case "play-draw":
      playDraw();
      break;
    case "advance": {
      cancelSequence();
      b.textContent = "SUBMITTING DEMO…";
      b.disabled = true;
      later(
        () => {
          toast("Demo action confirmed. No transaction sent.");
          const order = [...STEPS, "DELIVERED"];
          state.draw = order[(order.indexOf(state.draw) + 1) % order.length];
          render();
        },
        state.reduced ? 0 : 700,
      );
      break;
    }
    case "reveal":
      revealValue(b.dataset.kind);
      break;
    case "play-prize":
      cancelSequence();
      state.revealed = false;
      state.waiting = true;
      render();
      later(
        () => {
          state.waiting = false;
          state.revealed = true;
          render();
        },
        state.reduced ? 0 : 1400,
      );
      break;
    case "animate-marks":
      document.querySelectorAll(".logo-specimens,.mark-demo").forEach((el) => {
        el.classList.remove("mark-animate");
        void el.offsetWidth;
        el.classList.add("mark-animate");
      });
      break;
  }
});
document.querySelector("#scene").addEventListener("change", (e) => transition(() => setScene(e.target.value)));
document.querySelector("#engine").addEventListener("change", (e) => {
  state.engine = e.target.value;
  sync();
});
document.querySelector("#type").addEventListener("change", (e) => {
  state.type = e.target.value;
  sync();
});
stage.addEventListener("input", (e) => {
  if (e.target.id !== "amount") return;
  state.amount = e.target.value.replace(/\D/g, "").slice(0, 9);
  e.target.value = state.amount;
  const button = document.querySelector("#seal");
  button.textContent = `${state.mode === "Deposit" ? "SEAL" : "REQUEST"} ${state.amount || "0"} TEST →`;
});
stage.addEventListener("focusin", (e) => {
  if (e.target.id === "amount") configureEngine("focus");
});
stage.addEventListener("focusout", (e) => {
  if (e.target.id === "amount") configureEngine();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelSequence();
    if (state.waiting) {
      state.waiting = false;
      render();
    }
  }
});
reducedPreference.addEventListener("change", (e) => {
  state.reduced = e.matches;
  cancelSequence();
  render();
});
state.pipeline = state.scene === "encryption" ? 2 : -1;
state.draw = state.scene === "draw-blind" ? "BLIND DRAW" : state.scene === "draw-verify" ? "VERIFY" : "OPEN";
state.revealed = params.get("reveal") === "1" && state.scene === "prize";
render();
if (params.get("intro") !== "off") {
  let repeat = false;
  try {
    repeat = sessionStorage.getItem("veil-engine-lab-seen") === "1";
    sessionStorage.setItem("veil-engine-lab-seen", "1");
  } catch {
    /* Storage is optional; never delays content. */
  }
  intro(repeat);
}
