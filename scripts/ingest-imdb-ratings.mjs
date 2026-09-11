#!/usr/bin/env node
//
// IMDb ratings for the catalogue, from IMDb's own published dataset.
//
//   node --env-file=.env.local scripts/ingest-imdb-ratings.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-imdb-ratings.mjs
//
// **Why this source and not the site.** [[source-evaluation]] refused IMDb in July and
// still does: their terms forbid extracting their pages, and nothing here reads one. What
// that ruling explicitly allowed is the other thing — *"bulk metadata via IMDb's own
// published datasets"* — which is a file they publish for this purpose at
// https://datasets.imdbws.com/ under their non-commercial licence. One 8.6 MB download,
// 1.7 million rows, keyed by the `tconst` that is already our `imdb_id`.
//
// **Why it is worth having at all.** `work_ratings` held **32 rows across 12 works** out of
// 7,063 — of the 1,642 works with a Los Angeles row, exactly one carried a rating. A filter
// on a public score would have sorted 1,641 films by null. This is what makes
// "show me only the films worth the walk" answerable by something other than the reader's
// own list.
//
// The rating is stored as a FACT with its source, like every other rating: source `imdb`,
// the score, the vote count, and a link to the title page a reader can check it against.
// Linking to IMDb is not extracting from IMDb.

import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import process from "node:process";
import { Readable } from "node:stream";

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const DATASET = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const WRITE_BATCH = 500;

// A rating nobody voted on is noise, not an opinion. IMDb publishes titles with five votes
// and the number carries no information at that scale; the threshold keeps the filter
// meaningful rather than letting an obscure title outrank a famous one on 7 votes.
export const MIN_VOTES = 100;

export function parseRatingRow(line) {
  const [tconst, average, votes] = String(line ?? "").split("\t");
  if (!tconst || !/^tt\d+$/.test(tconst)) return null;
  const score = Number(average);
  const count = Number(votes);
  if (!Number.isFinite(score) || score <= 0 || score > 10) return null;
  if (!Number.isInteger(count) || count < MIN_VOTES) return null;
  return { imdb_id: tconst, score, votes: count };
}

// "8.6" — one decimal, which is the precision IMDb publishes. Printing 8.60 would claim a
// precision the source does not have.
export function ratingDisplay(score) {
  return `${Number(score).toFixed(1)}/10`;
}

export function toRatingRow(work, rating) {
  return {
    work_id: work.id,
    source: "imdb",
    score: rating.score,
    display: ratingDisplay(rating.score),
    votes: rating.votes,
    // The page a reader can check it on. A link, never a scrape.
    source_url: `https://www.imdb.com/title/${rating.imdb_id}/`,
    retrieved_at: new Date().toISOString(),
  };
}

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Which IMDb ids we actually care about. 1.7 million rows arrive and we hold 7,063 works;
  // reading the file against a Set is one pass and no database round trips.
  const byImdb = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("works").select("id, title, imdb_id")
      .not("imdb_id", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const work of data) byImdb.set(work.imdb_id, work);
    if (data.length < 1000) break;
  }
  console.log(`${byImdb.size} works carry an IMDb id`);

  const response = await fetch(DATASET, { headers: { "User-Agent": "GloryMap/1.0" } });
  if (!response.ok) throw new Error(`dataset download failed: ${response.status}`);

  const lines = createInterface({
    input: Readable.fromWeb(response.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const rows = [];
  let read = 0;
  let belowThreshold = 0;
  for await (const line of lines) {
    read += 1;
    const rating = parseRatingRow(line);
    if (!rating) {
      if (line.includes("\t") && !line.startsWith("tconst")) belowThreshold += 1;
      continue;
    }
    const work = byImdb.get(rating.imdb_id);
    if (work) rows.push(toRatingRow(work, rating));
  }
  console.log(`read ${read} dataset rows; matched ${rows.length} of our works`);
  console.log(`  (${belowThreshold} dataset rows skipped — fewer than ${MIN_VOTES} votes or unparseable)`);

  if (DRY_RUN) {
    console.log("--dry-run: nothing written");
    for (const row of rows.slice(0, 8)) console.log(`   ${row.display.padStart(7)}  ${row.votes} votes  ${row.source_url}`);
    return;
  }

  let written = 0;
  for (let index = 0; index < rows.length; index += WRITE_BATCH) {
    const batch = rows.slice(index, index + WRITE_BATCH);
    const { error } = await db.from("work_ratings")
      .upsert(batch, { onConflict: "work_id,source", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    written += batch.length;
    if (written % 2000 === 0 || written === rows.length) console.log(`  written ${written}/${rows.length}`);
  }
  console.log(`done: ${written} IMDb ratings`);
}

if (process.argv[1]?.endsWith("ingest-imdb-ratings.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
