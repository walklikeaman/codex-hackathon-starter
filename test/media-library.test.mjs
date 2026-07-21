import test from "node:test";
import assert from "node:assert/strict";
import { mergeLibraries, parseMediaCsv } from "../app/lib/media-library.mjs";

test("parses a Letterboxd ratings export", () => {
  const movies = parseMediaCsv(
    'Date,Name,Year,Letterboxd URI,Rating\n2026-07-20,"Paris, Texas",1984,https://letterboxd.com/film/paris-texas/,4.5',
    "letterboxd",
  );

  assert.deepEqual(movies[0], {
    id: "letterboxd:paris-texas:1984",
    title: "Paris, Texas",
    year: 1984,
    rating: 4.5,
    watchedDate: "2026-07-20",
    url: "https://letterboxd.com/film/paris-texas/",
    imdbId: null,
    sources: ["letterboxd"],
  });
});

test("parses an IMDb ratings export", () => {
  const [movie] = parseMediaCsv(
    "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Year\ntt0111161,10,2026-07-19,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,movie,9.3,1994",
    "imdb",
  );

  assert.equal(movie.imdbId, "tt0111161");
  assert.equal(movie.rating, 10);
  assert.equal(movie.year, 1994);
});

test("merges duplicate movies and preserves both sources", () => {
  const letterboxd = parseMediaCsv("Name,Year,Rating\nHeat,1995,4.5", "letterboxd");
  const imdb = parseMediaCsv("Title,Year,Your Rating\nHeat,1995,9", "imdb");
  const merged = mergeLibraries(letterboxd, imdb);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["letterboxd", "imdb"]);
  assert.equal(merged[0].rating, 9);
});
