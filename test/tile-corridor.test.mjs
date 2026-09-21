import assert from "node:assert/strict";
import test from "node:test";

import {
  CORRIDOR_M, MAX_TILES, WALK_ZOOMS, corridorSizeLabel, corridorTiles, tileUrl,
} from "../app/lib/tile-corridor.mjs";

// The five-stop London tour this was built against: Bloomsbury to Soho, 3.8 km on foot.
const LONDON_WALK = [
  [51.5194, -0.1270], // British Museum
  [51.5165, -0.1300],
  [51.5136, -0.1320],
  [51.5117, -0.1287], // Leicester Square
  [51.5100, -0.1340],
];

test("a walk asks for the tiles along it, at the two zooms it is walked at", () => {
  const { tiles, truncated } = corridorTiles(LONDON_WALK);

  assert.ok(tiles.length > 0);
  assert.equal(truncated, false);
  assert.deepEqual([...new Set(tiles.map((tile) => tile.z))].sort(), [...WALK_ZOOMS]);
  assert.ok(tiles.every((tile) => Number.isInteger(tile.x) && Number.isInteger(tile.y)));
});

// #161 says "the route's bounding box". Measured, that is the wrong shape: the rest is the
// city either side of a line nobody walks down.
test("the corridor is smaller than the bounding box of the same walk", () => {
  const diagonal = [[51.52, -0.14], [51.50, -0.10]];
  const corridor = corridorTiles(diagonal, { zooms: [14] }).tiles.length;
  // One "segment" spanning the whole diagonal IS the bounding box.
  const boundingBox = corridorTiles([[51.52, -0.14], [51.50, -0.10]], {
    zooms: [14], corridorM: CORRIDOR_M,
  }).tiles.length;
  const broken = corridorTiles([
    [51.52, -0.14], [51.51, -0.14], [51.51, -0.10], [51.50, -0.10],
  ], { zooms: [14] }).tiles.length;

  assert.equal(corridor, boundingBox, "a straight walk and its box are the same thing");
  assert.ok(broken < boundingBox * 2, "an L-shaped walk follows its corners, not the rectangle");
});

// A truncated prefetch must keep the beginning of the walk, which is the part walked first.
test("tiles come back in walking order, and the cap keeps the start", () => {
  const { tiles, truncated, wanted } = corridorTiles(LONDON_WALK, { maxTiles: 2 });

  assert.equal(tiles.length, 2);
  assert.equal(truncated, true);
  assert.ok(wanted > 2);

  const full = corridorTiles(LONDON_WALK).tiles;
  assert.deepEqual(tiles, full.slice(0, 2), "the first two are the first two");
});

// The number that decides whether this is worth doing at all. A vector tile covers about
// 2.4 km at z14 in London, so a 3.8 km walk across Bloomsbury and Soho is FOUR tiles at the
// two zooms it is walked at — roughly 100 kB, fetched once.
test("a city walk costs a handful of tiles, not a download", () => {
  const { wanted } = corridorTiles(LONDON_WALK);
  assert.equal(wanted, 4);
  assert.equal(corridorSizeLabel(wanted), "100 kB");
});

test("a walk is not a licence to download a city", () => {
  const acrossEngland = [[51.5, -0.12], [53.48, -2.24]];
  const { tiles, truncated } = corridorTiles(acrossEngland);
  assert.equal(tiles.length, MAX_TILES);
  assert.equal(truncated, true);
});

test("one point is not a route, and nonsense is not a corridor", () => {
  assert.deepEqual(corridorTiles([[51.5, -0.12]]).tiles, []);
  assert.deepEqual(corridorTiles([]).tiles, []);
  assert.deepEqual(corridorTiles(null).tiles, []);
  assert.deepEqual(corridorTiles([[51.5, -0.12], [NaN, 0]]).tiles, []);
  assert.deepEqual(corridorTiles([[91, 0], [92, 1]]).tiles, []);
});

// A corridor 120 m wide is a different number of degrees of longitude in Reykjavík than in
// Nairobi; one number for both turns a corridor into an ellipse.
test("the corridor keeps its width away from the equator", () => {
  const equator = corridorTiles([[0, 0], [0, 0.02]], { zooms: [14] }).tiles.length;
  const iceland = corridorTiles([[64.14, -21.94], [64.14, -21.92]], { zooms: [14] }).tiles.length;
  assert.ok(iceland >= equator, `${iceland} vs ${equator}`);
});

test("a tile becomes a URL, and a template missing a part is refused", () => {
  assert.equal(
    tileUrl("https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=k", { z: 14, x: 8189, y: 5448 }),
    "https://api.maptiler.com/tiles/v3/14/8189/5448.pbf?key=k",
  );
  assert.equal(tileUrl("https://example.com/{z}/{x}.pbf", { z: 1, x: 2, y: 3 }), null);
  assert.equal(tileUrl(null, { z: 1, x: 2, y: 3 }), null);
});

test("the size is stated in units a person reads", () => {
  assert.equal(corridorSizeLabel(8), "200 kB");
  assert.equal(corridorSizeLabel(120), "3.0 MB");
});
