import assert from "node:assert/strict";
import test from "node:test";

import {
  achievementsOf,
  CHECK_IN_RADIUS_M,
  checkIn,
  checkInMessage,
  demoCheckIn,
  distanceFromYou,
  emptyMarks,
  GLORY_PER_VISIT,
  gloryOf,
  isWanted,
  loadMarks,
  MARKS_KEY,
  progressOf,
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
  assert.match(checkInMessage(result), /\+50 Glory/);
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

// --- Glory, progress, the first achievement (#19) ------------------------------

const here = { coords: [north(10), -0.0994], accuracy: 10 };
const bankside = { id: "loc-2", locationId: "Q2", place: "Bankside", film: "Children of Men", position: [51.508, -0.098] };

test("the first check-in pays 50 Glory, and a second one at the same place pays nothing", () => {
  const first = checkIn(emptyMarks(), tate, here, { now: 1 });
  assert.equal(gloryOf(first.marks), GLORY_PER_VISIT);

  const again = checkIn(first.marks, tate, here, { now: 2 });
  assert.equal(again.result.status, "already_visited");
  assert.equal(again.marks, first.marks, "nothing is rewritten");
  assert.equal(gloryOf(again.marks), 50);
  assert.equal(visitOf(again.marks, tate).at, 1, "the first date stands");
  assert.equal(checkInMessage(again.result), "Already visited — a place counts once.");
});

test("the same place under another row is the same visit, and pays once", () => {
  const { marks } = checkIn(emptyMarks(), tate, here);
  assert.equal(checkIn(marks, { ...tate, id: "row-2" }, here).result.status, "already_visited");
});

test("progress counts places, as X of Y and a percent", () => {
  const { marks } = checkIn(emptyMarks(), tate, here);
  assert.deepEqual(progressOf(marks, [tate, bankside, { ...tate, id: "duplicate-row" }]), { visited: 1, total: 2, percent: 50 });
  assert.deepEqual(progressOf(emptyMarks(), []), { visited: 0, total: 0, percent: 0 });
});

test("the first place unlocks 'First place', dated by that first visit", () => {
  assert.deepEqual(achievementsOf(emptyMarks()), []);
  const one = checkIn(emptyMarks(), tate, here, { now: 10 }).marks;
  const two = checkIn(one, bankside, { coords: [51.5081, -0.098], accuracy: 10 }, { now: 20 }).marks;
  assert.deepEqual(achievementsOf(two), [{ id: "first-place", title: "First place", at: 10 }]);
});

test("the stage demo checks in without a position, and the visit says it was a demo", () => {
  const { marks, result } = demoCheckIn(toggleWant(emptyMarks(), tate), tate, { now: 3 });
  assert.equal(result.demo, true);
  assert.equal(visitOf(marks, tate).demo, true);
  assert.equal(isWanted(marks, tate), false);
  assert.equal(gloryOf(marks), 50);
  assert.match(checkInMessage(result), /^Demo check-in/);
  assert.equal(demoCheckIn(marks, tate).result.status, "already_visited");
});

test("visits, and so points and achievements, survive a reload", () => {
  const storage = memoryStorage();
  saveMarks(storage, checkIn(emptyMarks(), tate, here, { now: 7 }).marks);
  const reloaded = loadMarks(storage);
  assert.equal(gloryOf(reloaded), 50);
  assert.equal(achievementsOf(reloaded)[0].at, 7);
});

// Somerset House reached the map as Q1344889 on The Day of the Jackal's row and under
// another id on Love Actually's; visited for one, it showed as unvisited for the other.
test("a place visited under one film's row is visited under another's", () => {
  const jackal = { id: "a", locationId: "Q1344889", place: "Somerset House", film: "The Day of the Jackal", position: [51.511111, -0.117777] };
  const loveActually = { id: "uuid-somerset", place: "Somerset House", film: "Love Actually", position: [51.5110, -0.1172] };
  const { marks } = demoCheckIn(emptyMarks(), jackal);
  assert.ok(visitOf(marks, loveActually));
  assert.equal(demoCheckIn(marks, loveActually).result.status, "already_visited", "and it pays once");
  assert.deepEqual(progressOf(marks, [jackal, loveActually, bankside]), { visited: 1, total: 2, percent: 50 });

  const wanted = toggleWant(emptyMarks(), jackal);
  assert.equal(isWanted(wanted, loveActually), true);
  assert.equal(isWanted(toggleWant(wanted, loveActually), jackal), false, "unmarking either row unmarks the place");
});
