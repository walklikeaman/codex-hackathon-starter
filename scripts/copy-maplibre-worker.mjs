// Put MapLibre's worker where the browser can actually fetch it.
//
// **The bug this exists for.** MapLibre spawns its tile-parsing worker with
// `new Worker(url, { type: "module" })`, and under Next.js that URL is not served: the
// request comes back as the HTML 404 page, and the browser refuses it —
//
//   Failed to load module script: The server responded with a non-JavaScript MIME type
//   of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.
//
// That line sat in the console the whole time and looked like ordinary dev-server noise. It
// is not. Without its worker MapLibre parses the style and then stops: no source ever begins
// loading, `load` never fires, not one tile is requested, and the map is a black rectangle.
// Measured on production: `built:y load:n styledata:2 sourcedata:0`.
//
// The library ships the worker as a file and offers `setWorkerUrl`, so it is copied into
// `public/` and pointed at from there. Copied at build time rather than committed, because a
// worker from a different version of the library than the one in the bundle is a bug nobody
// would think to look for.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const dist = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist");
const publicDir = path.join(process.cwd(), "public");

// The worker is not one file. It begins `import … from "./maplibre-gl-shared.mjs"`, and
// copying only the worker leaves that import 404 — so the worker loads, dies on its first
// import, and says nothing. The map then looks exactly as it did with no worker at all:
// style loaded, sources ready, workers alive, and **zero tiles ever requested**.
//
// So the worker's own relative imports are read out of it and copied too, rather than
// listing the filenames here. A future version that splits out another chunk would
// otherwise reintroduce this silently, and it took a long time to find once.
function siblingImports(file) {
  const code = readFileSync(file, "utf8");
  const found = new Set();
  for (const match of code.matchAll(/from\s*["'](\.\/[^"']+)["']/g)) found.add(match[1].slice(2));
  return [...found];
}

mkdirSync(publicDir, { recursive: true });

const entry = "maplibre-gl-worker.mjs";
const copied = [];
const queue = [entry];
const seen = new Set();

while (queue.length) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);

  const from = path.join(dist, name);
  copyFileSync(from, path.join(publicDir, name));
  copied.push(name);
  // Transitive: a chunk may pull in another.
  for (const sibling of siblingImports(from)) queue.push(sibling);
}

console.log(`maplibre worker → public/: ${copied.join(", ")}`);
