#!/usr/bin/env node
//
// Filming locations from reelstreets.com, matched to works by title and year.
//
//   node --env-file=.env.local scripts/ingest-reelstreets.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-reelstreets.mjs
//
// Reads data/reelstreets/places.ndjson — the harvest after tools/scraperai/
// extract_places.py has read the place out of each caption.
//
// Two things this deliberately does NOT do.
//
// It does not geocode. `location_submissions` allows lat/lng to be null so long
// as nothing claims to have located them, and 95,208 of the 95,258 captures
// have no coordinate. Deriving points here would bury a lossy step inside an
// import; the geocoding cascade is a separate pass with its own provenance.
//
// It does not guess a match. With no IMDb id on either side, a title that
// matches several works and a year that cannot separate them is reported as
// ambiguous and skipped. 6,029 of our works came from a scrape with no year, so
// this is common — and it is exactly the case where a guess would attach one
// film's locations to another and look like a success.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";
import {
  captureToSubmission,
  dedupeByPlaceKey,
  matchWork,
  SOURCE,
} from "../app/lib/reelstreets-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number.parseInt(arg("limit", "0"), 10) || 0;
const DATA_DIR = path.resolve(String(arg("data", "data/reelstreets")));
const WRITE_BATCH = 200;

async function* readNdjson(file) {
  const stream = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Normal while extract_places.py is still appending.
    }
  }
}

// Works indexed by normalised title, many-to-one: several works can share a
// title, and the whole point of matchWork is to refuse when they do.
async function loadWorksByTitle(db) {
  const byTitle = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("works")
      .select("id, title, title_norm, kind, year")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const work of data ?? []) {
      const key = work.title_norm || normalizeWorkTitle(work.title);
      if (!key) continue;
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(work);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return byTitle;
}

// Two different scraped films can match the SAME work — this site lists
// "Transformers: The Last Knight" twice — and each contributes its own rows.
// Per-film dedup cannot see that, so the batch reaches Postgres holding one
// (work_id, place_key) twice and the upsert dies with "ON CONFLICT DO UPDATE
// command cannot affect row a second time". The key is global, so the dedup
// has to be too.
function dedupeAcrossFilms(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.work_id}\u0000${row.place_name.trim().toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  const placesFile = path.join(DATA_DIR, "places.ndjson");
  try {
    await stat(placesFile);
  } catch {
    console.error(`No ${placesFile}. Extract it first:`);
    console.error("  tools/scraperai/.venv/bin/python tools/scraperai/extract_places.py");
    process.exit(1);
  }

  console.log(`${SOURCE.site}: licence ${SOURCE.license} — leads, not licensed content`);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const works = await loadWorksByTitle(db);
  console.log(`${works.size} distinct titles in the catalogue\n`);

  const totals = {
    films: 0, matched: 0, rows: 0, written: 0,
    unmatched: 0, ambiguous: 0, yearMismatch: 0,
    droppedPrecision: 0, droppedDuplicate: 0, withPhoto: 0,
  };
  const reasons = new Map();
  const pending = [];
  let processed = 0;

  for await (const film of readNdjson(placesFile)) {
    totals.films += 1;

    const { work, reason } = matchWork(film, works);
    if (!work) {
      if (/year mismatch/.test(reason)) totals.yearMismatch += 1;
      else if (/share this title/.test(reason)) totals.ambiguous += 1;
      else totals.unmatched += 1;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      continue;
    }

    const captures = film.captures ?? [];
    const built = captures.map((capture) => captureToSubmission(capture, { workId: work.id, film }));
    const usable = built.filter(Boolean);
    totals.droppedPrecision += captures.length - usable.length;

    const rows = dedupeByPlaceKey(usable);
    totals.droppedDuplicate += usable.length - rows.length;
    totals.matched += 1;
    totals.rows += rows.length;
    totals.withPhoto += rows.filter((row) => row.source_media?.some((m) => m.kind === "now")).length;

    if (rows.length > 0) {
      console.log(`${work.title}${work.year ? ` (${work.year})` : ""}  ← ${film.title} (${film.year})`);
      console.log(`   ${rows.length} places, ${rows.filter((r) => r.source_media).length} with imagery`);
    }

    if (DRY_RUN) {
      for (const row of rows.slice(0, 3)) console.log(`     ${row.place_name}`);
    } else {
      pending.push(...rows);
    }

    processed += 1;
    if (LIMIT && processed >= LIMIT) break;
  }

  const toWrite = DRY_RUN ? [] : dedupeAcrossFilms(pending);
  if (toWrite.length < pending.length) {
    console.log(`\n   ${pending.length - toWrite.length} rows collided across films on the same work`);
  }
  if (!DRY_RUN && toWrite.length > 0) {
    for (let index = 0; index < toWrite.length; index += WRITE_BATCH) {
      const batch = toWrite.slice(index, index + WRITE_BATCH);
      const { error } = await db
        .from("location_submissions")
        .upsert(batch, { onConflict: "work_id,place_key" });
      if (error) throw new Error(error.message);
      totals.written += batch.length;
    }
  }

  console.log(`\n${totals.films} films read`);
  console.log(`   ${totals.matched} matched by title+year`);
  console.log(`   ${totals.unmatched} no work with that title`);
  console.log(`   ${totals.ambiguous} ambiguous — several works share the title and the year cannot separate them`);
  console.log(`   ${totals.yearMismatch} same title, different film`);
  // Never a silent cap: a reader must be able to tell coverage from filtering.
  console.log(`   ${totals.droppedPrecision} captures dropped (region-level, studio set, or nothing identified)`);
  console.log(`   ${totals.droppedDuplicate} duplicate places within a film`);
  console.log(`   ${totals.rows} submissions built, ${totals.withPhoto} with a photograph of the place today`);
  console.log(DRY_RUN ? "   dry run — nothing written" : `   ${totals.written} queued as pending`);

  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length > 0) {
    console.log("\n   most common reasons for not matching:");
    for (const [reason, count] of top) console.log(`     ${count}× ${reason}`);
  }
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
