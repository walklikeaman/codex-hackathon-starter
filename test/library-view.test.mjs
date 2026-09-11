import assert from "node:assert/strict";
import test from "node:test";

import { libraryEntryFor, libraryRating } from "../app/lib/media-library.mjs";
import {
  DEFAULT_SORT,
  NO_MINIMUM,
  RATING_STEPS,
  SORT,
  impliesLibraryOnly,
  isSortMode,
  passesLibraryFilter,
  ratingLabel,
  sortLabel,
  sortWorks,
} from "../app/lib/library-view.mjs";

// A slice of a real export: the two most common scores, an unrated film, and a 5★.
const LIBRARY = [
  { title: "Forrest Gump", year: 1994, rating: 5 },
  { title: "The Prestige", year: 2006, rating: 4.5 },
  { title: "Blade Runner", year: null, rating: 4 },
  { title: "Old School", year: 2003, rating: 3 },
  { title: "Léon: The Professional", year: 1994, rating: 4 },
  { title: "Reality", year: 2023, rating: null },
];

const work = (title, extra = {}) => ({ title, year: null, ...extra });

// ---------- the lookup both the sort and the filter use ----------

test("one lookup answers both questions, so they cannot disagree", () => {
  // A sort ordering by one matched row while the filter tested another would be invisible
  // and wrong.
  const entry = libraryEntryFor(work("The Prestige"), LIBRARY);
  assert.equal(entry.rating, 4.5);
  assert.equal(libraryRating(work("The Prestige"), LIBRARY), 4.5);
  assert.equal(libraryEntryFor(work("Dune"), LIBRARY), null);
  assert.equal(libraryRating(work("Dune"), LIBRARY), null);
});

test("an accented title still matches, because one normaliser is shared", () => {
  // "Léon" through NFKD without the accent strip becomes "leon" against "le on". A
  // library of 2,422 films once matched nothing it should have for exactly this.
  assert.equal(libraryRating(work("Leon: The Professional"), LIBRARY), 4);
});

test("watched and unrated is null, never zero", () => {
  // Not the same as bad, and every comparison has to decide what to do with it rather
  // than sorting it to the bottom by accident.
  assert.equal(libraryRating(work("Reality"), LIBRARY), null);
});

// ---------- ordering ----------

test("sorting by rating puts the best first", () => {
  const sorted = sortWorks(
    [work("Old School"), work("Forrest Gump"), work("The Prestige")],
    { by: SORT.rating, library: LIBRARY },
  );
  assert.deepEqual(sorted.map((w) => w.title), ["Forrest Gump", "The Prestige", "Old School"]);
});

test("an unrated film sinks below every rated one, including a film the reader disliked", () => {
  // Sorting "never scored" as a zero would put it underneath something actively disliked,
  // which says something the reader did not.
  const disliked = [...LIBRARY, { title: "Cats", year: 2019, rating: 0.5 }];
  const sorted = sortWorks([work("Reality"), work("Cats"), work("Old School")], {
    by: SORT.rating, library: disliked,
  });
  assert.deepEqual(sorted.map((w) => w.title), ["Old School", "Cats", "Reality"]);
});

test("a work that is not in the library at all sorts with the unrated", () => {
  const sorted = sortWorks([work("Dune"), work("Forrest Gump")], { by: SORT.rating, library: LIBRARY });
  assert.deepEqual(sorted.map((w) => w.title), ["Forrest Gump", "Dune"]);
});

test("ties fall through to how much we hold, then to the title", () => {
  // 3.5★ is the single most common score in a real export and 39.8% of works hold exactly
  // one place, so ties are the normal case, not the edge one. Without a final key the
  // list reshuffles itself between renders.
  const library = [
    { title: "Alpha", year: null, rating: 4 },
    { title: "Bravo", year: null, rating: 4 },
    { title: "Charlie", year: null, rating: 4 },
  ];
  const sorted = sortWorks(
    [work("Charlie", { place_count: 2 }), work("Alpha", { place_count: 2 }), work("Bravo", { place_count: 9 })],
    { by: SORT.rating, library },
  );
  assert.deepEqual(sorted.map((w) => w.title), ["Bravo", "Alpha", "Charlie"]);
});

