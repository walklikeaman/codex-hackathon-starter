import assert from "node:assert/strict";
import test from "node:test";

import {
  isLetterboxdHandle,
  letterboxdRssUrl,
  parseLetterboxdRss,
} from "../app/lib/connectors/letterboxd-rss.mjs";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
<channel>
  <item>
    <title>Notting Hill, 1999 - ★★★★</title>
    <letterboxd:watchedDate>2026-07-09</letterboxd:watchedDate>
    <letterboxd:filmTitle>Notting Hill</letterboxd:filmTitle>
    <letterboxd:filmYear>1999</letterboxd:filmYear>
    <letterboxd:memberRating>4.0</letterboxd:memberRating>
    <tmdb:movieId>509</tmdb:movieId>
  </item>
  <item>
    <title>Amélie &amp; Co, 2001</title>
    <letterboxd:filmTitle>Am&#233;lie &amp; Co</letterboxd:filmTitle>
    <letterboxd:filmYear>2001</letterboxd:filmYear>
    <tmdb:movieId>194</tmdb:movieId>
  </item>
  <item>
    <title>My 2026 watchlist</title>
    <link>https://letterboxd.com/dave/list/my-2026-watchlist/</link>
  </item>
</channel>
</rss>`;

test("isLetterboxdHandle accepts valid handles, rejects the rest", () => {
  assert.ok(isLetterboxdHandle("dave"));
  assert.ok(isLetterboxdHandle("user_99"));
  assert.ok(!isLetterboxdHandle("bad/handle"));
  assert.ok(!isLetterboxdHandle("has space"));
  assert.ok(!isLetterboxdHandle(""));
  assert.ok(!isLetterboxdHandle("x".repeat(41)));
});

test("letterboxdRssUrl builds the feed URL only for valid handles", () => {
  assert.equal(letterboxdRssUrl("dave"), "https://letterboxd.com/dave/rss/");
  assert.throws(() => letterboxdRssUrl("../etc"));
});

test("parseLetterboxdRss extracts watched films with ready tmdb ids", () => {
  const films = parseLetterboxdRss(FEED);
  assert.equal(films.length, 2); // the list item is skipped
  assert.deepEqual(films[0], {
    title: "Notting Hill",
    year: 1999,
    tmdbId: "509",
    rating: 4,
    watchedDate: "2026-07-09",
  });
});

test("parseLetterboxdRss decodes XML entities and handles a missing rating/year", () => {
  const [, amelie] = parseLetterboxdRss(FEED);
  assert.equal(amelie.title, "Amélie & Co");
  assert.equal(amelie.year, 2001);
  assert.equal(amelie.rating, null);
  assert.equal(amelie.watchedDate, null);
});

test("parseLetterboxdRss returns [] for empty / non-feed input", () => {
  assert.deepEqual(parseLetterboxdRss(""), []);
  assert.deepEqual(parseLetterboxdRss("<html>nope</html>"), []);
  assert.deepEqual(parseLetterboxdRss(null), []);
});

test("parseLetterboxdRss skips items missing a positive tmdb id", () => {
  const feed = `<rss><item><letterboxd:filmTitle>No Id Film</letterboxd:filmTitle><tmdb:movieId>0</tmdb:movieId></item></rss>`;
  assert.deepEqual(parseLetterboxdRss(feed), []);
});
