import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseLetterboxdArchive } from "../app/lib/letterboxd-archive.mjs";
import {
  RATING_SCALE,
  mergeLibraries,
  parseMediaCsv,
  toTenPoint,
  upgradeLibraryScale,
  workIsInLibrary,
} from "../app/lib/media-library.mjs";

test("parses a Letterboxd ratings export", () => {
  const movies = parseMediaCsv(
    'Date,Name,Year,Letterboxd URI,Rating\n2026-07-20,"Paris, Texas",1984,https://letterboxd.com/film/paris-texas/,4.5',
    "letterboxd",
  );

  // 4.5 stars out of five arrives as 9 out of ten: one scale in the library, converted
  // at the edge, so nothing downstream has to ask which service a number came from.
  assert.deepEqual(movies[0], {
    id: "letterboxd:paris-texas:1984",
    title: "Paris, Texas",
    year: 1984,
    rating: 9,
    ratingScale: 10,
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

test("the two services' scales meet as one number", () => {
  // The point of converting at the edge: 4.5 stars and 9/10 are the SAME opinion, and
  // before this they were two numbers that sorted and filtered against each other.
  assert.equal(toTenPoint(4.5, "letterboxd"), 9);
  assert.equal(toTenPoint(9, "imdb"), 9);
  assert.equal(toTenPoint(5, "letterboxd"), 10);
  assert.equal(toTenPoint(0.5, "letterboxd"), 1);
  // Unrated stays unrated. Watched-and-never-scored is not a zero.
  assert.equal(toTenPoint(null, "imdb"), null);
  assert.equal(toTenPoint(0, "letterboxd"), null);
});

test("a library saved on the old scale is upgraded, and upgrading twice changes nothing", () => {
  // Every reader has one of these in localStorage. Doubling it on every read instead of
  // once would walk 0.5 up to 1, then 2, then 4 — which is why the marker exists and the
  // migration is not a guess about the value.
  const stored = [
    { title: "Heat", year: 1995, rating: 4.5, sources: ["letterboxd"] },
    { title: "Paris, Texas", year: 1984, rating: 0.5, sources: ["letterboxd"] },
    { title: "Arrival", year: 2016, rating: null, sources: ["letterboxd"] },
  ];

  const once = upgradeLibraryScale(stored);
  assert.deepEqual(once.map((movie) => movie.rating), [9, 1, null]);
  assert.deepEqual(once.map((movie) => movie.ratingScale), [RATING_SCALE, RATING_SCALE, RATING_SCALE]);

  assert.deepEqual(upgradeLibraryScale(once).map((movie) => movie.rating), [9, 1, null]);
  assert.deepEqual(upgradeLibraryScale(upgradeLibraryScale(once)).map((movie) => movie.rating), [9, 1, null]);
});

test("an IMDb row saved before the marker existed is left where it is", () => {
  // It was already out of ten. Converting it would be the corruption, not the fix.
  const [movie] = upgradeLibraryScale([{ title: "Heat", rating: 7, sources: ["imdb"] }]);
  assert.equal(movie.rating, 7);
  assert.equal(movie.ratingScale, RATING_SCALE);
});

test("merges duplicate movies and preserves both sources", () => {
  const letterboxd = parseMediaCsv("Name,Year,Rating\nHeat,1995,4.5", "letterboxd");
  const imdb = parseMediaCsv("Title,Year,Your Rating\nHeat,1995,9", "imdb");
  const merged = mergeLibraries(letterboxd, imdb);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["letterboxd", "imdb"]);
  assert.equal(merged[0].rating, 9);
});

test("imports and merges watched and ratings files from a Letterboxd ZIP", async () => {
  const archive = new JSZip();
  archive.file("watched.csv", "Date,Name,Year,Letterboxd URI\n2026-07-20,Heat,1995,https://boxd.it/2bg8\n2026-07-20,Arrival,2016,https://boxd.it/a4e5");
  archive.file("ratings.csv", "Date,Name,Year,Letterboxd URI,Rating\n2026-07-20,Heat,1995,https://boxd.it/2bg8,4.5");
  archive.file("deleted/reviews.csv", "Name,Review\nHeat,Ignore this folder");

  const movies = await parseLetterboxdArchive(await archive.generateAsync({ type: "uint8array" }));

  assert.equal(movies.length, 2);
  assert.equal(movies.find((movie) => movie.title === "Heat").rating, 9);
  assert.equal(movies.find((movie) => movie.title === "Arrival").rating, null);
});

test("rejects ZIP files without Letterboxd library CSV files", async () => {
  const archive = new JSZip();
  archive.file("profile.csv", "Username\nwalklikeaman");

  await assert.rejects(
    parseLetterboxdArchive(await archive.generateAsync({ type: "uint8array" })),
    /watched\.csv or ratings\.csv/,
  );
});

test("matches mapped works to imported library titles and years", () => {
  const library = parseMediaCsv('Name,Year,Rating\n"Paris, Texas",1984,4.5\nHeat,1995,5', "letterboxd");

  assert.equal(workIsInLibrary({ title: "Heat", year: 1995 }, library), true);
  assert.equal(workIsInLibrary({ title: "Heat", year: 2013 }, library), false);
  assert.equal(workIsInLibrary({ title: "Unknown", year: 1995 }, library), false);
});
