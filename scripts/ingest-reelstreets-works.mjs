#!/usr/bin/env node
//
// Add the ReelStreets films the catalogue does not hold, so their locations have
// something to attach to.
//
//   node --env-file=.env.local scripts/ingest-reelstreets-works.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-reelstreets-works.mjs
//
// The last ingest matched 33 of 438 films; 403 simply are not in our catalogue,
// because the catalogue came from MovieMaps and ReelStreets is largely British
// cinema. Those 403 have locations, photographs and no work to hang them on.
//
// This is riskier than the MovieMaps works import and the difference is worth
// naming. There, every film carried an IMDb id, so `on conflict (imdb_id) do
// nothing` let the DATABASE guarantee no duplicate. Here there is no external id
// and no unique index to lean on, so the check has to happen in code — and a
// mistake creates a second row for a film we already hold, which is worse than
// creating nothing.
//
// So the rule is deliberately timid: a film is created only when matchWork()
// finds NOTHING with its title. A title that already exists — matched or
// ambiguous — is left alone. Two ReelStreets films sharing a title and year are
// also left alone, since we cannot tell whether they are one film or two.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";
import { filmToWork, matchWork, SOURCE } from "../app/lib/reelstreets-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number.parseInt(arg("limit", "0"), 10) || 0;
const DATA_DIR = path.resolve(String(arg("data", "data/reelstreets")));
const WRITE_BATCH = 500;

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

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const placesFile = path.join(DATA_DIR, "places.ndjson");
  try {
    await stat(placesFile);
  } catch {
    console.error(`No ${placesFile}. Extract it first.`);
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const works = await loadWorksByTitle(db);
  console.log(`${works.size} distinct titles already in the catalogue\n`);

  const totals = { films: 0, held: 0, ambiguous: 0, noLocations: 0, duplicateInFeed: 0, create: 0, written: 0 };
  const rows = [];
  // Titles claimed within this run, so two ReelStreets films with the same
  // title do not both get created — the second would be indistinguishable from
  // the first for every future matcher.
  const claimed = new Map();
  let processed = 0;

  for await (const film of readNdjson(placesFile)) {
    totals.films += 1;
    if (LIMIT && processed >= LIMIT) break;
    processed += 1;

    // A film with nothing usable to say is not worth a catalogue row. This is
    // not a filter on quality, it is on there being any point: a work with no
    // location contributes nothing and cannot be told from a stub.
    const usable = (film.captures ?? []).filter((c) => c.kind === "real" && c.place);
    if (usable.length === 0) { totals.noLocations += 1; continue; }

    const { work, reason } = matchWork(film, works);
    if (work) { totals.held += 1; continue; }
    if (!/no work with this title/.test(reason ?? "")) { totals.ambiguous += 1; continue; }

    const row = filmToWork(film, normalizeWorkTitle);
    if (!row) continue;

    const seen = claimed.get(row.title_norm);
    if (seen && (seen.year === row.year || seen.year === null || row.year === null)) {
      totals.duplicateInFeed += 1;
      continue;
    }
    claimed.set(row.title_norm, row);
    rows.push(row);
    totals.create += 1;
  }

  console.log(`${totals.films} films read`);
  console.log(`   ${totals.held} already in the catalogue`);
  console.log(`   ${totals.ambiguous} share a title with something we hold — left alone`);
  console.log(`   ${totals.noLocations} had no usable location`);
  console.log(`   ${totals.duplicateInFeed} duplicate titles within ReelStreets itself`);
  console.log(`   ${totals.create} to create — all as kind=film, source='${SOURCE.kind}'`);
  const withYear = rows.filter((r) => r.year !== null).length;
  console.log(`   ${withYear} of them carry a year (MovieMaps gave none at all)`);

  if (DRY_RUN) {
    for (const row of rows.slice(0, 10)) console.log(`     ${row.year ?? "----"}  ${row.title}`);
    console.log("\n   dry run — nothing written");
    return;
  }

  for (let index = 0; index < rows.length; index += WRITE_BATCH) {
    const batch = rows.slice(index, index + WRITE_BATCH);
    const { error } = await db.from("works").insert(batch);
    if (error) throw new Error(error.message);
    totals.written += batch.length;
  }

  console.log(`\n   ${totals.written} works created`);
  console.log("   now re-run: node --env-file=.env.local scripts/ingest-reelstreets.mjs");
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
