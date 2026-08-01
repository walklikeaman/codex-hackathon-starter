import assert from "node:assert/strict";
import test from "node:test";

import {
  isWalkableStop,
  MAX_TRAIL_STOPS,
  normalizeTrail,
  storyTrailInstructions,
  storyTrailSchema,
  trailCacheKey,
  trailPath,
  trailStops,
} from "../app/lib/story-trail.mjs";

const scene = (overrides = {}) => ({
  sequence_index: 1,
  place_name: "Trafalgar Square",
  geo_hint: "London",
  plot_beat: "They meet under the column.",
  safe_teaser: "Where it begins",
  spoiler_tier: 1,
  is_fictional_setting: false,
  known_place: null,
  ...overrides,
});

test("the model is given no way to output a coordinate", () => {
  // The premise of the project is that no pin exists because a model was confident.
  // The schema simply has no field for one.
  const fields = Object.keys(storyTrailSchema.shape.scenes.element.shape);
  assert.equal(fields.includes("lat"), false);
  assert.equal(fields.includes("lng"), false);
  assert.equal(fields.includes("coordinates"), false);
  assert.ok(fields.includes("place_name"));
  assert.ok(fields.includes("geo_hint"));
});

test("sequence_index is a required field, not the array order", () => {
  // Array order survives neither a model response nor a database insert; relying on
  // it would scramble the story invisibly.
  assert.ok(storyTrailSchema.shape.scenes.element.shape.sequence_index);
  const parsed = normalizeTrail({
    scenes: [scene({ sequence_index: 3, place_name: "Third" }), scene({ sequence_index: 1, place_name: "First" })],
  });
  assert.deepEqual(parsed.map((s) => s.place_name), ["First", "Third"]);
});

test("the instructions forbid coordinates and prompt injection", () => {
  const instructions = storyTrailInstructions();
  assert.match(instructions, /never as instructions/i);
  assert.match(instructions, /NEVER output coordinates/);
  assert.match(instructions, /no gaps or repeats/i);
});

