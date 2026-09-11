import assert from "node:assert/strict";
import test from "node:test";

import { sourceOfCsv } from "../scripts/seed-demo-library.mjs";

// Which service wrote a CSV decides which scale its numbers are on, and getting it wrong
// does not throw — it halves or doubles every rating in the library. It cannot be read off
// the filename either: an IMDb export downloads as a bare UUID.
test("an IMDb export is recognised by its Const column", () => {
  const header = "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors";
  assert.equal(sourceOfCsv(`${header}\ntt0113277,7,2024-08-24,Heat,Heat,https://www.imdb.com/title/tt0113277,Movie,8.3,170,1995,"Crime, Drama",700000,"1995-12-15","Michael Mann"`), "imdb");
});

test("a Letterboxd export is recognised by its URI column", () => {
  assert.equal(sourceOfCsv("Date,Name,Year,Letterboxd URI,Rating\n2026-07-20,Heat,1995,https://boxd.it/2bg8,4.5"), "letterboxd");
});

test("a BOM and a quoted header do not hide the column", () => {
  // Both real: IMDb has shipped a BOM, and a quoted header is legal CSV.
  assert.equal(sourceOfCsv('﻿"Const","Your Rating","Title"\ntt0111161,10,Shawshank'), "imdb");
});

test("anything else is refused rather than guessed at", () => {
  // A watchlist export has titles but no ratings; silently reading it as one service or
  // the other is how a library ends up on two scales at once.
  assert.equal(sourceOfCsv("Title,Year\nHeat,1995"), null);
  assert.equal(sourceOfCsv(""), null);
  assert.equal(sourceOfCsv(null), null);
});
