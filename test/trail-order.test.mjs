import assert from "node:assert/strict";
import test from "node:test";

import { LONG_LEG_KM, onFootNote, orderTrail, pathKm, ROUTER_MAX_STOPS, TRAIL_ORDER, trailOrderNote, walkingOrder, walkRuns } from "../app/lib/trail-order.mjs";

const stop = (sequence_index, place, position) => ({ id: place, sequence_index, place, position });

// Sherlock Holmes (2009), its three walkable London stops in story order, as on prod
// (2026-10-02): the plot goes Temple → Brompton → the City, crossing London and back.
const sherlock = [
  stop(1, "Middle Temple Hall", [51.5119, -0.1109]),
  stop(2, "Brompton Cemetery", [51.4846, -0.1904]),
  stop(3, "College of Arms", [51.5122, -0.0987]),
];

test("the story order is the plot's sequence, whatever order the stops arrive in", () => {
  const shuffled = [sherlock[2], sherlock[0], sherlock[1]];
  assert.deepEqual(orderTrail(shuffled, TRAIL_ORDER.story).map((s) => s.sequence_index), [1, 2, 3]);
});

test("the walking order does not double back where the story does", () => {
  const walk = orderTrail(sherlock, TRAIL_ORDER.walk);
  assert.ok(pathKm(walk) < pathKm(orderTrail(sherlock, TRAIL_ORDER.story)));
  // Brompton is the far end, so the walk starts or ends there and never crosses twice.
  assert.ok([walk[0].place, walk.at(-1).place].includes("Brompton Cemetery"));
});

test("a stop keeps its place in the story when the walk reorders it", () => {
  const walk = orderTrail(sherlock, TRAIL_ORDER.walk);
  assert.deepEqual(walk.map((s) => s.walk_index), [1, 2, 3]);
  const brompton = walk.find((s) => s.place === "Brompton Cemetery");
  assert.equal(brompton.sequence_index, 2);
});

test("the switch never adds or drops a stop", () => {
  for (const order of [TRAIL_ORDER.story, TRAIL_ORDER.walk]) {
    assert.deepEqual(orderTrail(sherlock, order).map((s) => s.id).sort(), sherlock.map((s) => s.id).sort());
  }
});

// A zigzag along one street: the plot visits 1, 5, 2, 4, 3; the walk is 1 to 5 once.
test("the walking order finds the straight walk through a zigzag", () => {
  const zigzag = [0, 4, 1, 3, 2].map((x, index) => stop(index + 1, `p${x}`, [51.5, -0.1 + x * 0.01]));
  const walk = walkingOrder(zigzag).map((s) => s.place);
  assert.ok(["p0,p1,p2,p3,p4", "p4,p3,p2,p1,p0"].includes(walk.join(",")));
});

test("two stops have one walk, and nothing breaks on none", () => {
  assert.equal(walkingOrder(sherlock.slice(0, 2)).length, 2);
  assert.deepEqual(orderTrail([], TRAIL_ORDER.walk), []);
  assert.deepEqual(orderTrail(null, TRAIL_ORDER.story), []);
  assert.equal(trailOrderNote([sherlock[0]], TRAIL_ORDER.story), null);
});

test("the note says what walking order saves, and how many legs need a ride", () => {
  assert.equal(
    trailOrderNote(sherlock, TRAIL_ORDER.story),
    "13 km in story order, 7.1 km in walking order · 2 legs need a ride.",
  );
});

test("a story that already walks well is told so, not offered a saving", () => {
  // V for Vendetta's three Westminster stops, in plot order.
  const vendetta = [
    stop(1, "Bridge Street & Parliament Street", [51.5010, -0.1262]),
    stop(4, "Trafalgar Square", [51.5081, -0.1281]),
    stop(5, "Aldwych tube station", [51.5121, -0.1159]),
  ];
  assert.equal(trailOrderNote(vendetta, TRAIL_ORDER.story), "Story order is already the short way: 1.8 km.");
});

test("a leg is a ride beyond the long-leg distance, and only beyond it", () => {
  const near = [stop(1, "a", [51.5, -0.1]), stop(2, "b", [51.5 + (LONG_LEG_KM - 0.1) / 111.2, -0.1])];
  const far = [stop(1, "a", [51.5, -0.1]), stop(2, "b", [51.5 + (LONG_LEG_KM + 0.1) / 111.2, -0.1])];
  assert.doesNotMatch(trailOrderNote(near, TRAIL_ORDER.story), /ride/);
  assert.match(trailOrderNote(far, TRAIL_ORDER.story), /1 leg needs a ride/);
});

// Sherlock Holmes again, with the two stops it has outside London (Manchester Town Hall,
// Stanley Dock in Liverpool): one trail, three cities.
test("the walk is cut where a leg needs a ride, and only there", () => {
  const trail = [
    ...sherlock,
    stop(4, "Manchester Town Hall", [53.4792, -2.2442]),
    stop(5, "Stanley Dock", [53.4216, -3.0002]),
  ];
  const { runs, rides } = walkRuns(orderTrail(trail, TRAIL_ORDER.story));
  assert.equal(runs.length, 0, "every leg of this story order is longer than a walk");
  assert.equal(rides.length, 4);

  const walked = walkRuns(orderTrail(trail, TRAIL_ORDER.walk));
  assert.ok(walked.rides.length < 4);
});

test("a run of walkable legs is one route, cut into router-sized pieces that share an end", () => {
  const street = Array.from({ length: 7 }, (_, index) => stop(index + 1, `s${index}`, [51.5, -0.1 + index * 0.002]));
  const { runs, rides } = walkRuns(street);
  assert.equal(rides.length, 0);
  assert.deepEqual(runs.map((run) => run.map((s) => s.place)), [
    ["s0", "s1", "s2", "s3", "s4"],
    ["s4", "s5", "s6"],
  ]);
  assert.ok(runs.every((run) => run.length >= 2 && run.length <= ROUTER_MAX_STOPS));
});

test("the walking is added up over the runs, and the rides are left out of it", () => {
  assert.equal(onFootNote([{ distanceKm: 1.2, durationMinutes: 16 }, { distanceKm: 2.1, durationMinutes: 29 }]), "On foot: 3.3 km, about 45 min.");
  assert.equal(onFootNote([{ distanceKm: 9.4, durationMinutes: 130 }]), "On foot: 9.4 km, about 2 h 10 min.");
  assert.match(onFootNote([{ distanceKm: 1, durationMinutes: 13, source: "fallback" }]), /straight lines/);
  assert.equal(onFootNote([]), null);
});
