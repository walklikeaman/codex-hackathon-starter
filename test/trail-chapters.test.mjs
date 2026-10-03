import assert from "node:assert/strict";
import test from "node:test";

import { ALL_CITIES } from "../app/lib/city-gazetteer.mjs";
import { CHAPTER_GAP_KM, defaultChapter, trailChapters } from "../app/lib/trail-chapters.mjs";

const stop = (sequence_index, place, position, walkable = true) => ({ id: place, sequence_index, place, position, walkable });

// Sherlock Holmes (2009), its trail as on prod: London, then Manchester, then Liverpool.
const sherlock = [
  stop(1, "Middle Temple Hall", [51.5119, -0.1109]),
  stop(2, "Brompton Cemetery", [51.4846, -0.1904]),
  stop(3, "College of Arms", [51.5122, -0.0987]),
  stop(4, "Manchester Town Hall", [53.4792, -2.2442]),
  stop(5, "Stanley Dock", [53.4216, -3.0002]),
];

test("a trail across cities is cut into one chapter per city, in the order the story reaches them", () => {
  const chapters = trailChapters(sherlock, { cities: ALL_CITIES });
  assert.deepEqual(chapters.map((chapter) => chapter.name), ["London", "Manchester Town Hall", "Liverpool"]);
  assert.deepEqual(chapters[0].stops.map((s) => s.sequence_index), [1, 2, 3]);
  assert.deepEqual(chapters.map((chapter) => chapter.index), [0, 1, 2]);
});

test("no chapter holds two stops further apart than a chapter gap, unless a city chains them", () => {
  for (const chapter of trailChapters(sherlock)) {
    for (const a of chapter.stops) for (const b of chapter.stops) {
      if (a !== b) assert.ok(Math.abs(a.position[0] - b.position[0]) < 1, `${a.place} / ${b.place}`);
    }
  }
  assert.ok(CHAPTER_GAP_KM < 100);
});

// The walker in London walks every London scene; a return to London is not a new chapter.
test("a story that leaves a city and comes back is still one chapter there, in plot order", () => {
  const roundTrip = [sherlock[0], { ...sherlock[3], sequence_index: 2 }, { ...sherlock[2], sequence_index: 3 }];
  const chapters = trailChapters(roundTrip, { cities: ALL_CITIES });
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters[0].stops.map((s) => s.place), ["Middle Temple Hall", "College of Arms"]);
});

// Love Actually opens at Heathrow; Four Weddings ends at Thurrock. They are 51 km apart —
// more than a chapter gap — and both under 30 km from Trafalgar Square, so chained
// through the city they stay one chapter rather than splitting London at its edges.
test("a city's spread is chained into one chapter rather than split at its edges", () => {
  const spread = [
    stop(1, "London Heathrow Airport", [51.47, -0.4543]),
    stop(2, "Trafalgar Square", [51.508, -0.128]),
    stop(3, "St Clement's Church West Thurrock", [51.474, 0.276]),
  ];
  assert.equal(trailChapters(spread).length, 1);
});

// Bourne Woods is 57 km out, by Farnham — which the gazetteer knows as a city of its own.
test("a location out of town is its own chapter, named by the town it is in", () => {
  const chapters = trailChapters([stop(1, "Trafalgar Square", [51.508, -0.128]), stop(2, "Bourne Woods", [51.193, -0.775])], { cities: ALL_CITIES });
  assert.deepEqual(chapters.map((chapter) => chapter.name), ["London", "Farnham"]);
});

test("a chapter outside the gazetteer is named by its first scene's place", () => {
  const [, manchester] = trailChapters(sherlock, { cities: ALL_CITIES });
  assert.equal(manchester.name, "Manchester Town Hall");
});

test("the walk opens on the chapter with the most walkable stops", () => {
  const chapters = trailChapters([
    stop(1, "Istanbul", [41.01, 28.96], false),
    stop(2, "Trafalgar Square", [51.508, -0.128]),
    stop(3, "National Gallery", [51.5089, -0.1283]),
  ]);
  assert.equal(defaultChapter(chapters, (s) => s.walkable), 1);
  assert.equal(defaultChapter([]), 0);
});

test("stops without a position are left out, and nothing breaks on none", () => {
  assert.deepEqual(trailChapters(null), []);
  assert.equal(trailChapters([stop(1, "Nowhere", null), sherlock[0]]).length, 1);
});
