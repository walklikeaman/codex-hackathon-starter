#!/usr/bin/env node
//
// Which Fandom wikis are worth reading, measured before anything is spent on them.
//
//   node --env-file=.env.local scripts/discover-fandom.mjs --wikis 12 --pages 8
//   node --env-file=.env.local scripts/discover-fandom.mjs --out data/fandom/candidates.json
//
// **This writes nothing to the database.** It reads `works`, asks Wikidata where those
// works have Fandom pages, fetches a sample of those pages, and reports what shape the
// location content is in. The report is the product: it says how many rows the free path
// (tables and lists) would get and how many pages only a model could read, per wiki, so
// the decision to spend is made on numbers rather than on the size of a fandom.
//
// Fandom's own wiki index is behind a Cloudflare challenge and is never touched — see
// [[fandom-discovery]]. Every request here is either Wikidata's SPARQL endpoint or a
// wiki's own `api.php`, both of which are open and both of which are paced.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { licenceAllows, locationSection, parseLocationRows } from "../app/lib/fandom-source.mjs";
import { IDS_PER_QUERY, WIKIDATA_SPARQL, chunk, classifyPage, pairsQuery, rankWikis, splitFandomId } from "../app/lib/fandom-discovery.mjs";

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
};
const WIKI_LIMIT = Number(arg("wikis", 12));
const PAGE_LIMIT = Number(arg("pages", 8));
const OUT = arg("out", null);

const UA = { "User-Agent": "GloryMap/1.0 (filming locations; nakonechnyi.n@gmail.com)" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikidata asks for five seconds between queries and the wikis get the crawler's own
// 0.7s. Neither is negotiable: the whole reason this pass is cheap is that it is small,
// and a small pass that hammers a free endpoint is not cheap, it is rude.
const WIKIDATA_DELAY = 5000;
const WIKI_DELAY = 700;

// **A skipped chunk is lost catalogue, not a lost request.** The first real run lost 2 of
// 16 chunks to 502 and reported 754 overlapping works as if that were the answer — it was
// 12% short and nothing said so. The endpoint 502s under load and answers the same query
// seconds later, so a retry costs one wait and buys back a chunk of the catalogue.
const SPARQL_ATTEMPTS = 3;

async function sparql(query) {
  const url = `${WIKIDATA_SPARQL}?${new URLSearchParams({ query, format: "json" })}`;
  let last;
  for (let attempt = 1; attempt <= SPARQL_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { ...UA, Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(120_000) });
      if (response.ok) return (await response.json()).results.bindings;
      last = new Error(`wikidata http ${response.status}`);
      // 4xx is the query's fault and will fail again identically; only a server-side
      // refusal is worth waiting out.
      if (response.status < 500 && response.status !== 429) throw last;
    } catch (failure) {
      last = failure;
      if (failure?.name === "AbortError") last = new Error("wikidata timeout");
    }
    if (attempt < SPARQL_ATTEMPTS) await sleep(WIKIDATA_DELAY * attempt);
  }
  throw last ?? new Error("wikidata failed");
}