test("the place count is read under every name its callers use", () => {
  // The map's chips, the city page and a candidate all count the same thing and none of
  // them spell it the same way.
  const shapes = [
    work("A", { place_count: 3 }),
    work("B", { placeCount: 7 }),
    work("C", { places: ["x", "y", "z", "w", "v"] }),
    work("D", { la_rows: 9 }),
  ];
  assert.deepEqual(sortWorks(shapes, { by: SORT.places }).map((w) => w.title), ["D", "B", "C", "A"]);
});

test("sorting never mutates what it was given", () => {
  const input = [work("Old School"), work("Forrest Gump")];
  sortWorks(input, { by: SORT.rating, library: LIBRARY });
  assert.deepEqual(input.map((w) => w.title), ["Old School", "Forrest Gump"]);
});

test("the default order is what there is to go and see, not anybody's opinion", () => {
  assert.equal(DEFAULT_SORT, SORT.places);
  assert.equal(isSortMode("rating"), true);
  assert.equal(isSortMode("whatever"), false);
});

// ---------- narrowing ----------

test("with no filters on, everything passes and the library is never consulted", () => {
  assert.equal(passesLibraryFilter(work("Dune"), { library: LIBRARY }), true);
});

test("only-mine keeps the library and drops the rest", () => {
  assert.equal(passesLibraryFilter(work("Forrest Gump"), { library: LIBRARY, mineOnly: true }), true);
  assert.equal(passesLibraryFilter(work("Dune"), { library: LIBRARY, mineOnly: true }), false);
});

test("a minimum rating keeps what clears the bar", () => {
  const at4 = { library: LIBRARY, minRating: 4 };
  assert.equal(passesLibraryFilter(work("Forrest Gump"), at4), true);
  assert.equal(passesLibraryFilter(work("Blade Runner"), at4), true, "exactly at the bar clears it");
  assert.equal(passesLibraryFilter(work("Old School"), at4), false);
});

test("an unrated film fails a minimum, and that is the intended reading", () => {
  // "Show me my 4-star films" is not a request to also see the ones never scored.
  assert.equal(passesLibraryFilter(work("Reality"), { library: LIBRARY, minRating: 4 }), false);
  assert.equal(passesLibraryFilter(work("Reality"), { library: LIBRARY, mineOnly: true }), true);
});

test("a minimum rating implies only-mine, because it cannot mean anything else", () => {
  // Without this the filter silently drops every film NOT in the library — which is most
  // of the map — and reads as an outage.
  assert.equal(impliesLibraryOnly(NO_MINIMUM), false);
  assert.equal(impliesLibraryOnly(4), true);
  assert.equal(passesLibraryFilter(work("Dune"), { library: LIBRARY, minRating: 4, mineOnly: false }), false);
});

test("the steps are half-stars, because there is no such rating as 3.7", () => {
  assert.deepEqual(RATING_STEPS, [3, 3.5, 4, 4.5, 5]);
  for (const step of RATING_STEPS) assert.equal(step * 2, Math.round(step * 2));
});

test("a whole-number rating is not printed with a trailing zero", () => {
  // "4.0★" reads as a precision Letterboxd does not have.
  assert.equal(ratingLabel(4), "4★");
  assert.equal(ratingLabel(4.5), "4.5★");
  assert.equal(ratingLabel(null), null);
});

test("the control names its tie-breaker", () => {
  // A reader who sorts by rating and sees two 4★ films in a row is owed the reason one is
  // above the other.
  assert.match(sortLabel(SORT.rating), /then how much we hold/);
  assert.equal(sortLabel(SORT.title), "A–Z");
  assert.equal(sortLabel(SORT.places), "How much we hold");
});

// ---------- the year, and the two ways it can be right ----------

test("a premiere and its release are one film", async () => {
  const { YEAR_TOLERANCE, libraryEntryFor } = await import("../app/lib/media-library.mjs");
  assert.equal(YEAR_TOLERANCE, 1);
  // Measured against a real export: 9 of 298 backfilled works land one year from the
  // reader's own. Kingsman opened in the UK in 2014 and in the US in 2015; Reservoir Dogs
  // premiered at Sundance in January 1992 and Letterboxd dates it 1991. Neither side is
  // wrong, and a strict match would drop both from the reader's list.
  const library = [
    { title: "Kingsman: The Secret Service", year: 2014, rating: 4 },
    { title: "Reservoir Dogs", year: 1991, rating: 4.5 },
  ];
  assert.ok(libraryEntryFor({ title: "Kingsman: The Secret Service", year: 2015 }, library));
  assert.ok(libraryEntryFor({ title: "Reservoir Dogs", year: 1992 }, library));
});

