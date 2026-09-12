import test from "node:test";
import assert from "node:assert/strict";

import { MIN_VOTES, labelledPlaces, notability, notableHere } from "../app/lib/notable-here.mjs";

// Real rows from the Los Angeles set, so the ordering can be checked against what a person
// would answer if asked what the city is known for.
const forrestGump = { title: "Forrest Gump", imdb: 8.8, imdb_votes: 2532967 };
const lebowski = { title: "The Big Lebowski", imdb: 8.1, imdb_votes: 924249 };
const ninetyTwoTen = { title: "90210", imdb: 6.2, imdb_votes: 47724 };
const fredAndVinnie = { title: "Fred & Vinnie", imdb: 5.9, imdb_votes: 165 };

// The whole point of the module: rating alone is the wrong ranking.
test("a beloved obscurity does not outrank a famous film", () => {
  const cult = { title: "Seen By Nobody", imdb: 9.4, imdb_votes: 1200 };
  const [first] = notableHere([cult, forrestGump]);
  assert.equal(first.title, "Forrest Gump");
});

// And the opposite fault: votes alone would rank by how many watched, not by what is worth
// walking to.
test("a widely seen bad film does not outrank a great one with fewer voters", () => {
  const seenByAll = { title: "Everyone Watched It", imdb: 4.2, imdb_votes: 3000000 };
  const [first] = notableHere([seenByAll, forrestGump]);
  assert.equal(first.title, "Forrest Gump");
});

test("the order matches what a person would say the city is known for", () => {
  const ranked = notableHere([ninetyTwoTen, fredAndVinnie, lebowski, forrestGump]);
  assert.deepEqual(ranked.map((film) => film.title), ["Forrest Gump", "The Big Lebowski", "90210"]);
});

// 165 voters decide a score to one decimal place. That is not a measurement.
test("a work below the vote floor is excluded, not merely demoted", () => {
  assert.equal(notability(fredAndVinnie), null);
  assert.equal(notableHere([fredAndVinnie]).length, 0);
});

test("the floor is a floor, not a rounding", () => {
  assert.equal(notability({ imdb: 8, imdb_votes: MIN_VOTES - 1 }), null);
  assert.ok(notability({ imdb: 8, imdb_votes: MIN_VOTES }) > 0);
});

test("a work with no rating at all is left out rather than scored as zero", () => {
  assert.equal(notability({ title: "Unrated", imdb: null, imdb_votes: 90000 }), null);
  assert.equal(notability({ title: "Unvoted", imdb: 7.5, imdb_votes: null }), null);
  assert.equal(notableHere([{ title: "Unrated" }, forrestGump]).length, 1);
});

// A list that reshuffles while the map is nudged is a list nobody can use.
test("ties break on the title, so the order is stable", () => {
  const a = { title: "Bravo", imdb: 7, imdb_votes: 10000 };
  const b = { title: "Alpha", imdb: 7, imdb_votes: 10000 };
  assert.deepEqual(notableHere([a, b]).map((f) => f.title), ["Alpha", "Bravo"]);
  assert.deepEqual(notableHere([b, a]).map((f) => f.title), ["Alpha", "Bravo"]);
});

test("the list is capped, and the cap is honoured", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    title: `Film ${String(i).padStart(2, "0")}`, imdb: 7, imdb_votes: 10000 + i,
  }));
  assert.equal(notableHere(many).length, 5);
  assert.equal(notableHere(many, { limit: 3 }).length, 3);
  assert.equal(notableHere(many, { limit: 0 }).length, 0);
});

test("nothing in gives nothing out rather than throwing", () => {
  assert.deepEqual(notableHere(null), []);
  assert.deepEqual(notableHere(undefined), []);
  assert.equal(notability(null), null);
});

// A thousand labels is the same as none: they collide, they cover the streets, and the eye
// has nowhere to land. The label is scarce on purpose.
test("only the best-known places are given a name on the pin", () => {
  const films = [
    { ...forrestGump, places: [{ lat: 34.1, lng: -118.3 }] },
    { ...lebowski, places: [{ lat: 34.2, lng: -118.4 }] },
    { ...ninetyTwoTen, places: [{ lat: 34.3, lng: -118.5 }] },
  ];
  const labels = labelledPlaces(films, { limit: 2 });
  assert.equal(labels.size, 2);
  assert.equal(labels.get("34.1,-118.3"), "Forrest Gump");
  assert.equal(labels.get("34.2,-118.4"), "The Big Lebowski");
  assert.equal(labels.has("34.3,-118.5"), false);
});

// The cap that matters is the number of words drawn over the streets. Capping the FILMS
// and then labelling every place each one holds is not a cap: one film holds up to 96
// places at one address in this data set.
test("the cap counts labels, not films", () => {
  const crowded = Array.from({ length: 3 }, (_, film) => ({
    title: `Film ${film}`,
    imdb: 8,
    imdb_votes: 100000 - film,
    places: Array.from({ length: 40 }, (_, i) => ({ lat: 34 + film + i / 100, lng: -118 - i / 100 })),
  }));
  assert.equal(labelledPlaces(crowded, { limit: 8 }).size, 8);
});

// And the eighth label may have to come from the twentieth film, when the best-known ones
// all sit at one address.
test("a label is found past the top few films when they share a place", () => {
  const shared = { lat: 34.1, lng: -118.3 };
  const films = [
    { ...forrestGump, places: [shared] },
    { ...lebowski, places: [shared] },
    { ...ninetyTwoTen, places: [{ lat: 34.9, lng: -118.9 }] },
  ];
  const labels = labelledPlaces(films, { limit: 2 });
  assert.deepEqual([...labels.values()], ["Forrest Gump", "90210"]);
});

// A place shared by two works is named after the one people came for.
test("a shared place takes the name of the better-known work", () => {
  const shared = { lat: 34.1, lng: -118.3 };
  const labels = labelledPlaces([
    { ...lebowski, places: [shared] },
    { ...forrestGump, places: [shared] },
  ]);
  assert.equal(labels.get("34.1,-118.3"), "Forrest Gump");
});

test("a place with no coordinate cannot be labelled", () => {
  const labels = labelledPlaces([{ ...forrestGump, places: [{ lat: null, lng: null }] }]);
  assert.equal(labels.size, 0);
});
