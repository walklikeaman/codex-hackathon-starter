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

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const source = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist", "maplibre-gl-worker.mjs");
const destination = path.join(process.cwd(), "public", "maplibre-gl-worker.mjs");

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);

console.log(`maplibre worker → ${path.relative(process.cwd(), destination)}`);
