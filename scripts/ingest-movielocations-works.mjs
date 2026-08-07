#!/usr/bin/env node
//
// Add the movie-locations.com films the catalogue does not hold.
//
//   node --env-file=.env.local scripts/ingest-movielocations-works.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-movielocations-works.mjs
//
// Same timidity as the ReelStreets works import, for the same reason: with no
// external id there is no unique index to lean on, so the duplicate check lives
// in code, and a mistake creates a second row for a film we already hold. A film
// is created only when NOTHING with its title exists.
//
// Unlike MovieMaps, every one of these carries a year — which is what lets a
// later source tell two same-titled films apart.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";
import { filmToWork, matchWork, SOURCE } from "../app/lib/movielocations-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = path.resolve(String(arg("data", "data/movielocations")));
const WRITE_BATCH = 500;

async function* readNdjson(file) {
  const stream = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* partial last line */ }
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

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const file = path.join(DATA_DIR, "films.ndjson");
  try { await stat(file); } catch {
    console.error(`No ${file}. Harvest it first.`); process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const works = await loadWorksByTitle(db);
  console.log(`${works.size} distinct titles already in the catalogue\n`);

  const totals = { films: 0, held: 0, ambiguous: 0, noLocations: 0, duplicateInFeed: 0, create: 0, written: 0 };
  const rows = [];
  const claimed = new Map();

  for await (const film of readNdjson(file)) {
    totals.films += 1;
    if ((film.locations ?? []).length === 0) { totals.noLocations += 1; continue; }

    const { work, reason } = matchWork(film, works);
    if (work) { totals.held += 1; continue; }
    if (!/no work with this title/.test(reason ?? "")) { totals.ambiguous += 1; continue; }

    const row = filmToWork(film);
    if (!row) continue;
    const seen = claimed.get(row.title_norm);
    if (seen && (seen.year === row.year || seen.year === null || row.year === null)) {
      totals.duplicateInFeed += 1; continue;
    }
    claimed.set(row.title_norm, row);
    rows.push(row);
    totals.create += 1;
  }

  console.log(`${totals.films} films read`);
  console.log(`   ${totals.held} already in the catalogue`);
  console.log(`   ${totals.ambiguous} share a title with something we hold — left alone`);
  console.log(`   ${totals.noLocations} had no location at all`);
  console.log(`   ${totals.duplicateInFeed} duplicate titles within movie-locations itself`);
  console.log(`   ${totals.create} to create, source='${SOURCE.kind}', ${rows.filter((r) => r.year).length} with a year`);

  if (DRY_RUN) {
    for (const row of rows.slice(0, 10)) console.log(`     ${row.year ?? "----"}  ${row.title}`);
    console.log("\n   dry run — nothing written");
    return;
  }

  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    const { error } = await db.from("works").insert(batch);
    if (error) throw new Error(error.message);
    totals.written += batch.length;
  }
  console.log(`\n   ${totals.written} works created`);
  console.log("   now run: node --env-file=.env.local scripts/ingest-movielocations.mjs");
}

main().catch((failure) => { console.error(failure.message); process.exit(1); });
