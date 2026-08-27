// Builds static, offline-readable evidence galleries from actual capture metadata.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url);
const capture = JSON.parse(await readFile(new URL("screenshots/manifest.json", root), "utf8"));
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = `*{box-sizing:border-box}body{margin:0;padding:20px;background:#e9eeeb;color:#1a251e;font:13px Arial,sans-serif}h1{font-size:24px;margin:0 0 12px}p{line-height:1.5}a{color:inherit}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;width:840px}figure{margin:0;min-width:0;background:#dae2dc}img{display:block;width:100%;height:auto}figcaption{padding:8px;font-size:10px;line-height:1.3}.tiles{display:grid;grid-template-columns:1fr 1fr}.mobile .tiles{grid-template-columns:1fr}.links{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.full{max-width:1400px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.full img{height:auto}@media(max-width:900px){.full{grid-template-columns:1fr}main{width:100%;grid-template-columns:repeat(2,1fr)}}`;
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;
const groups = [...new Set(capture.map((x) => x.name.split("-").slice(0, 3).join("-")))];
for (const group of groups) {
  const rows = capture.filter((x) => x.name.startsWith(group + "-"));
  const body = `<h1>${group.toUpperCase()} / rendered detail sheet</h1><p>8 scenes • actual browser crops • conceptual data only. Native wide capture is defective; bounded crops are retained without alteration.</p><main>${rows.map((x) => `<figure><a href="${escape(x.files.at(-1))}"><img src="${escape(x.files.at(-1))}" alt="${escape(x.name)}"></a><figcaption>${escape(x.name)}<br>${x.width} × ${x.height} CSS viewport · overflow ${x.scrollWidth > x.clientWidth ? "YES" : "none"}</figcaption></figure>`).join("")}</main>`;
  await writeFile(new URL(`screenshots/board-${group}.html`, root), page(group, body));
}
await writeFile(
  new URL("screenshots/index.html", root),
  page(
    "VEIL ENGINE / Actual render evidence",
    `<h1>96 scenes / actual render evidence</h1><p>Each viewport has bounded screenshot tiles and a key-state detail crop. The installed browser repeats regions in wide stitched captures at host scaling; these files do not claim to be pristine full-viewport PNGs. No pixels were repainted or generated.</p><div class="links">${groups.map((g) => `<a href="board-${g}.html">${g}</a>`).join("")}</div><div class="full">${capture
      .map(
        (x) =>
          `<figure class="${x.width === 390 ? "mobile" : "desktop"}"><figcaption>${escape(x.name)} · ${x.width}×${x.height}</figcaption><div class="tiles">${x.files
            .slice(0, -1)
            .map((f) => `<a href="${escape(f)}"><img src="${escape(f)}" alt="${escape(f)}"></a>`)
            .join("")}</div><a href="${escape(x.files.at(-1))}">Key-state detail ↗</a></figure>`,
      )
      .join("")}</div>`,
  ),
);
try {
  const motion = JSON.parse(await readFile(new URL("recordings/manifest.json", root), "utf8"));
  await writeFile(
    new URL("recordings/index.html", root),
    page(
      "VEIL ENGINE / Motion contact sheets",
      `<h1>Rendered motion / timed frames</h1><p>Observed elapsed timestamps, not claimed video frame rates. Browser call latency is included. No recording tool was installed.</p>${motion.map((s) => `<h2>${escape(s.name)}</h2><div class="full">${s.frames.map((f) => `<figure><img src="${escape(f.file)}" alt="${escape(s.name)} at ${f.elapsedMs} ms"><figcaption>${f.elapsedMs} ms · ${escape(f.stage || "")}</figcaption></figure>`).join("")}</div>`).join("")}`,
    ),
  );
} catch {
  /* Motion evidence is built after capture. */
}
console.log(`Built ${capture.length} scene entries and ${groups.length} contact sheets in ${fileURLToPath(root)}`);