test("a remake is not the film it remade", async () => {
  const { libraryEntryFor } = await import("../app/lib/media-library.mjs");
  // The collision the year exists to stop. 24 of 298 were this: same title, different
  // work. Before the backfill every one of them matched.
  const library = [
    { title: "Ghostbusters", year: 1984, rating: 4 },
    { title: "Star Trek", year: 2009, rating: 4 },
    { title: "A Star Is Born", year: 2018, rating: 3.5 },
  ];
  assert.equal(libraryEntryFor({ title: "Ghostbusters", year: 2016 }, library), null);
  assert.equal(libraryEntryFor({ title: "Star Trek", year: 1966 }, library), null);
  assert.equal(libraryEntryFor({ title: "A Star Is Born", year: 1937 }, library), null);
  // And the right one still matches.
  assert.ok(libraryEntryFor({ title: "Ghostbusters", year: 1984 }, library));
});

test("a year missing on either side still matches, because a null cannot separate anything", async () => {
  const { libraryEntryFor } = await import("../app/lib/media-library.mjs");
  const library = [{ title: "Blade Runner", year: 1982, rating: 4 }];
  assert.ok(libraryEntryFor({ title: "Blade Runner", year: null }, library));
  assert.ok(libraryEntryFor({ title: "Blade Runner" }, [{ title: "Blade Runner", year: null }]));
});

test("the sort follows the year, so two same-titled films keep their own scores", async () => {
  const { libraryRating } = await import("../app/lib/media-library.mjs");
  const library = [
    { title: "Ghostbusters", year: 1984, rating: 4.5 },
    { title: "Ghostbusters", year: 2016, rating: 2 },
  ];
  assert.equal(libraryRating({ title: "Ghostbusters", year: 1984 }, library), 4.5);
  assert.equal(libraryRating({ title: "Ghostbusters", year: 2016 }, library), 2);
});

// ---------- the public score, beside the reader's own ----------

test("the two rating filters are independent, and both can be on", async () => {
  const { passesImdbFilter } = await import("../app/lib/library-view.mjs");
  // "Films I rated 4★ AND the world rated 7.5" is a real question and neither filter
  // answers it alone.
  const film = { title: "Heat", year: 1995, imdb: 8.3 };
  assert.equal(passesImdbFilter(film, 7.5), true);
  assert.equal(passesImdbFilter(film, 8.5), false);
  assert.equal(passesLibraryFilter(film, { library: [{ title: "Heat", year: 1995, rating: 4.5 }], minRating: 4 }), true);
});

test("no public bar lets everything through, unrated included", async () => {
  const { NO_MINIMUM, passesImdbFilter } = await import("../app/lib/library-view.mjs");
  assert.equal(passesImdbFilter({ imdb: null }, NO_MINIMUM), true);
  assert.equal(passesImdbFilter({}, NO_MINIMUM), true);
});

test("an unrated film fails a public bar, exactly as it fails the reader's own", async () => {
  const { passesImdbFilter } = await import("../app/lib/library-view.mjs");
  // 123 of the 1,642 Los Angeles works carry no IMDb rating. Letting them through a
  // "7.5 and up" filter would put unknown films among the ones asked for. Null is not a
  // score.
  assert.equal(passesImdbFilter({ imdb: null }, 7.5), false);
  assert.equal(passesImdbFilter({ imdb: undefined }, 7), false);
  assert.equal(passesImdbFilter({ imdb: 0 }, 7), false);
});

test("IMDb's steps are out of ten, not out of five", async () => {
  const { IMDB_STEPS, imdbLabel } = await import("../app/lib/library-view.mjs");
  assert.ok(IMDB_STEPS.every((s) => s >= 6 && s <= 10));
  // And they are printed without a trailing zero, like the star ratings.
  assert.equal(imdbLabel(7), "7");
  assert.equal(imdbLabel(7.5), "7.5");
});
