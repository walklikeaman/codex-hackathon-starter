import assert from "node:assert/strict";
import test from "node:test";

import {
  filmLocationImageKey,
  parseTmdbMovieId,
  selectTmdbBackdrop,
  selectTmdbBackdrops,
  tmdbImageUrl,
} from "../app/lib/tmdb-images.mjs";

test("parseTmdbMovieId accepts only positive integer IDs", () => {
  assert.equal(parseTmdbMovieId("1089100"), "1089100");
  assert.equal(parseTmdbMovieId("0"), null);
  assert.equal(parseTmdbMovieId("12/credits"), null);
  assert.equal(parseTmdbMovieId(null), null);
});

test("filmLocationImageKey separates locations from the same film", () => {
  assert.equal(filmLocationImageKey("185", "Q386707"), "185:Q386707");
  assert.equal(filmLocationImageKey("185", "Q123"), "185:Q123");
  assert.equal(filmLocationImageKey("invalid", "Q123"), null);
});

test("selectTmdbBackdrop prefers the most reviewed valid image", () => {
  const backdrop = selectTmdbBackdrop([
    { file_path: "/wide-low.jpg", vote_count: 2, vote_average: 8, width: 1920 },
    { file_path: "https://invalid.example/image.jpg", vote_count: 100, vote_average: 10, width: 3840 },
    { file_path: "/wide-reviewed.jpg", vote_count: 7, vote_average: 7.5, width: 1280 },
  ]);

  assert.equal(backdrop.file_path, "/wide-reviewed.jpg");
});

test("selectTmdbBackdrops returns a limited, unique, stable shortlist", () => {
  const backdrops = selectTmdbBackdrops([
    { file_path: "/second.jpg", vote_count: 3, vote_average: 8, width: 1920 },
    { file_path: "/first.jpg", vote_count: 5, vote_average: 7, width: 1280 },
    { file_path: "/first.jpg", vote_count: 100, vote_average: 10, width: 4000 },
    { file_path: "https://invalid.example/image.jpg", vote_count: 200 },
  ], 2);

  assert.deepEqual(backdrops.map((backdrop) => backdrop.file_path), [
    "/first.jpg",
    "/second.jpg",
  ]);
});

test("tmdbImageUrl builds only safe TMDB CDN URLs", () => {
  assert.equal(
    tmdbImageUrl("/scene.jpg"),
    "https://image.tmdb.org/t/p/w780/scene.jpg",
  );
  assert.equal(tmdbImageUrl("https://invalid.example/image.jpg"), null);
  assert.equal(tmdbImageUrl("/scene.jpg", "../../private"), null);
});
