#!/usr/bin/env node
//
// Give our works their Wikidata ids, so the Wikipedia pipeline can see them at all.
//
//   node --env-file=.env.local scripts/backfill-wikidata-ids.mjs --dry-run
//   node --env-file=.env.local scripts/backfill-wikidata-ids.mjs
//
// **This is the constraint the whole Wikipedia side has been living under.** `works` holds
// 7,063 rows, 6,044 of them carrying an IMDb id — and **28** carrying a Wikidata id.
// `enrich-from-wikipedia.mjs` selects on `wikidata_id is not null`, so it has never been
// able to see more than those twenty-eight. Nine of them are the books; sixteen are films.
//
// The id is not looked up by title. It is joined on the IMDb id we already hold, through
// Wikidata's **P345**, which is the same property `fandom-discovery` uses. Measured over a
// sample of 400 of our ids, 12.09: **393 matched (98.3%)**, of which 391 resolved to one
// item and 2 to several.
//
// Nothing is guessed. An id matching more than one Wikidata item is skipped and counted —
// see `singleMatches`. A work already carrying an id is never touched.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  IDS_PER_QUERY, QUERY_GAP_MS, chunk, createSparqlClient, singleMatches, valuesClause,
} from "../app/lib/wikidata-sparql.mjs";

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
};
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const WRITE_BATCH = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function backfillQuery(imdbIds) {
  return `SELECT ?imdb ?item WHERE {
  VALUES ?imdb { ${valuesClause(imdbIds)} }
  ?item wdt:P345 ?imdb .
}`;
}

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = process.env;
  // A dry run only reads. Demanding the writing credential to rehearse a write is the
  // wrong way round.
  const readKey = key || (DRY_RUN ? anon : null);
  if (!url || !readKey) {
    console.error(DRY_RUN
      ? "Missing NEXT_PUBLIC_SUPABASE_URL, and neither a service nor an anon key"
      : "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (writing needs the service key)");
    process.exit(1);
  }
  const db = createClient(url, readKey, { auth: { persistSession: false } });

  // Only works that lack an id. A work already carrying one is never overwritten: ours may
  // have come from a source that knew better than a bare id join.
  const works = [];
  for (let from = 0; works.length < LIMIT; from += 1000) {
    const { data, error } = await db.from("works").select("id, title, imdb_id")
      .not("imdb_id", "is", null).is("wikidata_id", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    works.push(...data);
    if (data.length < 1000) break;
  }
  const queue = works.slice(0, LIMIT === Infinity ? works.length : LIMIT);
  console.log(`${queue.length} works carry an IMDb id and no Wikidata id`);
  if (queue.length === 0) return;

  const byImdb = new Map(queue.map((work) => [work.imdb_id, work]));
  const sparql = createSparqlClient();

  const found = new Map();
  const ambiguous = [];
  let lostChunks = 0;
  const batches = chunk([...byImdb.keys()], IDS_PER_QUERY);

  for (const [index, batch] of batches.entries()) {
    let rows;
    try {
      rows = await sparql(backfillQuery(batch));
    } catch (failure) {
      // Retried already inside the client. A chunk still failing is 400 works this run did
      // not ask about, and the total says so rather than passing a short count off as done.
      lostChunks += 1;
      console.log(`\n  chunk ${index + 1}/${batches.length}: ${failure.message}`);
      await sleep(QUERY_GAP_MS);
      continue;
    }
    const { single, ambiguous: split } = singleMatches(rows);
    for (const [imdb, qid] of single) found.set(imdb, qid);
    ambiguous.push(...split);
    process.stdout.write(`\r  chunk ${index + 1}/${batches.length}: ${found.size} resolved, ${ambiguous.length} ambiguous`);
    if (index < batches.length - 1) await sleep(QUERY_GAP_MS);
  }
  console.log();

  const missing = queue.length - found.size - ambiguous.length;
  console.log(`\nresolved ${found.size} of ${queue.length}`
    + `  (${ambiguous.length} ambiguous, ${missing} unknown to Wikidata)`
    + (lostChunks ? `  — INCOMPLETE: ${lostChunks} chunk(s) failed, up to ${lostChunks * IDS_PER_QUERY} works unasked` : ""));

  for (const row of ambiguous.slice(0, 5)) {
    console.log(`  ambiguous: ${row.id} → ${row.qids.join(", ")} (${byImdb.get(row.id)?.title ?? "?"})`);
  }

  const updates = [...found].map(([imdb, qid]) => ({ id: byImdb.get(imdb).id, wikidata_id: qid }));
  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written");
    for (const row of updates.slice(0, 8)) {
      const work = queue.find((candidate) => candidate.id === row.id);
      console.log(`   ${work.imdb_id}  ${row.wikidata_id.padEnd(12)} ${work.title.slice(0, 48)}`);
    }
    return;
  }

  // One statement per row rather than an upsert of the whole record: an upsert would carry
  // every other column along and a null in any of them would overwrite real data.
  let written = 0;
  for (let index = 0; index < updates.length; index += WRITE_BATCH) {
    const batch = updates.slice(index, index + WRITE_BATCH);
    await Promise.all(batch.map(({ id, wikidata_id }) => db.from("works")
      .update({ wikidata_id })
      .eq("id", id)
      .is("wikidata_id", null)));
    written += batch.length;
    process.stdout.write(`\r  written ${written}/${updates.length}`);
  }
  console.log(`\ndone: ${written} works now carry a Wikidata id`);
}

if (process.argv[1]?.endsWith("backfill-wikidata-ids.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
