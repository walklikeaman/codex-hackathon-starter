#!/usr/bin/env node
//
// The year a work came out, for the 6,041 that have none.
//
//   node --env-file=.env.local scripts/backfill-work-years.mjs --dry-run
//   node --env-file=.env.local scripts/backfill-work-years.mjs --limit 200
//   node --env-file=.env.local scripts/backfill-work-years.mjs
//
// **Why it matters and it is not cosmetic.** `workIsInLibrary` matches a catalogue work to
// a row in the reader's Letterboxd export on a normalised title AND a year, where a year
// missing on EITHER side counts as agreement. Measured 10.09.2026: 1,022 of 7,063 works
// carry a year, so for 6,041 of them the match is title-only — and "Star Trek" is a film
// and a series and several of each. Filling the column is what lets the library filter,
// the rating sort and the rating bar tell two same-titled films apart.
//
// **The source is TMDB's `find` by IMDb id.** Measured on the same 30 works: TMDB answered
// 28, Wikidata's P345 → P577 answered 19. 6,038 of the 6,041 year-less works carry an IMDb
// id, and only 12 carry a TMDB id — so the IMDb id is the key we actually have. IMDb
// itself is never read: their terms forbid extracting it ([[source-evaluation]]), and
// nothing here does — the id is used as a lookup key into an API that permits it.
//
// **A year we write must not be worse than the null it replaces**, and it can be: a null
// year makes the match LOOSE, a wrong year makes it FAIL. A film that premiered at a
// festival one year and released the next is the ordinary case, not the exotic one. So
// this writes what TMDB calls the primary release date and nothing else — no guessing from
// a title, no averaging across regions — and the client tolerates a one-year gap rather
// than this file pretending to a precision it does not have. See `YEAR_TOLERANCE` in
// app/lib/media-library.mjs.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const at = process.argv.indexOf("--limit");
  return at === -1 ? Infinity : Number(process.argv[at + 1]) || Infinity;
})();

// TMDB asks for politeness rather than publishing a hard number. Eight in flight clears
// 6,038 works in about twelve minutes and has never drawn a 429 in testing; the retry
// below is there for the day it does.
const CONCURRENCY = 8;
const WRITE_BATCH = 200;
const TIMEOUT_MS = 12000;

// A year outside this is not a release date, it is a parse error. The Lumière brothers
// are 1895, and a work cannot come out after next year.
const EARLIEST = 1878;
const LATEST = new Date().getFullYear() + 2;

export function yearFromFindPayload(payload) {
  for (const key of ["movie_results", "tv_results"]) {
    for (const row of payload?.[key] ?? []) {
      const date = row?.release_date ?? row?.first_air_date ?? "";
      const year = Number(String(date).slice(0, 4));
      if (Number.isInteger(year) && year >= EARLIEST && year <= LATEST) return year;
    }
  }
  return null;
}

async function lookupYear(imdbId, { key, fetchImpl, logError }) {
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}`
    + `?external_source=imdb_id&api_key=${encodeURIComponent(key)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 429) {
        // Honour the header when there is one; TMDB does not always send it.
        const wait = Number(response.headers.get("retry-after")) || 2;
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      if (!response.ok) return null;
      return yearFromFindPayload(await response.json());
    } catch (error) {
      if (attempt === 2) logError(`  ${imdbId}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    TMDB_API_KEY: tmdbKey,
  } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!tmdbKey) {
    console.error("Missing TMDB_API_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const pending = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("works")
      .select("id, title, kind, imdb_id")
      .is("year", null)
      .not("imdb_id", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    pending.push(...data);
    if (data.length < 1000) break;
  }
  const todo = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT);
  console.log(`${pending.length} works have no year and an IMDb id; looking up ${todo.length}`);

  const found = [];
  let done = 0;
  let missing = 0;
  async function worker(queue) {
    while (queue.length) {
      const work = queue.pop();
      const year = await lookupYear(work.imdb_id, {
        key: tmdbKey, fetchImpl: fetch, logError: console.error,
      });
      done += 1;
      if (year) found.push({ id: work.id, year });
      else missing += 1;
      if (done % 250 === 0) {
        console.log(`  ${done}/${todo.length} — ${found.length} found, ${missing} not on TMDB`);
      }
    }
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

  console.log(`\n${found.length} years found, ${missing} works TMDB does not know by that id`);
  if (DRY_RUN) {
    console.log("--dry-run: nothing written");
    for (const row of found.slice(0, 10)) console.log(`   ${row.id} -> ${row.year}`);
    return;
  }

  // One column, by primary key. `upsert` on a table with other NOT NULL columns would
  // need every one of them; this touches `year` and nothing else.
  let written = 0;
  for (let index = 0; index < found.length; index += WRITE_BATCH) {
    const batch = found.slice(index, index + WRITE_BATCH);
    await Promise.all(batch.map(async ({ id, year }) => {
      const { error } = await db.from("works").update({ year }).eq("id", id);
      if (error) throw new Error(`writing ${id}: ${error.message}`);
      written += 1;
    }));
    console.log(`  written ${written}/${found.length}`);
  }
  console.log(`done: ${written} years written`);
}

// Importable for the test without running.
if (process.argv[1]?.endsWith("backfill-work-years.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
