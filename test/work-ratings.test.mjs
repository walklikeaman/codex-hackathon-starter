import assert from "node:assert/strict";
import test from "node:test";

import {
  imdbUrl,
  isImdbId,
  metacriticUrl,
  normalizeScore,
  ratingFromTmdb,
  ratingRows,
  ratingsFromOmdb,
  rottenTomatoesUrl,
  scoreInSourceScale,
  sourceScale,
  tmdbFindResult,
  tmdbFindUrl,
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

test("a Metacritic link is built only from a real P1712 path", () => {
  assert.equal(metacriticUrl("movie/skyfall"), "https://www.metacritic.com/movie/skyfall");
  assert.equal(metacriticUrl("tv/the-crown"), "https://www.metacritic.com/tv/the-crown");
  for (const bad of ["skyfall", "m/skyfall", "https://evil.example", ""]) {
    assert.equal(metacriticUrl(bad), null);
  }
});

test("every chip a user can see links somewhere real", () => {
  // A rating chip that isn't clickable reads as unfinished — and a score without a
  // source is exactly what this feature exists to avoid.
  const rows = ratingsFromOmdb(OMDB_SKYFALL, {
    imdbId: "tt1074638", rtPath: "m/skyfall", mcPath: "movie/skyfall",
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => typeof r.source_url === "string" && r.source_url.startsWith("https://")));
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

// The two scales were mixed in one column for months: 5,495 IMDb rows at 1.7–9.5 beside
// Rotten Tomatoes at 65–99, in a field documented as 0..100. Any cross-source comparison
// put every IMDb row below every RT row, and nothing said so.
test("a stored score comes back in the scale its source states", () => {
  assert.equal(scoreInSourceScale("imdb", 88), 8.8);
  assert.equal(scoreInSourceScale("tmdb", 75), 7.5);
  assert.equal(scoreInSourceScale("rotten_tomatoes", 92), 92);
  assert.equal(scoreInSourceScale("metacritic", 81), 81);
});

test("a missing score stays missing rather than becoming a zero", () => {
  assert.equal(scoreInSourceScale("imdb", null), null);
  assert.equal(scoreInSourceScale("imdb", undefined), null);
  assert.equal(scoreInSourceScale("imdb", ""), null);
  assert.equal(scoreInSourceScale("imdb", "banana"), null);
  assert.equal(scoreInSourceScale("imdb", 0), 0);
});

test("an unknown source is assumed to be on the stored scale, never rescaled by guess", () => {
  assert.equal(sourceScale("something_new"), 100);
  assert.equal(scoreInSourceScale("something_new", 64), 64);
});

// TMDB by the IMDb id we already hold: a TMDB id is on 12 works of 7,063, an IMDb id on
// 6,044. The licence is the point — IMDb's dataset is non-commercial, TMDB's is not.
const FIND_RESPONSE = {
  movie_results: [{ id: 155, title: "The Dark Knight", vote_average: 8.5, vote_count: 33012 }],
  tv_results: [{ id: 1399, name: "Game of Thrones", vote_average: 8.4, vote_count: 22000 }],
  person_results: [],
};

test("the find URL asks TMDB about an external id, and refuses a bad one", () => {
  const url = new URL(tmdbFindUrl("tt0468569", { apiKey: "k" }));
  assert.equal(url.pathname, "/3/find/tt0468569");
  assert.equal(url.searchParams.get("external_source"), "imdb_id");
  assert.equal(url.searchParams.get("api_key"), "k");
  assert.equal(tmdbFindUrl("not-an-id"), null);
  assert.equal(tmdbFindUrl(null), null);
});

// One IMDb id can appear in more than one result list. Reading "the first non-empty one"
// would file a series as a film the first time TMDB indexed an episode.
test("the kind we recorded decides which result list is read", () => {
  assert.equal(tmdbFindResult(FIND_RESPONSE, "film").tmdbId, "155");
  assert.equal(tmdbFindResult(FIND_RESPONSE, "series").tmdbId, "1399");
  assert.equal(tmdbFindResult(FIND_RESPONSE, "book"), null);
});

test("a work TMDB does not hold is null, not an empty rating", () => {
  assert.equal(tmdbFindResult({ movie_results: [] }, "film"), null);
  assert.equal(tmdbFindResult({}, "film"), null);
  assert.equal(tmdbFindResult(null, "film"), null);
  assert.equal(tmdbFindResult({ movie_results: [{ id: 0 }] }, "film"), null);
});

test("a find result becomes a rating on the stored 0..100 scale, stated as TMDB states it", () => {
  const found = tmdbFindResult(FIND_RESPONSE, "film");
  const rating = ratingFromTmdb({ vote_average: found.voteAverage, vote_count: found.voteCount }, found.tmdbId);
  assert.equal(rating.source, "tmdb");
  assert.equal(rating.score, 85);
  assert.equal(rating.display, "8.5/10");
  assert.equal(rating.votes, 33012);
  assert.equal(scoreInSourceScale("tmdb", rating.score), 8.5);
});

// An unrated work is not a zero-rated work.
test("a TMDB record nobody has voted on yields no rating at all", () => {
  assert.equal(ratingFromTmdb({ vote_average: 0, vote_count: 0 }, "155"), null);
});
