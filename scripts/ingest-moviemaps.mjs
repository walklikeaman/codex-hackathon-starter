#!/usr/bin/env node
//
// Filming locations from moviemaps.org, matched to works by IMDb id.
//
//   node --env-file=.env.local scripts/ingest-moviemaps.mjs [--dry-run] [--limit 50]
//   node --env-file=.env.local scripts/ingest-moviemaps.mjs --out rows.json
//
// `--out` writes the built rows instead of upserting them. Reading `works` needs only
// the anon key, so this produces the exact payload on a machine that does not hold
// SUPABASE_SERVICE_ROLE_KEY — and the rows can be read before anything is written.
//
// Reads what tools/scraperai/harvest.py wrote. No model call, no network beyond
// Supabase: the scrape already happened, the coordinates already exist, and the match
// is an equality join.
//
// The match is IMDb id and ONLY IMDb id. Title matching is what the permit ingest has
// to do, and it needs isSearchableTitle() to refuse short titles because "Heat" matches
// everything. Here both sides carry tt-ids, so a fuzzy fallback would be strictly worse
// than reporting the miss: it would attach one film's locations to another film and
// look exactly like a success.
//
// Everything lands as `pending`. A contributor identified these places; that is a
// claim, and this project's whole shape is that claims wait for review.

import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  dedupeByPlaceKey,
  imdbIdOf,
  locationToSubmission,
  SOURCE,
} from "../app/lib/moviemaps-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const OUT_FILE = arg("out", null);
const DRY_RUN = process.argv.includes("--dry-run") || Boolean(OUT_FILE);
const LIMIT = Number.parseInt(arg("limit", "0"), 10) || 0;
const DATA_DIR = path.resolve(String(arg("data", "data/moviemaps")));

// PostgREST takes the whole batch in one statement; a few hundred rows per call keeps
// the request small enough to retry cheaply when one film has 200 locations.
const WRITE_BATCH = 200;

async function* readNdjson(file) {
  const stream = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of stream) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A half-written last line is normal while harvest.py is still running.
      console.log(`   skipping unparseable line ${lineNumber} of ${path.basename(file)}`);
    }
  }
}

// Location pages hold what movie pages do not: the street address, the per-scene
// description, and the frame gallery. Indexed by (location id, movie id) because the
// scene text is per appearance — one address, different scenes in different films.
//
// Only the fields the submission uses are kept. The full file projects to ~67 MB and
// holding it whole buys nothing.
async function loadDetailIndex(file) {
  const index = new Map();
  let frames = 0;

  for await (const record of readNdjson(file)) {
    const address = record.address ?? null;
    for (const appearance of record.appearances ?? []) {
      if (!appearance?.movie_id) continue;
      frames += appearance.frames?.length ?? 0;
      index.set(`${record.id}:${appearance.movie_id}`, {
        address,
        scene: appearance.scene ?? null,
        as_name: appearance.as_name ?? null,
        note: appearance.note ?? record.note ?? null,
        frames: appearance.frames ?? [],
      });
    }
  }

  console.log(`   ${index.size} location/film pairs, ${frames} frames`);
  return index;
}

// Every work that has an IMDb id, as tt-id → row. One query rather than one per film:
// the catalogue is small next to 6,041 scraped films, and the join belongs on the side
// that fits in memory.
async function loadWorksByImdb(db) {
  const byImdb = new Map();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("works")
      .select("id, title, kind, year, imdb_id")
      .not("imdb_id", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const work of data ?? []) byImdb.set(work.imdb_id, work);
    if ((data?.length ?? 0) < PAGE) break;
  }

  return byImdb;
}

