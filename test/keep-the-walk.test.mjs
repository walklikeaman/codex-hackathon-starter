import assert from "node:assert/strict";
import test from "node:test";

import { keepTheWalk, tileTemplates } from "../app/lib/keep-the-walk.mjs";

const WALK = [[51.5194, -0.1270], [51.5100, -0.1340]];

function mapWith({ sources = {}, loaded = {} } = {}) {
  return {
    getStyle: () => ({ sources }),
    getSource: (id) => loaded[id] ?? null,
  };
}

// A hard-coded MapTiler URL would keep the wrong tiles the day the basemap changes, and
// nothing at all on OpenFreeMap.
test("the templates come from the style the map is actually drawing", () => {
  const map = mapWith({
    sources: { openmaptiles: { type: "vector", url: "https://api.maptiler.com/tiles/v3/tiles.json" } },
    loaded: { openmaptiles: { tiles: ["https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=k"] } },
  });
  assert.deepEqual(tileTemplates(map), ["https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=k"]);
});

test("a source that has not resolved its tiles yet contributes nothing, quietly", () => {
  const map = mapWith({ sources: { openmaptiles: { type: "vector", url: "https://x/tiles.json" } } });
  assert.deepEqual(tileTemplates(map), []);
});

test("geojson and image sources are not tile sources", () => {
  const map = mapWith({
    sources: {
      pins: { type: "geojson", data: {} },
      basemap: { type: "raster", tiles: ["https://x/{z}/{x}/{y}.png"] },
    },
  });
  assert.deepEqual(tileTemplates(map), ["https://x/{z}/{x}/{y}.png"]);
});

test("a walk with a tile source is fetched once, and counted", async () => {
  const asked = [];
  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });

  const result = await keepTheWalk(map, WALK, {
    fetchImpl: async (url) => { asked.push(url); return { ok: true }; },
  });

  assert.equal(result.reason, null);
  assert.ok(result.kept > 0);
  assert.equal(result.failed, 0);
  assert.equal(asked.length, result.kept);
  assert.ok(asked.every((url) => /^https:\/\/x\/\d+\/\d+\/\d+\.pbf$/.test(url)));
});

// A tile that does not arrive is a tile the walk will ask for on the day — which is what
// happened before this existed, so one failure must not stop the rest.
test("a refused tile is counted, not thrown", async () => {
  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });
  let call = 0;

  const result = await keepTheWalk(map, WALK, {
    fetchImpl: async () => { call += 1; if (call === 1) throw new Error("offline"); return { ok: true }; },
  });

  assert.equal(result.failed, 1);
  assert.ok(result.kept >= 1);
});

test("a style with no tile source, and a route that is not one, both say why", async () => {
  const empty = await keepTheWalk(mapWith(), WALK, { fetchImpl: async () => ({ ok: true }) });
  assert.equal(empty.reason, "no_tile_source");

  const map = mapWith({ sources: { v: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } } });
  const short = await keepTheWalk(map, [[51.5, -0.1]], { fetchImpl: async () => ({ ok: true }) });
  assert.equal(short.reason, "no_route");
});
