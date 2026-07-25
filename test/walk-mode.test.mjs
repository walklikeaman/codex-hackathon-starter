import assert from "node:assert/strict";
import test from "node:test";

import {
  ARRIVAL_RADIUS_M,
  formatDistance,
  lockAction,
  metresBetween,
  nextStop,
  ROAD_SAFETY_REMINDER,
  shouldHoldLock,
  wakeLockSupported,
  walkBanner,
  walkingMinutes,
} from "../app/lib/walk-mode.mjs";

const TRAFALGAR = [51.508, -0.128];
const stops = [
  { id: "a", place: "Trafalgar Square", position: TRAFALGAR },
  { id: "b", place: "Leadenhall Market", position: [51.5127, -0.0835] },
];

test("distance and ETA describe the walk, not the crow's flight time", () => {
  const metres = metresBetween(TRAFALGAR, [51.5127, -0.0835]);
  assert.ok(metres > 3000 && metres < 3400); // ~3.2 km across London
  // At a tourist's pace, not the route planner's 4.6 km/h.
  assert.ok(walkingMinutes(metres) >= 45);
});

test("the ETA is honest at both ends of the scale", () => {
  // Never "0 min" while there is still a block to walk...
  assert.equal(walkingMinutes(1), 1);
  assert.equal(walkingMinutes(80), 1);
  // ...and never double: rounding UP would call an 80 m stroll "2 min", and an ETA
  // that is obviously wrong stops being read.
  assert.equal(walkingMinutes(300), 4);
  assert.equal(walkingMinutes(0), 0);
  assert.equal(walkingMinutes(null), 0);
});

test("distances are rounded to something a person can act on", () => {
  assert.equal(formatDistance(84), "80 m");   // not "84 m" — GPS is not that precise
  assert.equal(formatDistance(1240), "1.2 km");
  assert.equal(formatDistance(14200), "14 km");
  assert.equal(formatDistance(null), null);
});

test("stops are followed in ORDER, not by whichever is nearest", () => {
  // Nearest-first would march the walker back and forth across the city.
  const standingNearSecond = [51.5127, -0.0836];
  const next = nextStop(stops, standingNearSecond);
  assert.equal(next.stop.id, "a"); // still the first unvisited stop
});

test("a visited stop is skipped", () => {
  const next = nextStop(stops, TRAFALGAR, { visitedIds: ["a"] });
  assert.equal(next.stop.id, "b");
});

test("arrival is a radius, because GPS noise makes the last few metres meaningless", () => {
  const almost = nextStop(stops, [51.5081, -0.1281]);
  assert.equal(almost.arrived, true);
  assert.ok(almost.distance_m <= ARRIVAL_RADIUS_M);

  const away = nextStop(stops, [51.512, -0.128]);
  assert.equal(away.arrived, false);
});

test("the banner stays short — a walking reader cannot parse a paragraph", () => {
  const arrived = walkBanner(nextStop(stops, TRAFALGAR));
  assert.match(arrived.title, /Trafalgar Square/);
  assert.match(arrived.detail, /on its own/); // hands-free is the promise

  const enRoute = walkBanner(nextStop(stops, [51.52, -0.13]));
  assert.match(enRoute.title, /^Next:/);
  assert.match(enRoute.detail, /min/);

  assert.deepEqual(walkBanner(null), {
    title: "Tour complete", detail: "Every stop visited.",
  });
});

test("with no position yet the banner says so instead of inventing a distance", () => {
  const banner = walkBanner(nextStop(stops, null));
  assert.match(banner.detail, /Waiting for your position/);
});

test("the safety reminder asks for nothing but attention", () => {
  assert.match(ROAD_SAFETY_REMINDER, /eyes on the road/i);
  assert.match(ROAD_SAFETY_REMINDER, /no tapping/i);
});

// --- the lock lifecycle ------------------------------------------------------

test("the lock is only held while walking AND visible", () => {
  assert.equal(shouldHoldLock({ walking: true, visible: true }), true);
  // A hidden page cannot hold a wake lock anyway — asking wastes battery.
  assert.equal(shouldHoldLock({ walking: true, visible: false }), false);
  assert.equal(shouldHoldLock({ walking: false, visible: true }), false);
});

test("returning to the tab RE-acquires the lock", () => {
  // The browser drops the lock whenever the page hides. Without re-acquiring, walk
  // mode silently stops working after the first glance at another app — which is
  // exactly the failure this feature exists to prevent.
  const walking = { walking: true, visible: true };
  const hidden = { walking: true, visible: false };

  assert.equal(lockAction({ walking: false, visible: true }, walking), "acquire");
  assert.equal(lockAction(walking, hidden), "release");
  assert.equal(lockAction(hidden, walking), "acquire"); // back from the background
  assert.equal(lockAction(walking, walking), "none");   // no churn while nothing changed
});

test("leaving walk mode releases the lock", () => {
  assert.equal(
    lockAction({ walking: true, visible: true }, { walking: false, visible: true }),
    "release",
  );
});

test("an unsupported browser is detectable, so the UI can say so", () => {
  // Safari only shipped Wake Lock in iOS 16.4; failing silently would leave the
  // walker wondering why the guide went quiet.
  assert.equal(wakeLockSupported({ wakeLock: { request: () => {} } }), true);
  assert.equal(wakeLockSupported({}), false);
  assert.equal(wakeLockSupported(null), false);
});
