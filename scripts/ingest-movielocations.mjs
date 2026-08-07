#!/usr/bin/env node
//
// Filming locations from movie-locations.com, matched to works by title and year.
//
//   node --env-file=.env.local scripts/ingest-movielocations.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-movielocations.mjs
//
// Reads data/movielocations/films.ndjson straight from the harvester. No model
// call anywhere in this pipeline — the site's captions separate film, scene and
// address with colons, so a regex found the place during the scrape.
//
// It does not geocode: the site has no coordinates at all, and a point invented
// inside an import is a guess buried where nobody looks. Rows land with an
// address, no lat/lng, and no claim to have located anything.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";
import {
  dedupeByPlaceKey,
  locationToSubmission,
  matchWork,
  SOURCE,
} from "../app/lib/movielocations-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = path.resolve(String(arg("data", "data/movielocations")));
const WRITE_BATCH = 200;

async function* readNdjson(file) {
  const stream = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* partial last line while harvesting */ }
  }
}

async function loadWorksByTitle(db) {
  const byTitle = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("works")
      .select("id, title, title_norm, kind, year").range(from, from + PAGE - 1);
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
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const file = path.join(DATA_DIR, "films.ndjson");
  try { await stat(file); } catch {
    console.error(`No ${file}. Harvest it first:`);
    console.error("  tools/scraperai/.venv/bin/python tools/scraperai/movielocations.py");
    process.exit(1);
  }

  console.log(`${SOURCE.site}: licence ${SOURCE.license} — leads, not licensed content`);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const works = await loadWorksByTitle(db);
  console.log(`${works.size} distinct titles in the catalogue\n`);

  const totals = { films: 0, matched: 0, unmatched: 0, ambiguous: 0, yearMismatch: 0,
                   rows: 0, dropped: 0, duplicate: 0, withPhoto: 0, written: 0 };
  const pending = [];

  for await (const film of readNdjson(file)) {
    totals.films += 1;
    const { work, reason } = matchWork(film, works);
    if (!work) {
      if (/year mismatch/.test(reason)) totals.yearMismatch += 1;
      else if (/share this title/.test(reason)) totals.ambiguous += 1;
      else totals.unmatched += 1;
      continue;
    }

    const candidates = film.locations ?? [];
    const built = candidates
      .map((location) => locationToSubmission(location, { workId: work.id, film }))
      .filter(Boolean);
    totals.dropped += candidates.length - built.length;

    const rows = dedupeByPlaceKey(built);
    totals.duplicate += built.length - rows.length;
    totals.matched += 1;
    totals.rows += rows.length;
    totals.withPhoto += rows.filter((r) => r.source_media).length;

    if (rows.length > 0) {
      console.log(`${work.title}${work.year ? ` (${work.year})` : ""}  ← ${film.title} (${film.year})  ${rows.length} places`);
    }
    if (!DRY_RUN) pending.push(...rows);
  }

  const toWrite = DRY_RUN ? [] : dedupeAcrossFilms(pending);
  if (toWrite.length < pending.length) {
    console.log(`\n   ${pending.length - toWrite.length} rows collided across films on the same work`);
  }
  if (!DRY_RUN && toWrite.length > 0) {
    for (let i = 0; i < toWrite.length; i += WRITE_BATCH) {
      const batch = toWrite.slice(i, i + WRITE_BATCH);
      const { error } = await db.from("location_submissions")
        .upsert(batch, { onConflict: "work_id,place_key" });
      if (error) throw new Error(error.message);
      totals.written += batch.length;
    }
  }

  console.log(`\n${totals.films} films read`);
  console.log(`   ${totals.matched} matched by title+year`);
  console.log(`   ${totals.unmatched} no work with that title`);
  console.log(`   ${totals.ambiguous} ambiguous — title shared, year cannot separate`);
  console.log(`   ${totals.yearMismatch} same title, different film`);
  console.log(`   ${totals.dropped} locations dropped (no caption, or a place too long to be one)`);
  console.log(`   ${totals.duplicate} duplicate places within a film`);
  console.log(`   ${totals.rows} submissions built, ${totals.withPhoto} with a photograph of the place`);
  console.log(DRY_RUN ? "   dry run — nothing written" : `   ${totals.written} queued as pending`);
}

main().catch((failure) => { console.error(failure.message); process.exit(1); });
