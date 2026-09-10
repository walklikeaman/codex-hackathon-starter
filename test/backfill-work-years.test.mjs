import assert from "node:assert/strict";
import test from "node:test";

import { yearFromFindPayload } from "../scripts/backfill-work-years.mjs";

// TMDB's `find` answers with a bag of arrays, one per media type, and the id we ask about
// lands in exactly one of them. These are the shapes it actually returns.

test("a film's year comes from its release date", () => {
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: "1995-09-22" }] }), 1995);
});

test("a series' year comes from its first air date", () => {
  // 6,038 of the year-less works are addressed by IMDb id and some of them are series;
  // reading only `release_date` would leave every one of them null.
  assert.equal(yearFromFindPayload({ tv_results: [{ first_air_date: "2014-05-11" }] }), 2014);
});

test("an id TMDB does not know answers null, not a guess", () => {
  assert.equal(yearFromFindPayload({ movie_results: [], tv_results: [] }), null);
  assert.equal(yearFromFindPayload({}), null);
  assert.equal(yearFromFindPayload(null), null);
});

test("an empty date is not the year zero", () => {
  // TMDB returns `release_date: ""` for a title it holds without a date. `Number("".slice(0,4))`
  // is 0, and 0 is an integer — this project has shipped that class of bug four times
  // with coordinates.
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: "" }] }), null);
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: null }] }), null);
  assert.equal(yearFromFindPayload({ movie_results: [{}] }), null);
});

test("a date outside cinema is a parse error, not a release", () => {
  // The Lumière brothers are 1895. Anything before film existed, or more than two years
  // out, came from a malformed field rather than from a projector.
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: "0202-01-01" }] }), null);
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: "9999-01-01" }] }), null);
  assert.equal(yearFromFindPayload({ movie_results: [{ release_date: "1895-12-28" }] }), 1895);
});

test("a dateless first result does not hide a dated second one", () => {
  assert.equal(
    yearFromFindPayload({ movie_results: [{ release_date: "" }, { release_date: "1977-05-25" }] }),
    1977,
  );
});

test("a film wins over a series when both answer", () => {
  // The order is fixed rather than incidental: an id that lands in both buckets is a film
  // with a making-of series or similar, and the film is the work we hold.
  assert.equal(
    yearFromFindPayload({
      movie_results: [{ release_date: "1982-06-25" }],
      tv_results: [{ first_air_date: "2021-01-01" }],
    }),
    1982,
  );
});
