#!/usr/bin/env node
//
// Give the links already promoted the sentence their source said.
//
//   node --env-file=~/.glorymap.env scripts/backfill-link-statements.mjs          # report
//   node --env-file=~/.glorymap.env scripts/backfill-link-statements.mjs --write  # apply
//
// promote_place now writes a link's statement as it promotes (see quoteFrom). The 4,688
// links promoted before that carry none, and a card with no statement falls back to a
// sentence built from the relation kind — "Finnegans Wake was filmed at 6 Alexandra
// Terrace", on production, where the plaque says Joyce wrote part of it there.
//
// Same rule, same function: only sources whose words we may print, never shortened, and
// never over a statement that is already there.

import process from "node:process";

import { QUOTABLE_SOURCES, quoteFrom } from "../app/lib/promote-submission.mjs";

const WRITE = process.argv.includes("--write");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const sources = [...QUOTABLE_SOURCES].join(",");
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await (await fetch(
    `${url}/rest/v1/location_submissions?select=id,work_id,place_id,source_kind,source_sentence`
      + `&place_id=not.is.null&source_kind=in.(${sources})&order=id.asc&limit=1000&offset=${offset}`,
    { headers },
  )).json();
  if (!Array.isArray(page)) throw new Error(`read failed: ${JSON.stringify(page).slice(0, 200)}`);
  rows.push(...page);
  if (page.length < 1000) break;
}

// One quote per link: the first a quotable row offers, in id order so a rerun agrees.
const quotes = new Map();
for (const row of rows) {
  const key = `${row.work_id}|${row.place_id}`;
  if (quotes.has(key)) continue;
  const quote = quoteFrom(row);
  if (quote) quotes.set(key, { work_id: row.work_id, place_id: row.place_id, quote, source: row.source_kind });
}

console.log(`${rows.length} promoted rows from ${sources} · ${quotes.size} links with a sentence we may print`);
let written = 0;
let alreadySet = 0;
for (const { work_id, place_id, quote, source } of quotes.values()) {
  if (!WRITE) { console.log(`  [${source}] ${quote.slice(0, 110)}`); continue; }
  const response = await fetch(
    `${url}/rest/v1/work_place_links?work_id=eq.${work_id}&place_id=eq.${place_id}`
      + `&relation_kind=eq.filming_location&statement=is.null`,
    { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ statement: quote }) },
  );
  if (!response.ok) throw new Error(`write failed: ${response.status} ${await response.text()}`);
  // The count that came back is the measure, not the requests sent: a link that already
  // had a statement matches nothing, and says so.
  const changed = await response.json();
  if (Array.isArray(changed) && changed.length > 0) written += changed.length; else alreadySet += 1;
}
if (WRITE) console.log(`wrote ${written} statement(s) · ${alreadySet} link(s) already had one`);
else console.log("\nNothing written. Pass --write to apply.");
