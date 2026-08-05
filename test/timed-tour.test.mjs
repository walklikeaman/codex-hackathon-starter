import assert from "node:assert/strict";
import test from "node:test";

import {
  TOUR_BUDGET_TOLERANCE,
  createFallbackGuide,
  createTimedTourCandidates,
  routeFitsBudget,
} from "../app/lib/timed-tour.mjs";
import { ACCESS } from "../app/lib/place-access.mjs";

const locations = [
  { id: "a", place: "A", film: "Film A", description: "A story", position: [51.5000, -0.1000] },
  { id: "b", place: "B", film: "Film B", description: "B story", position: [51.5010, -0.1010] },
  { id: "c", place: "C", film: "Film C", description: "C story", position: [51.5020, -0.1020] },
  { id: "d", place: "D", film: "Film D", description: "D story", position: [51.5030, -0.1030] },
  { id: "e", place: "E", film: "Film E", description: "E story", position: [51.5040, -0.1040] },
];

test("creates a deterministic 3-5 stop candidate within the time tolerance", () => {
  const candidates = createTimedTourCandidates(locations, [51.5, -0.1], 30);

  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].stops.length, 5);
  assert.ok(candidates[0].estimatedMinutes <= 30 * TOUR_BUDGET_TOLERANCE);
  assert.deepEqual(
    candidates[0].stops.map((stop) => stop.id),
    ["a", "b", "c", "d", "e"],
  );
});

test("deduplicates locations before planning", () => {
  const duplicate = { ...locations[0], place: "Duplicate A" };
  const candidates = createTimedTourCandidates(
    [...locations.slice(0, 3), duplicate],
    [51.5, -0.1],
    60,
  );

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const ids = candidate.stops.map((stop) => stop.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("combines different films at the same physical stop", () => {
  const sharedPlace = {
    ...locations[0],
    id: "same-place-different-film",
    filmId: "film-b",
    film: "Another Film",
  };
  const candidates = createTimedTourCandidates(
    [sharedPlace, ...locations],
    [51.5, -0.1],
    60,
  );

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const places = candidate.stops.map((stop) => stop.place);
    assert.equal(new Set(places).size, places.length);
  }
  assert.deepEqual(candidates[0].stops[0].films, ["Another Film", "Film A"]);
});

test("requires at least three valid unique stops", () => {
  assert.deepEqual(
    createTimedTourCandidates(locations.slice(0, 2), [51.5, -0.1], 30),
    [],
  );
});

test("checks measured walking time against the 15 percent tolerance", () => {
  assert.equal(routeFitsBudget({ durationMinutes: 34.5 }, 30), true);
  assert.equal(routeFitsBudget({ durationMinutes: 35 }, 30), false);
});

test("builds a verified-description fallback guide", () => {
  const guide = createFallbackGuide({
    city: "London",
    budgetMinutes: 60,
    stops: locations.slice(0, 3),
  });

  assert.match(guide.title, /60-minute/);
  assert.deepEqual(
    guide.stops.map((stop) => stop.locationId),
    ["a", "b", "c"],
  );
  assert.equal(guide.stops[0].narration, "A story");
});

// --- access: showing a place and routing to it are different promises -------------------

test("a place OpenStreetMap says is closed is never routed to", () => {
  // The one verdict that removes a stop outright. Everything else is a preference,
  // because access coverage is thin; "closed" is not thin, it is an answer.
  const candidates = createTimedTourCandidates(locations, [51.5, -0.1], 30, {
    access: { c: { access: ACCESS.closed } },
  });

  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(!candidate.stops.some((stop) => stop.id === "c"));
  }
});

test("among equal-length tours, the one we can vouch for wins", () => {
  // Measured against twelve real tour stops, OSM knows about four — and all four are in
  // cities. Excluding every unknown would produce no Scottish tour at all, so an
  // unknown is ranked BELOW a confirmed stop rather than deleted.
  const confirmed = createTimedTourCandidates(locations, [51.5, -0.1], 30, {
    access: {
      c: { access: ACCESS.open },
      d: { access: ACCESS.ticketed },
      e: { access: ACCESS.view_only },
    },
  });

  const best = confirmed[0];
  assert.equal(best.confirmedStops, 3);
  // Every three-stop tour that could have been all-confirmed is ranked above one that
  // could not — the comparison the ordering exists to make.
  const threeStop = confirmed.filter((candidate) => candidate.stops.length === 3);
  assert.deepEqual(
    [...threeStop].sort((left, right) => right.confirmedStops - left.confirmedStops)
      .map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
    threeStop.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
  );
});

test("no access knowledge plans exactly the tour it planned before", () => {
  // The degraded path is the common one — a busy Overpass, a stop nobody has tagged —
  // and it must cost the labels, never the tour.
  const withNothing = createTimedTourCandidates(locations, [51.5, -0.1], 30, { access: null });
  const original = createTimedTourCandidates(locations, [51.5, -0.1], 30);

  assert.deepEqual(
    withNothing.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
    original.map((candidate) => candidate.stops.map((stop) => stop.id).join("")),
  );
  assert.equal(withNothing[0].confirmedStops, 0);
});

test("access is looked up by the place id the map carries, not the row id", () => {
  // A location's `locationId` is the place; `id` is the work-and-place pair. Two films
  // shot at one address share the place and must share its access.
  const shared = [
    { ...locations[0], id: "film1-Q1", locationId: "Q1" },
    { ...locations[1], id: "film2-Q1", locationId: "Q1" },
    { ...locations[2], id: "film3-Q2", locationId: "Q2" },
    { ...locations[3], id: "film4-Q3", locationId: "Q3" },
  ];
  const candidates = createTimedTourCandidates(shared, [51.5, -0.1], 60, {
    access: { Q1: { access: ACCESS.closed } },
  });

  for (const candidate of candidates) {
    assert.ok(!candidate.stops.some((stop) => stop.locationId === "Q1"));
  }
});
