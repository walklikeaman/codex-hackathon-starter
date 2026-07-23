import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupWorkRows,
  libraryItemsFromLetterboxd,
  normalizeWorkTitle,
  workNaturalKey,
  worksFromLetterboxd,
} from "../app/lib/content-graph.mjs";

test("normalizeWorkTitle folds to a-z0-9 (NFKD)", () => {
  assert.equal(normalizeWorkTitle("Amélie & Co"), "amelie co");
  assert.equal(normalizeWorkTitle("  The  Matrix!! "), "the matrix");
  assert.equal(normalizeWorkTitle(""), "");
  assert.equal(normalizeWorkTitle(null), "");
});

test("workNaturalKey prefers an external id, else title+year", () => {
  assert.equal(workNaturalKey({ tmdb_id: "509" }), "tmdb:509");
  assert.equal(workNaturalKey({ imdb_id: "tt0125439" }), "imdb:tt0125439");
  assert.equal(workNaturalKey({ title_norm: "notting hill", year: 1999 }), "title:notting hill:1999");
  assert.equal(workNaturalKey({ title_norm: "x" }), "title:x:");
});

test("worksFromLetterboxd maps films to canonical works rows", () => {
  const rows = worksFromLetterboxd([
    { title: "Notting Hill", year: 1999, tmdbId: "509", rating: 4 },
    { title: "Amélie & Co", year: 2001, tmdbId: "194", rating: null },
  ]);
  assert.deepEqual(rows[0], {
    kind: "film",
    tmdb_id: "509",
    imdb_id: null,
    title: "Notting Hill",
    title_norm: "notting hill",
    year: 1999,
  });
  assert.equal(rows[1].title_norm, "amelie co");
});

test("worksFromLetterboxd drops items without a title or tmdb id", () => {
  const rows = worksFromLetterboxd([
    { title: "", tmdbId: "1" },
    { title: "No Id", tmdbId: null },
    { title: "!!!", tmdbId: "2" }, // normalizes to empty → dropped
  ]);
  assert.equal(rows.length, 0);
});

test("dedupWorkRows keeps one row per real work by tmdb id", () => {
  const rows = dedupWorkRows([
    { tmdb_id: "509", title_norm: "notting hill", year: 1999 },
    { tmdb_id: "509", title_norm: "notting hill", year: 1999 }, // dup
    { tmdb_id: "194", title_norm: "amelie co", year: 2001 },
  ]);
  assert.equal(rows.length, 2);
});

test("libraryItemsFromLetterboxd builds unique per-work entries with source + rating", () => {
  const entries = libraryItemsFromLetterboxd([
    { tmdbId: "509", rating: 4 },
    { tmdbId: "509", rating: 5 }, // same work → first wins
    { tmdbId: "194", rating: null },
  ]);
  assert.deepEqual(entries, [
    { naturalKey: "tmdb:509", source: "letterboxd", rating: 4 },
    { naturalKey: "tmdb:194", source: "letterboxd", rating: null },
  ]);
});
