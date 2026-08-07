import assert from "node:assert/strict";
import test from "node:test";

import {
  libraryImportSummary,
  matchLibrary,
  matchOne,
  indexLibrary,
} from "../app/lib/library-match.mjs";
import { normalizedTitleForTest } from "../app/lib/media-library.mjs";

const catalogue = [
  { id: "w1", title_norm: "amelie", year: 2001, kind: "film", imdb_id: "tt0211915", tmdb_id: null, place_count: 7 },
  { id: "w2", title_norm: "gladiator", year: 2000, kind: "film", imdb_id: "tt0172495", tmdb_id: null, place_count: 4 },
  { id: "w3", title_norm: "gladiator", year: 1992, kind: "film", imdb_id: "tt0104346", tmdb_id: null, place_count: 1 },
  { id: "w4", title_norm: "skyfall", year: 2012, kind: "film", imdb_id: "tt1074638", tmdb_id: "37724", place_count: 23 },
];

// --- the bug this module exists for ---------------------------------------------

test("a library is matched against the catalogue, not against a city", () => {
  // Reported: 2,422 films imported, "0 mapped titles". The count was computed against the
  // eleven works the map was drawing in London.
  const library = [
    { title: "Amélie", year: 2001 },
    { title: "Skyfall", year: 2012 },
    { title: "A Film We Do Not Hold", year: 1999 },
  ];
  const result = matchLibrary(library, catalogue);
  assert.equal(result.considered, 3);
  assert.equal(result.works, 2);
  assert.equal(result.places, 30);
});

test("an accented title matches, which it did not before", () => {
  // The library normaliser and the catalogue's `title_norm` differed by one line: this one
  // lacked the combining-accent strip, so NFKD made "Amélie" into "ame lie" against a
  // catalogue holding "amelie". Every accented title in a 2,422-film library missed.
  assert.equal(normalizedTitleForTest("Amélie"), "amelie");
  assert.equal(normalizedTitleForTest("Léon: The Professional"), "leon the professional");
  assert.ok(matchOne({ title: "Amélie", year: 2001 }, indexLibrary(catalogue)));
});

// --- an identifier beats a name, and a name needs a year -------------------------

test("an identifier is accepted outright", () => {
  const index = indexLibrary(catalogue);
  // The title is wrong and the id is right: the id wins, because a title is not an
  // identifier and this one is.
  assert.equal(matchOne({ title: "Something Else", imdbId: "tt1074638" }, index)?.id, "w4");
  assert.equal(matchOne({ title: "Something Else", tmdbId: 37724 }, index)?.id, "w4");
});

test("a title shared by two films is refused without a year", () => {
  // Gladiator is two films. Picking either would be inventing an answer.
  const index = indexLibrary(catalogue);
  assert.equal(matchOne({ title: "Gladiator" }, index), null);
  assert.equal(matchOne({ title: "Gladiator", year: 2000 }, index)?.id, "w2");
  assert.equal(matchOne({ title: "Gladiator", year: 1992 }, index)?.id, "w3");
  // A year neither of them has is not a near miss, it is a different film.
  assert.equal(matchOne({ title: "Gladiator", year: 2015 }, index), null);
});

test("a unique title with a disagreeing year is refused", () => {
  const index = indexLibrary(catalogue);
  assert.equal(matchOne({ title: "Skyfall", year: 1998 }, index), null);
  // And a library row with no year still matches a title only we hold.
  assert.equal(matchOne({ title: "Skyfall" }, index)?.id, "w4");
});

test("one work is counted once however many library rows reach it", () => {
  const result = matchLibrary(
    [{ title: "Skyfall", year: 2012 }, { title: "Skyfall", imdbId: "tt1074638" }],
    catalogue,
  );
  assert.equal(result.works, 1);
  assert.equal(result.places, 23);
});

test("an empty library and an empty catalogue answer without throwing", () => {
  assert.deepEqual(matchLibrary([], catalogue).works, 0);
  assert.deepEqual(matchLibrary(null, null).works, 0);
  assert.equal(matchOne(null, indexLibrary(catalogue)), null);
});

// --- the sentence the user actually reads ----------------------------------------

test("the summary names what we HOLD before what is on screen", () => {
  // The old message said only the second number, which is how "0 mapped titles" came to
  // mean "none of your films is on the screen right now".
  const line = libraryImportSummary({
    imported: 2422, works: 214, places: 1904, cityName: "London", inCity: 11,
  });
  assert.match(line, /2422 films imported/);
  assert.match(line, /we hold 214 of them/);
  assert.match(line, /1904 places/);
  assert.match(line, /11 on the map in London/);
  // The held count comes first: it is the answer to "do you have my films".
  assert.ok(line.indexOf("we hold") < line.indexOf("on the map"));
});

test("holding none of them says so without inventing a place count", () => {
  const line = libraryImportSummary({ imported: 40, works: 0, places: 0, cityName: "Paris", inCity: 0 });
  assert.match(line, /we hold 0 of them/);
  assert.ok(!line.includes("0 places"));
});
