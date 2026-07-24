import assert from "node:assert/strict";
import test from "node:test";

import {
  imdbUrl,
  isImdbId,
  normalizeScore,
  ratingFromTmdb,
  ratingRows,
  ratingsFromOmdb,
  rottenTomatoesUrl,
  sortRatings,
} from "../app/lib/work-ratings.mjs";

// A real OMDb response, trimmed to the fields we read (Skyfall, tt1074638).
const OMDB_SKYFALL = {
  Response: "True",
  Title: "Skyfall",
  imdbID: "tt1074638",
  imdbRating: "7.8",
  imdbVotes: "768,360",
  Ratings: [
    { Source: "Internet Movie Database", Value: "7.8/10" },
    { Source: "Rotten Tomatoes", Value: "92%" },
    { Source: "Metacritic", Value: "81/100" },
  ],
};

test("normalizeScore understands every scale a source may use", () => {
  assert.equal(normalizeScore("92%"), 92);
  assert.equal(normalizeScore("7.8/10"), 78);
  assert.equal(normalizeScore("81/100"), 81);
});

test("normalizeScore returns null, never zero, for something unparseable", () => {
  // A missing rating and a rating of zero are different claims and must not look alike.
  for (const bad of ["N/A", "", "great", "10/0", "-5%", "150%", null, undefined]) {
    assert.equal(normalizeScore(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("ratingsFromOmdb keeps each source's own wording while normalising for sorting", () => {
  const rows = ratingsFromOmdb(OMDB_SKYFALL, { imdbId: "tt1074638", rtPath: "m/skyfall" });
  assert.deepEqual(rows.map((r) => r.source), ["imdb", "rotten_tomatoes", "metacritic"]);

  const imdb = rows.find((r) => r.source === "imdb");
  assert.equal(imdb.display, "7.8/10"); // never restated as "78%"
  assert.equal(imdb.score, 78);         // but comparable
  assert.equal(imdb.votes, 768360);
  assert.equal(imdb.source_url, "https://www.imdb.com/title/tt1074638/");

  const rt = rows.find((r) => r.source === "rotten_tomatoes");
  assert.equal(rt.display, "92%");
  assert.equal(rt.source_url, "https://www.rottentomatoes.com/m/skyfall");
});

test("ratingsFromOmdb drops a rating it cannot parse instead of inventing one", () => {
  const rows = ratingsFromOmdb({
    Response: "True",
    Ratings: [
      { Source: "Rotten Tomatoes", Value: "N/A" },
      { Source: "Metacritic", Value: "81/100" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.source), ["metacritic"]);
});

test("ratingsFromOmdb ignores a failed lookup and unknown sources", () => {
  assert.deepEqual(ratingsFromOmdb({ Response: "False", Error: "Movie not found!" }), []);
  assert.deepEqual(ratingsFromOmdb(null), []);
  assert.deepEqual(
    ratingsFromOmdb({ Response: "True", Ratings: [{ Source: "Some Blog", Value: "9/10" }] }),
    [],
  );
});

test("a Rotten Tomatoes link is built only from a real P1258 path", () => {
  assert.equal(rottenTomatoesUrl("m/skyfall"), "https://www.rottentomatoes.com/m/skyfall");
  assert.equal(rottenTomatoesUrl("tv/the_crown"), "https://www.rottentomatoes.com/tv/the_crown");
  // Anything else would produce a link that 404s or, worse, points somewhere unrelated.
  for (const bad of ["skyfall", "https://evil.example", "m/../../etc", ""]) {
    assert.equal(rottenTomatoesUrl(bad), null);
  }
});

test("an IMDb link is built only from a real imdb id", () => {
  assert.ok(isImdbId("tt1074638"));
  assert.ok(!isImdbId("nm0000151")); // a person, not a title
  assert.equal(imdbUrl("tt1074638"), "https://www.imdb.com/title/tt1074638/");
  assert.equal(imdbUrl("nonsense"), null);
});

test("ratingFromTmdb is the fallback that keeps a card from looking empty", () => {
  const film = ratingFromTmdb({ vote_average: 7.24, vote_count: 1200 }, "37724", "film");
  assert.equal(film.source, "tmdb");
  assert.equal(film.score, 72.4);
  assert.equal(film.display, "7.2/10");
  assert.equal(film.source_url, "https://www.themoviedb.org/movie/37724");

  const series = ratingFromTmdb({ vote_average: 8 }, "65494", "series");
  assert.equal(series.source_url, "https://www.themoviedb.org/tv/65494");

  // An unrated title must yield nothing rather than a 0 that reads as "terrible".
  assert.equal(ratingFromTmdb({ vote_average: 0 }, "1"), null);
  assert.equal(ratingFromTmdb({}, "1"), null);
});

test("ratings are presented IMDb and Rotten Tomatoes first", () => {
  const sorted = sortRatings([
    { source: "tmdb", display: "7/10" },
    { source: "metacritic", display: "81/100" },
    { source: "rotten_tomatoes", display: "92%" },
    { source: "imdb", display: "7.8/10" },
  ]);
  assert.deepEqual(sorted.map((r) => r.source), ["imdb", "rotten_tomatoes", "metacritic", "tmdb"]);
});

test("ratingRows shapes exactly what the table stores", () => {
  const rows = ratingRows("w1", ratingsFromOmdb(OMDB_SKYFALL, { imdbId: "tt1074638", rtPath: "m/skyfall" }));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    work_id: "w1",
    source: "imdb",
    score: 78,
    display: "7.8/10",
    votes: 768360,
    source_url: "https://www.imdb.com/title/tt1074638/",
  });
});