async function wikiApi(wiki, params) {
  const url = `https://${wiki}.fandom.com/api.php?${new URLSearchParams({ ...params, format: "json" })}`;
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${wiki}: http ${response.status}`);
  return response.json();
}

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = process.env;
  if (!url || !(key || anon)) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL and a key (anon is enough — this reads only)");
    process.exit(1);
  }
  const db = createClient(url, key || anon, { auth: { persistSession: false } });

  const held = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("works").select("id, title, year, imdb_id")
      .not("imdb_id", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const work of data) held.set(work.imdb_id, work);
    if (data.length < 1000) break;
  }
  console.log(`catalogue: ${held.size} works carry an IMDb id`);

  // Only the ids we hold, in chunks. Paging the whole property answered 502 — see
  // [[fandom-discovery]].
  const pairs = [];
  let lostChunks = 0;
  const batches = chunk([...held.keys()]);
  for (const [index, batch] of batches.entries()) {
    let rows;
    try {
      rows = await sparql(pairsQuery(batch));
    } catch (failure) {
      // Retried already. A chunk still failing is 400 works this run did not ask about,
      // and the total below says so rather than presenting a short count as the answer.
      lostChunks += 1;
      console.log(`\n  wikidata chunk ${index + 1}: ${failure.message} (after ${SPARQL_ATTEMPTS} attempts)`);
      await sleep(WIKIDATA_DELAY);
      continue;
    }
    for (const row of rows) {
      const split = splitFandomId(row.fandom.value);
      if (split) pairs.push({ ...split, imdb: row.imdb.value });
    }
    process.stdout.write(`\r  wikidata: chunk ${index + 1}/${batches.length}, ${pairs.length} usable pairs`);
    if (index < batches.length - 1) await sleep(WIKIDATA_DELAY);
  }
  console.log();

  const ranked = rankWikis(pairs, { heldImdbIds: new Set(held.keys()) });
  const overlap = ranked.reduce((sum, w) => sum + w.works, 0);
  console.log(`overlap: ${overlap} of our works have a Fandom page, across ${ranked.length} wikis`
    + (lostChunks ? `  — INCOMPLETE: ${lostChunks} chunk(s) failed, up to ${lostChunks * IDS_PER_QUERY} works unasked` : ""));
  console.log();

  const report = [];
  for (const candidate of ranked.slice(0, WIKI_LIMIT)) {
    const { wiki, entries } = candidate;

    let licence;
    try {
      const info = await wikiApi(wiki, { action: "query", meta: "siteinfo", siprop: "rightsinfo" });
      licence = info?.query?.rightsinfo ?? {};
    } catch (failure) {
      console.log(`${wiki.padEnd(26)} unreachable: ${failure.message}`);
      continue;
    }
    await sleep(WIKI_DELAY);

    if (!licenceAllows(licence)) {
      // memory-alpha is CC-BY-NC and is the third-largest wiki in the join. Refused here
      // rather than after fetching its pages.
      console.log(`${wiki.padEnd(26)} ${String(candidate.works).padStart(5)} works   SKIPPED — licence: ${(licence.text || "unreadable").slice(0, 34)}`);
      report.push({ wiki, works: candidate.works, skipped: "licence" });
      continue;
    }

    const shapes = { table: 0, list: 0, prose: 0, no_section: 0 };
    let rows = 0;
    const sample = entries.slice(0, PAGE_LIMIT);
    for (const entry of sample) {
      try {
        const parsed = (await wikiApi(wiki, { action: "parse", page: entry.page, prop: "wikitext" })).parse;
        const section = locationSection(parsed?.wikitext?.["*"] ?? "");
        const found = section ? parseLocationRows(section) : [];
        shapes[classifyPage({ section, rows: found })] += 1;
        rows += found.length;
      } catch { shapes.no_section += 1; }
      await sleep(WIKI_DELAY);
    }

    const readable = shapes.table + shapes.list;
    console.log(`${wiki.padEnd(26)} ${String(candidate.works).padStart(5)} works   `
      + `sampled ${sample.length}: ${readable} readable (${shapes.table}t/${shapes.list}l), `
      + `${shapes.prose} prose, ${shapes.no_section} none  → ${rows} rows`);
    report.push({ wiki, works: candidate.works, sampled: sample.length, ...shapes, rows });
  }

  const totals = report.reduce((sum, r) => ({
    readable: sum.readable + (r.table ?? 0) + (r.list ?? 0),
    prose: sum.prose + (r.prose ?? 0),
    rows: sum.rows + (r.rows ?? 0),
  }), { readable: 0, prose: 0, rows: 0 });
  console.log(`\nsampled total: ${totals.readable} pages readable for free, ${totals.prose} would need a model, ${totals.rows} rows`);

  if (OUT) {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), overlap, lost_chunks: lostChunks, report }, null, 2));
    console.log(`${OUT}: written`);
  }
}

if (process.argv[1]?.endsWith("discover-fandom.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
