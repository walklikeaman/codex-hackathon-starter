#!/usr/bin/env node
//
// Filming locations from city permit records.
//
//   node --env-file=.env.local scripts/ingest-film-permits.mjs [--city paris] [--work <uuid>] [--dry-run]
//
// Unlike the Wikipedia enrichment this makes no model call at all. The city geocoded
// the address when it issued the permit, so there is nothing to extract and nothing to
// resolve — which is why it is fast, free, and the strongest source in the project.
//
// It still writes `pending`. A permit is authorisation to shoot, not evidence the
// footage reached the film, and productions abandon locations.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildRecordsUrl,
  CITIES,
  dedupeByAddress,
  isSearchableTitle,
  permitToSubmission,
} from "../app/lib/film-permits.mjs";
import { USER_AGENT } from "../app/lib/wikipedia-source.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const CITY_ID = String(arg("city", "paris"));
const ONE_WORK = arg("work", null);
const LIMIT = Number.parseInt(arg("limit", "20"), 10) || 20;

// Open portals are generous, but a loop over every work is still a loop. One request a
// second is invisible to them and costs us nothing.
const REQUEST_GAP_MS = 1000;

async function fetchPage(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (response.status === 429) {
    const wait = (Number(response.headers.get("retry-after")) || 30) * 1000;
    console.log(`   rate limited — waiting ${wait / 1000}s`);
    await sleep(wait);
    return fetchPage(url);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Every permit for one production, following the API's paging.
async function permitsFor(city, title) {
  const collected = [];
  let offset = 0;

  for (;;) {
    const url = buildRecordsUrl(city, title, { limit: 100, offset });
    if (!url) break;

    const page = await fetchPage(url);
    const results = page.results ?? [];
    collected.push(...results);

    // A page shorter than the ceiling is the last one. Trusting total_count instead
    // would loop forever on a portal that reports it lazily.
    if (results.length < 100) break;
    offset += 100;
    // Opendatasoft refuses offsets past 10,000; no single production comes close, and
    // stopping is better than a 400 halfway through.
    if (offset >= 10_000) break;
    await sleep(REQUEST_GAP_MS);
  }

  return collected;
}

async function main() {
  const env = process.env;
  const city = CITIES[CITY_ID];
  if (!city) {
    console.error(`Unknown city "${CITY_ID}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Add it to .env.local and run with:");
    console.error("  node --env-file=.env.local scripts/ingest-film-permits.mjs");
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  console.log(`${city.label}: ${city.license}, covers ${city.coverage.from}–${city.coverage.to ?? "present"}`);

  let query = db.from("works").select("id, title, kind, year");
  if (ONE_WORK) query = query.eq("id", ONE_WORK);
  const { data: works, error } = await query.limit(LIMIT);
  if (error) throw new Error(error.message);
  if (!works?.length) { console.log("Nothing to ingest."); return; }

  for (const work of works) {
    if (!isSearchableTitle(work.title)) {
      // A short or single-word title matches other productions by substring, and the
      // records come back looking exactly as authoritative as a real match.
      console.log(`\n${work.title}\n   title too generic to search safely — skipped`);
      continue;
    }

    let records;
    try {
      records = await permitsFor(city, work.title);
    } catch (failure) {
      console.log(`\n${work.title}\n   ${failure.message}`);
      continue;
    }

    const rows = dedupeByAddress(records.map((record) =>
      permitToSubmission(record, { city, workId: work.id, workTitle: work.title })));

    console.log(`\n${work.title}`);
    if (records.length === 0) {
      // The Paris set begins in 2016. An empty answer for a classic is the correct
      // answer, not a failure to report.
      console.log("   no permits on record");
      await sleep(REQUEST_GAP_MS);
      continue;
    }
    console.log(`   ${records.length} permits → ${rows.length} distinct addresses`);

    if (DRY_RUN) {
      for (const row of rows.slice(0, 5)) {
        console.log(`     ${row.place_name} (${row.lat.toFixed(4)}, ${row.lng.toFixed(4)})`);
      }
      await sleep(REQUEST_GAP_MS);
      continue;
    }
    if (rows.length === 0) { await sleep(REQUEST_GAP_MS); continue; }

    const { error: writeError } = await db
      .from("location_submissions")
      .upsert(rows, { onConflict: "work_id,place_key" });

    if (writeError) console.log(`   write failed: ${writeError.message}`);
    else console.log(`   queued ${rows.length} as pending`);

    await sleep(REQUEST_GAP_MS);
  }
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
