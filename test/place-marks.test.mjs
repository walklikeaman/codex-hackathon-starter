import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_IN_RADIUS_M,
  checkIn,
  checkInMessage,
  distanceFromYou,
  emptyMarks,
  isWanted,
  loadMarks,
  MARKS_KEY,
  saveMarks,
  toggleWant,
  visitOf,
} from "../app/lib/place-marks.mjs";

const tate = { id: "loc-1", locationId: "Q193375", place: "Tate Modern", film: "Children of Men", position: [51.5076, -0.0994] };
const north = (metres) => 51.5076 + metres / 111320;

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, values };
}

test("want to visit toggles, and survives a reload", () => {
  const storage = memoryStorage();
  let marks = toggleWant(emptyMarks(), tate, 1000);
  assert.equal(isWanted(marks, tate), true);
  saveMarks(storage, marks);

  const reloaded = loadMarks(storage);
  assert.equal(isWanted(reloaded, tate), true);
  assert.deepEqual(reloaded.want.Q193375, { place: "Tate Modern", film: "Children of Men", position: [51.5076, -0.0994], at: 1000 });

  marks = toggleWant(reloaded, tate);
  assert.equal(isWanted(marks, tate), false);
});

test("a place is known by its entity, so the same place under another row is the same mark", () => {
  const marks = toggleWant(emptyMarks(), tate);
  assert.equal(isWanted(marks, { ...tate, id: "another-row" }), true);
});

test("standing at the place checks you in, and takes it off the want list", () => {
  const wanted = toggleWant(emptyMarks(), tate);
  const { marks, result } = checkIn(wanted, tate, { coords: [north(40), -0.0994], accuracy: 15 }, { now: 5 });
  assert.equal(result.status, "checked_in");
  assert.equal(visitOf(marks, tate).at, 5);
  assert.equal(isWanted(marks, tate), false);
});

test("a check-in is a claim about a footstep, so it is checked", () => {
  const far = checkIn(emptyMarks(), tate, { coords: [north(CHECK_IN_RADIUS_M + 60), -0.0994], accuracy: 10 });
  assert.equal(far.result.status, "too_far");
  assert.equal(visitOf(far.marks, tate), null);
  assert.match(checkInMessage(far.result), /^Not yet: your phone puts you 2\d0 m away\.$/);

  const vague = checkIn(emptyMarks(), tate, { coords: [north(10), -0.0994], accuracy: 900 });
  assert.equal(vague.result.status, "too_vague");
  assert.match(checkInMessage(vague.result), /only good to 900 m/);

  const demo = checkIn(emptyMarks(), tate, { coords: tate.position, accuracy: 5 }, { isDemo: true });
  assert.equal(demo.result.status, "demo_position");
  assert.equal(visitOf(demo.marks, tate), null);

  assert.equal(checkIn(emptyMarks(), tate, null).result.status, "no_position");
  assert.equal(checkIn(emptyMarks(), { place: "No id" }, { coords: tate.position }).result.status, "no_place");
});

test("broken or hand-edited storage reads as no marks, never as an error", () => {
  assert.deepEqual(loadMarks(memoryStorage({ [MARKS_KEY]: "{not json" })), emptyMarks());
  assert.deepEqual(loadMarks(memoryStorage({ [MARKS_KEY]: JSON.stringify({ want: [1, 2], visited: { x: { at: "yesterday" } } }) })), emptyMarks());
  assert.deepEqual(loadMarks(null), emptyMarks());
  saveMarks({ setItem: () => { throw new Error("quota"); } }, emptyMarks());
});

test("the distance is from you, or from the demo location said as such", () => {
  assert.equal(distanceFromYou([north(1200), -0.0994], tate), "1.2 km from you");
  assert.equal(distanceFromYou([north(300), -0.0994], tate, { isDemo: true }), "300 m from the demo location");
  assert.equal(distanceFromYou(null, tate), null);
});
