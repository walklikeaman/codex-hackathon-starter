import assert from "node:assert/strict";
import test from "node:test";

import {
  WALK_KEY, WALK_MAX_AGE_MS, clearWalk, freezeWalk, loadWalk, saveWalk, walkAgeLabel,
} from "../app/lib/walk-store.mjs";

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
    size: () => data.size,
  };
}

const STOPS = [
  { id: "a", film: "Skyfall", kind: "film", scene: "the MI6 entrance", place: "West Smithfield",
    position: [51.5186, -0.1005], isCandidate: true, display: "point", voice: "…long text…" },
  { id: "b", film: "Batman Begins", kind: "film", scene: "the courthouse", place: "St Pancras",
    position: [51.5308, -0.1263], isCandidate: false, display: "point" },
];
const ROUTE = {
  positions: [[51.5186, -0.1005], [51.524, -0.113], [51.5308, -0.1263]],
  distanceKm: 2.4, durationMinutes: 31, source: "openstreetmap-foot",
};

test("a built route freezes into what the map needs to draw it again", () => {
  const walk = freezeWalk({ stops: STOPS, route: ROUTE, cityName: "London", now: 1_000 });

  assert.equal(walk.stops.length, 2);
  assert.deepEqual(walk.stops[0].position, [51.5186, -0.1005]);
  assert.equal(walk.stops[0].film, "Skyfall");
  assert.equal(walk.route.distanceKm, 2.4);
  // The claim the card makes about the line travels with it, so a restored walk cannot
  // upgrade "connected directly" into "follows mapped streets".
  assert.equal(walk.route.source, "openstreetmap-foot");
  assert.equal(walk.cityName, "London");
});

// Everything a stop happens to carry that can be fetched again is left behind.
test("the narration and anything else heavy is not frozen", () => {
  const walk = freezeWalk({ stops: STOPS, route: ROUTE });
  assert.equal("voice" in walk.stops[0], false);
});

test("one stop is a place, not a walk", () => {
  assert.equal(freezeWalk({ stops: [STOPS[0]], route: ROUTE }), null);
  assert.equal(freezeWalk({ stops: [], route: ROUTE }), null);
  assert.equal(freezeWalk({}), null);
});

test("a stop without a usable coordinate cannot be part of a frozen walk", () => {
  const broken = [{ ...STOPS[0], position: [0, 0] }, { ...STOPS[1], position: null }];
  assert.equal(freezeWalk({ stops: broken, route: ROUTE }), null);
});

test("a walk survives a round trip through storage", () => {
  const store = storage();
  const walk = freezeWalk({ stops: STOPS, route: ROUTE, cityName: "London", now: 5_000 });
  assert.equal(saveWalk(store, walk), true);

  const restored = loadWalk(store, { now: 5_000 + 60_000 });
  assert.equal(restored.stops.length, 2);
  assert.equal(restored.route.durationMinutes, 31);
});

// A route is a plan for an afternoon. Yesterday's must never come back as today's.
test("a walk older than the window is not restored", () => {
  const store = storage();
  saveWalk(store, freezeWalk({ stops: STOPS, route: ROUTE, now: 0 }));

  assert.ok(loadWalk(store, { now: WALK_MAX_AGE_MS - 1 }));
  assert.equal(loadWalk(store, { now: WALK_MAX_AGE_MS + 1 }), null);
});

test("anything unreadable is dropped rather than half-read", () => {
  assert.equal(loadWalk(storage({ [WALK_KEY]: "{not json" })), null);
  assert.equal(loadWalk(storage({ [WALK_KEY]: JSON.stringify({ version: 99, savedAt: Date.now(), stops: STOPS }) })), null);
  assert.equal(loadWalk(storage({ [WALK_KEY]: JSON.stringify({ version: 1, stops: STOPS }) })), null);
  assert.equal(loadWalk(storage()), null);
  assert.equal(loadWalk(null), null);
});

// A full or refused localStorage is not a reason to interrupt a walk being planned.
test("storage that refuses to write says so and changes nothing else", () => {
  const refusing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(saveWalk(refusing, freezeWalk({ stops: STOPS, route: ROUTE })), false);
});

test("clearing is safe on storage that is not there", () => {
  const store = storage();
  saveWalk(store, freezeWalk({ stops: STOPS, route: ROUTE }));
  clearWalk(store);
  assert.equal(loadWalk(store), null);
  assert.doesNotThrow(() => clearWalk(null));
});

test("the age reads the way a person says it", () => {
  const savedAt = 1_000_000;
  assert.equal(walkAgeLabel({ savedAt }, { now: savedAt + 20_000 }), "just now");
  assert.equal(walkAgeLabel({ savedAt }, { now: savedAt + 7 * 60_000 }), "7 min ago");
  assert.equal(walkAgeLabel({ savedAt }, { now: savedAt + 60 * 60_000 }), "1 hour ago");
  assert.equal(walkAgeLabel({ savedAt }, { now: savedAt + 3 * 60 * 60_000 }), "3 hours ago");
  assert.equal(walkAgeLabel({}), null);
});
