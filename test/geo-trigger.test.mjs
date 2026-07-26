import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceTriggers,
  clampTriggerRadius,
  DEFAULT_TRIGGER_RADIUS_M,
  hasMovedEnough,
  isUsableFix,
  MAX_ACCEPTABLE_ACCURACY_M,
  metresTo,
  MOVEMENT_THRESHOLD_M,
  playbackState,
  triggeredStop,
  UNLOCK_PROMPT,
} from "../app/lib/geo-trigger.mjs";

const TRAFALGAR = [51.508, -0.128];
const NELSON = [51.5081, -0.1281];        // a few metres away
const LEADENHALL = [51.5127, -0.0835];    // ~3 km away

const stops = [
  { id: "a", place: "Trafalgar Square", position: TRAFALGAR },
  { id: "b", place: "Leadenhall Market", position: LEADENHALL },
];

test("arriving at a stop triggers it", () => {
  const hit = triggeredStop(stops, NELSON);
  assert.equal(hit.stop.id, "a");
  assert.ok(hit.distance_m <= DEFAULT_TRIGGER_RADIUS_M);
});

test("a stop speaks ONCE, however long you stand there", () => {
  // Position updates arrive constantly and GPS jitters across the boundary; without
  // this the narration would restart every few seconds while standing still.
  const first = advanceTriggers({}, NELSON, { stops });
  assert.equal(first.speak.id, "a");

  const second = advanceTriggers(first.state, NELSON, { stops });
  assert.equal(second.speak, null);
  assert.deepEqual(second.state.playedIds, ["a"]);
});

test("only ONE narration starts at a time, and it is the nearest", () => {
  // Two guides talking over each other is worse than a slightly late second one.
  const crowded = [
    { id: "far", position: [51.5083, -0.1284] },
    { id: "near", position: NELSON },
  ];
  const hit = triggeredStop(crowded, NELSON);
  assert.equal(hit.stop.id, "near");
});

test("a fix too vague to place the walker fires nothing", () => {
  // A trigger is a claim about where you are; a 500 m accuracy cannot support it.
  const vague = { coords: NELSON, accuracy: 500 };
  assert.equal(isUsableFix(vague), false);
  assert.equal(triggeredStop(stops, vague), null);

  const precise = { coords: NELSON, accuracy: 15 };
  assert.equal(isUsableFix(precise), true);
  assert.equal(triggeredStop(stops, precise).stop.id, "a");
});

test("an unreported accuracy is trusted, a poor one is not", () => {
  // Some browsers omit accuracy entirely; refusing those would break the feature.
  assert.equal(isUsableFix({ coords: NELSON }), true);
  assert.equal(isUsableFix({ coords: NELSON, accuracy: MAX_ACCEPTABLE_ACCURACY_M }), true);
  assert.equal(isUsableFix({ coords: NELSON, accuracy: MAX_ACCEPTABLE_ACCURACY_M + 1 }), false);
  assert.equal(isUsableFix(null), false);
});

test("standing outside the radius stays silent", () => {
  assert.equal(triggeredStop(stops, [51.51, -0.128]), null);
});

test("the radius is configurable but bounded", () => {
  assert.equal(clampTriggerRadius(80), 80);
  assert.equal(clampTriggerRadius(99999), 250); // a city-wide trigger is not a trigger
  assert.equal(clampTriggerRadius(0), DEFAULT_TRIGGER_RADIUS_M);
  assert.equal(clampTriggerRadius(null), DEFAULT_TRIGGER_RADIUS_M);

  // With a wider radius the far stop comes into range.
  const hit = triggeredStop([{ id: "b", position: [51.5085, -0.128] }], TRAFALGAR, { radiusM: 100 });
  assert.equal(hit.stop.id, "b");
});

test("a walk continues through the stops in turn", () => {
  let state = {};
  const atFirst = advanceTriggers(state, NELSON, { stops });
  state = atFirst.state;
  assert.equal(atFirst.speak.id, "a");

  const atSecond = advanceTriggers(state, [51.5127, -0.0836], { stops });
  assert.equal(atSecond.speak.id, "b");
  assert.deepEqual(atSecond.state.playedIds, ["a", "b"]);
});

test("standing still is not worth waking the app for", () => {
  // A stream of jittering fixes drains the battery for no new information.
  assert.equal(hasMovedEnough(null, NELSON), true); // the first fix always counts
  assert.equal(hasMovedEnough(TRAFALGAR, TRAFALGAR), false);
  assert.equal(hasMovedEnough(TRAFALGAR, LEADENHALL), true);

  const jitter = metresTo(TRAFALGAR, [51.50805, -0.12805]);
  assert.ok(jitter < MOVEMENT_THRESHOLD_M);
  assert.equal(hasMovedEnough(TRAFALGAR, [51.50805, -0.12805]), false);
});

test("audio is silent by policy, never by surprise", () => {
  // Browsers block audio a page starts by itself. Without an explicit unlock the
  // walker reaches the first stop and hears nothing — with nothing to tap, because
  // the whole promise is that no tapping is needed.
  assert.equal(playbackState({ walking: false, unlocked: false }), "idle");
  assert.equal(playbackState({ walking: true, unlocked: false }), "needs-unlock");
  assert.equal(playbackState({ walking: true, unlocked: true }), "armed");
  assert.match(UNLOCK_PROMPT, /tap once/i);
  assert.match(UNLOCK_PROMPT, /by itself/i);
});

test("advanceTriggers tolerates junk without losing what was already played", () => {
  const state = { playedIds: ["a"], lastPosition: TRAFALGAR };
  const result = advanceTriggers(state, null, { stops });
  assert.equal(result.speak, null);
  assert.deepEqual(result.state.playedIds, ["a"]);
  assert.deepEqual(result.state.lastPosition, TRAFALGAR); // the last known fix survives
});