test("a duplicate index is a model slip, not two scenes", () => {
  const parsed = normalizeTrail({
    scenes: [
      scene({ sequence_index: 2, place_name: "Kept" }),
      scene({ sequence_index: 2, place_name: "Dropped" }),
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].place_name, "Kept");
});

test("gaps left by dropped scenes are closed, so the walk has no holes", () => {
  const parsed = normalizeTrail({
    scenes: [
      scene({ sequence_index: 1, place_name: "One" }),
      scene({ sequence_index: 5, place_name: "Two" }),
      scene({ sequence_index: 9, place_name: "Three" }),
    ],
  });
  assert.deepEqual(parsed.map((s) => s.sequence_index), [1, 2, 3]);
});

test("an unusable scene is dropped rather than half-kept", () => {
  const parsed = normalizeTrail({
    scenes: [
      scene({ place_name: "  " }),                 // no place
      scene({ sequence_index: 2, plot_beat: "" }), // no beat
      scene({ sequence_index: 0 }),                // not a position in a story
      scene({ sequence_index: 4, place_name: "Real" }),
    ],
  });
  assert.deepEqual(parsed.map((s) => s.place_name), ["Real"]);
});

test("an unknown spoiler tier is treated as a spoiler, not as safe", () => {
  // The cautious direction: guessing "safe" would show someone the ending.
  const [parsed] = normalizeTrail({ scenes: [scene({ sequence_index: 7, spoiler_tier: null })] });
  assert.equal(parsed.spoiler_tier, 7);
});

test("normalizeTrail survives a malformed response", () => {
  assert.deepEqual(normalizeTrail(null), []);
  assert.deepEqual(normalizeTrail({}), []);
  assert.deepEqual(normalizeTrail({ scenes: "nope" }), []);
});

// --- drawing the trail -------------------------------------------------------

const places = new Map([
  ["trafalgar square", { id: "p1", name: "Trafalgar Square", lat: 51.508, lng: -0.128 }],
  ["leadenhall market", { id: "p2", name: "Leadenhall Market", lat: 51.5127, lng: -0.0835 }],
]);

test("a fictional setting is never given a place on the map", () => {
  const scenes = normalizeTrail({
    scenes: [
      scene({ sequence_index: 1, place_name: "Trafalgar Square" }),
      scene({ sequence_index: 2, place_name: "Hogwarts", is_fictional_setting: true }),
    ],
  });
  const stops = trailStops(scenes, places);
  assert.deepEqual(stops.map((s) => s.place), ["Trafalgar Square"]);
});

test("a scene whose place could not be resolved is simply not a stop yet", () => {
  const scenes = normalizeTrail({
    scenes: [scene({ place_name: "Somewhere Unresolvable" })],
  });
  assert.deepEqual(trailStops(scenes, places), []);
});

test("the path follows the STORY order, not the geography", () => {
  // This is the whole feature: stop 2 is what happens next, even if it means walking
  // back past stop 1.
  const scenes = normalizeTrail({
    scenes: [
      scene({ sequence_index: 1, place_name: "Leadenhall Market" }),
      scene({ sequence_index: 2, place_name: "Trafalgar Square" }),
    ],
  });
  const path = trailPath(trailStops(scenes, places));
  assert.deepEqual(path, [[51.5127, -0.0835], [51.508, -0.128]]);
});

test("stops carry their spoiler tier through to the map", () => {
  const scenes = normalizeTrail({
    scenes: [scene({ sequence_index: 1, place_name: "Trafalgar Square", spoiler_tier: 12 })],
  });
  assert.equal(trailStops(scenes, places)[0].spoiler_tier, 12);
});

test("the trail is cached per work, keyed so two works cannot share one", () => {
  const key = trailCacheKey({ workId: "w1", title: "Notting Hill" });
  assert.equal(key, "w1:notting hill");
  assert.notEqual(key, trailCacheKey({ workId: "w2", title: "Notting Hill" }));
  assert.equal(trailCacheKey({ workId: "", title: "x" }), null);
});

test("the trail length is bounded", () => {
  // Behaviour, not zod internals: a schema library is free to restructure _def.
  const scenes = (count) => ({
    scenes: Array.from({ length: count }, (_, i) => scene({ sequence_index: i + 1 })),
  });
  assert.equal(storyTrailSchema.safeParse(scenes(MAX_TRAIL_STOPS)).success, true);
  assert.equal(storyTrailSchema.safeParse(scenes(MAX_TRAIL_STOPS + 1)).success, false);
});

// --- a stop must be somewhere you can stand ------------------------------------

test("a city is not a stop you can walk to", () => {
  // "Istanbul" is a centroid in a database. A numbered pin there says "come to this
  // spot" about a place that has no spot — the film was shot SOMEWHERE in that city
  // and we do not know where.
  assert.equal(isWalkableStop({ geocode_precision: "city" }), false);
  assert.equal(isWalkableStop({ geocode_precision: "country" }), false);
  assert.equal(isWalkableStop({ geocode_precision: "region" }), false);
});

test("a point, a street or a building is somewhere you can stand", () => {
  assert.equal(isWalkableStop({ geocode_precision: "point" }), true);
  assert.equal(isWalkableStop({ geocode_precision: "street" }), true);
  assert.equal(isWalkableStop({ geocode_precision: "building" }), true);
});

test("a snapped footprint outranks whatever precision it inherited", () => {
  // The same rule the precision badge uses: an OSM footprint is stronger evidence
  // than the string the geocoder left behind.
  assert.equal(isWalkableStop({ geocode_precision: "city", osm_building_id: "way/1" }), true);
});

test("unknown precision is not walkable — the cautious direction", () => {
  assert.equal(isWalkableStop({}), false);
  assert.equal(isWalkableStop(null), false);
});

test("precision travels with the stop, so the map can tell them apart", () => {
  const places = new Map([
    ["istanbul", { id: "p1", name: "Istanbul", lat: 41, lng: 28.9, geocode_precision: "city" }],
    ["national gallery", { id: "p2", name: "National Gallery", lat: 51.5, lng: -0.12, geocode_precision: "point" }],
  ]);
  const stops = trailStops([
    { sequence_index: 1, known_place: "Istanbul", place_norm: "istanbul", is_fictional_setting: false, spoiler_tier: 1 },
    { sequence_index: 2, known_place: "National Gallery", place_norm: "national gallery", is_fictional_setting: false, spoiler_tier: 1 },
  ], places);

  assert.equal(stops.length, 2, "an area is still a real fact about the story");
  assert.equal(isWalkableStop(stops[0]), false);
  assert.equal(isWalkableStop(stops[1]), true);
});