async function writeRows(db, rows) {
  let written = 0;
  for (let index = 0; index < rows.length; index += WRITE_BATCH) {
    const batch = rows.slice(index, index + WRITE_BATCH);
    const { error } = await db
      .from("location_submissions")
      .upsert(batch, { onConflict: "work_id,place_key" });
    if (error) throw new Error(error.message);
    written += batch.length;
  }
  return written;
}

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  // Reading `works` is a public select; only the upsert needs the service role. With
  // --out there is no upsert, so the anon key is enough and the payload can be built
  // anywhere.
  const readKey = env.SUPABASE_SERVICE_ROLE_KEY || (OUT_FILE ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null);
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !readKey && (OUT_FILE ? "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY"),
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Add it to .env.local and run with:");
    console.error("  node --env-file=.env.local scripts/ingest-moviemaps.mjs");
    process.exit(1);
  }

  const moviesFile = path.join(DATA_DIR, "movies.ndjson");
  const locationsFile = path.join(DATA_DIR, "locations.ndjson");
  try {
    await stat(moviesFile);
  } catch {
    console.error(`No ${moviesFile}. Harvest it first:`);
    console.error("  tools/scraperai/.venv/bin/python tools/scraperai/harvest.py");
    process.exit(1);
  }

  console.log(`${SOURCE.site}: licence ${SOURCE.license} — these are leads, not licensed content`);

  const db = createClient(supabaseUrl, readKey, { auth: { persistSession: false } });

  console.log("\nreading harvest");
  let detail = new Map();
  try {
    await stat(locationsFile);
    detail = await loadDetailIndex(locationsFile);
  } catch {
    // The movie pages alone carry name, coordinates, city and the fictional name, so
    // the ingest still works — it just arrives without addresses, scenes or frames.
    console.log("   no locations.ndjson — ingesting without addresses, scenes or frames");
  }

  const works = await loadWorksByImdb(db);
  console.log(`\n${works.size} works in the catalogue carry an IMDb id`);
  if (works.size === 0) {
    console.log("Nothing to match against.");
    return;
  }

  const totals = { films: 0, matched: 0, rows: 0, written: 0, noImdb: 0, unmatched: 0, dropped: 0 };
  const pending = [];
  let processed = 0;

  for await (const movie of readNdjson(moviesFile)) {
    totals.films += 1;

    const imdbId = imdbIdOf(movie);
    if (!imdbId) { totals.noImdb += 1; continue; }

    const work = works.get(imdbId);
    if (!work) { totals.unmatched += 1; continue; }

    const candidates = movie.locations ?? [];
    const rows = dedupeByPlaceKey(candidates.map((location) => locationToSubmission(location, {
      workId: work.id,
      detail: detail.get(`${location.location_id}:${movie.id}`) ?? null,
    })));

    totals.matched += 1;
    totals.dropped += candidates.length - rows.length;
    totals.rows += rows.length;

    const withFrames = rows.filter((row) => row.source_media).length;
    const withScene = rows.filter((row) => row.source_sentence).length;
    console.log(`\n${work.title}${work.year ? ` (${work.year})` : ""}  ← ${movie.title} [${imdbId}]`);
    console.log(`   ${rows.length} places · ${withScene} with a scene · ${withFrames} with frames`);

    if (DRY_RUN && !OUT_FILE) {
      for (const row of rows.slice(0, 5)) {
        console.log(`     ${row.place_name} (${row.lat.toFixed(4)}, ${row.lng.toFixed(4)})`);
      }
    }
    pending.push(...rows);

    processed += 1;
    if (LIMIT && processed >= LIMIT) break;
  }

  if (OUT_FILE) {
    await writeFile(OUT_FILE, `${JSON.stringify(pending, null, 2)}\n`, "utf8");
    console.log(`\nwrote ${pending.length} rows to ${OUT_FILE}`);
  } else if (!DRY_RUN && pending.length > 0) {
    totals.written = await writeRows(db, pending);
  }

  console.log(`\n${totals.films} films read`);
  console.log(`   ${totals.matched} matched by IMDb id`);
  console.log(`   ${totals.unmatched} had an IMDb id we do not hold`);
  console.log(`   ${totals.noImdb} had no IMDb id at all`);
  console.log(`   ${totals.rows} submissions built, ${totals.dropped} duplicate places dropped`);
  if (OUT_FILE) console.log(`   written to ${OUT_FILE}, nothing sent to the database`);
  else console.log(DRY_RUN ? "   dry run — nothing written" : `   ${totals.written} queued as pending`);
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
