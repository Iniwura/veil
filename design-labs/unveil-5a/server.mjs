// Dependency-free, loopback-only server. Serves this lab, never repository secrets.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 5190);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Use a port from 1024 to 65535");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
  ".md": "text/plain",
};
createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const file = (await stat(path)).isDirectory() ? resolve(path, "index.html") : path;
    res.writeHead(200, {
      "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("Lab file not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`VEIL ENGINE lab: http://127.0.0.1:${port}/`));
