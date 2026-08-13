#!/usr/bin/env node
//
// Add the scraped films to the catalogue, so their locations have something to
// attach to.
//
//   node --env-file=.env.local scripts/ingest-moviemaps-works.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-moviemaps-works.mjs
//   node --env-file=.env.local scripts/ingest-moviemaps-works.mjs --out works.json
//
// This is the step that unblocks ingest-moviemaps.mjs: 6,041 scraped films all
// carry an IMDb id, and only 12 of them matched a work we already held.
//
// It INSERTS and never updates. The works already in the catalogue were entered
// deliberately and carry a wikidata_id, a tmdb_id and a year; a MovieMaps record
// has none of those, so an upsert that "refreshed" them would overwrite curated
// facts with a scrape's blanks. On conflict, the existing row wins and is left
// exactly as it was.
//
// Every row it does create is stamped `source = 'moviemaps'`, because a scraped
// work is a catalogue entry, not a verified one, and the two must stay tellable
// apart.

import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { movieToWork, SOURCE } from "../app/lib/moviemaps-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const OUT_FILE = arg("out", null);
const DRY_RUN = process.argv.includes("--dry-run") || Boolean(OUT_FILE);
const LIMIT = Number.parseInt(arg("limit", "0"), 10) || 0;
const DATA_DIR = path.resolve(String(arg("data", "data/moviemaps")));

const WRITE_BATCH = 500;

async function* readNdjson(file) {
  const stream = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A half-written last line is normal while harvest.py is still running.
    }
  }
}

async function existingImdbIds(db) {
  const seen = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("works")
      .select("imdb_id")
      .not("imdb_id", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) seen.add(row.imdb_id);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return seen;
}

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const readKey = env.SUPABASE_SERVICE_ROLE_KEY || (OUT_FILE ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null);
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !readKey && (OUT_FILE ? "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY"),
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Add it to .env.local and run with:");
    console.error("  node --env-file=.env.local scripts/ingest-moviemaps-works.mjs");
    process.exit(1);
  }

  const moviesFile = path.join(DATA_DIR, "movies.ndjson");
  try {
    await stat(moviesFile);
  } catch {
    console.error(`No ${moviesFile}. Harvest it first:`);
    console.error("  tools/scraperai/.venv/bin/python tools/scraperai/harvest.py --kind movie");
    process.exit(1);
  }

  const db = createClient(supabaseUrl, readKey, { auth: { persistSession: false } });
  const held = await existingImdbIds(db);
  console.log(`${held.size} works already carry an IMDb id — those rows are left untouched`);

  const rows = [];
  const totals = { read: 0, unusable: 0, alreadyHeld: 0, duplicate: 0, film: 0, series: 0 };
  const seen = new Set();

  for await (const movie of readNdjson(moviesFile)) {
    totals.read += 1;
    const work = movieToWork(movie);
    if (!work) { totals.unusable += 1; continue; }
    if (held.has(work.imdb_id)) { totals.alreadyHeld += 1; continue; }
    // MovieMaps has no duplicate IMDb ids today, but a batch that contained one
    // would fail the whole insert on the unique index rather than skip a row.
    if (seen.has(work.imdb_id)) { totals.duplicate += 1; continue; }

    seen.add(work.imdb_id);
    totals[work.kind] += 1;
    rows.push(work);
    if (LIMIT && rows.length >= LIMIT) break;
  }

  console.log(`\n${totals.read} films read`);
  console.log(`   ${totals.alreadyHeld} already in the catalogue`);
  console.log(`   ${totals.unusable} unusable (no IMDb id or no title)`);
  console.log(`   ${totals.duplicate} duplicate IMDb ids within the scrape`);
  console.log(`   ${rows.length} to create — ${totals.film} films, ${totals.series} series`);
  console.log(`   every one with year = null (MovieMaps publishes no year) and source = '${SOURCE.kind}'`);

  if (OUT_FILE) {
    await writeFile(OUT_FILE, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`\nwrote ${rows.length} rows to ${OUT_FILE}, nothing sent to the database`);
    return;
  }
  if (DRY_RUN) {
    for (const row of rows.slice(0, 10)) console.log(`     ${row.kind.padEnd(6)} ${row.imdb_id}  ${row.title}`);
    console.log("\n   dry run — nothing written");
    return;
  }

  let written = 0;
  for (let index = 0; index < rows.length; index += WRITE_BATCH) {
    const batch = rows.slice(index, index + WRITE_BATCH);
    // ignoreDuplicates → ON CONFLICT DO NOTHING. A work we already hold keeps
    // its wikidata_id, tmdb_id and year; the scrape does not get to overwrite them.
    const { error } = await db
      .from("works")
      .upsert(batch, { onConflict: "imdb_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    written += batch.length;
    if (index % (WRITE_BATCH * 4) === 0) console.log(`   ${written}/${rows.length}`);
  }

  console.log(`\n   ${written} works created`);
  console.log("   now run: node --env-file=.env.local scripts/ingest-moviemaps.mjs");
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
