import assert from "node:assert/strict";
import test from "node:test";

import {
  TOUR_BUDGET_TOLERANCE,
  createFallbackGuide,
  createTimedTourCandidates,
  routeFitsBudget,
} from "../app/lib/timed-tour.mjs";

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
