#!/usr/bin/env node
// Give the queue's pointless rows a point — or say why they cannot have one.
//
//   node scripts/geocode-submissions.mjs --kind movielocations --limit 500
//   node scripts/geocode-submissions.mjs --kind reelstreets --limit 2000 --sql out.sql
//
// 13,637 rows have no coordinate and **not one of them has ever been through a
// geocoder**: every located row in the queue got its point from the source it was scraped
// from (`geocode_source` is moviemaps / open_plaques / reelstreets / opendata_paris).
// This is the first pass that asks a gazetteer.
//
// Measured on 120 movie-locations rows:
//
//   the name as stored                          0.8%
//   the first clause alone                     31.7%   <- and Zorba lands in Colorado
//   head + area, kept only if it lands inside   8.3%   <- and nothing lands in Colorado
//
// The middle number is the tempting one and it is the wrong one. Rules and the failures
// that produced them: app/lib/place-name-head.mjs.
//
// SQL rather than a direct write, like the other scripts here: this machine holds the
// anon key and not `SUPABASE_SERVICE_ROLE_KEY`, so writes go through the Supabase MCP.

import fs from "node:fs";
import process from "node:process";

import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { WIKIDATA_LICENSE, cacheRow } from "../app/lib/geocode-wikidata.mjs";
import { normalizePlaceName } from "../app/lib/place-dedup.mjs";
import {
  headIsInsideArea, radiusForAreaIndex, splitPlacePhrase,
} from "../app/lib/place-name-head.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const kind = flag("--kind");
const limit = Number(flag("--limit", "500"));
const sqlPath = flag("--sql");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and a Supabase key in the environment.");
  process.exit(1);
}

// PostgREST caps a response at 1,000 rows and says nothing about it, so a `--limit 2000`
// that quietly returned 1,000 would look like a batch that finished. Paged deliberately.
const PAGE = 1000;

async function readPage(offset, size) {
  const filters = [
    "select=id,place_name,area_hint,source_kind",
    "status=eq.pending",
    "lat=is.null",
    kind ? `source_kind=eq.${kind}` : null,
    `limit=${size}`,
    `offset=${offset}`,
    "order=id.asc",
  ].filter(Boolean).join("&");
  const response = await fetch(`${url}/rest/v1/location_submissions?${filters}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`queue read failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`queue read returned ${typeof rows}, not an array`);
  return rows;
}

async function readRows() {
  const rows = [];
  while (rows.length < limit) {
    const page = await readPage(rows.length, Math.min(PAGE, limit - rows.length));
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.slice(0, limit);
}

function quote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}


// ---------- the cache ----------
//
// 12,659 pointless rows reduce to 10,579 distinct names, which is ~1,320 WDQS queries and
// close to two hours at the module's own politeness gap, before a single 429. A job that
// long WILL be interrupted, so every answer is remembered — including the refusals, which
// are two thirds of them. An ordinary house is not in Wikidata and asking again next week
// will not change that.
async function readCache() {
  const cache = new Map();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/geocode_cache?select=query_norm,lat,lng,source_id,match_reason&limit=1000&offset=${offset}&order=query_norm.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`cache read failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`cache read returned ${typeof page}, not an array`);
    for (const row of page) cache.set(row.query_norm, row);
    if (page.length < 1000) break;
  }
  return cache;
}

// Written as SQL alongside the coordinates, because this machine has the anon key and the
// cache is service-role-write like the rest of the graph.
function cacheStatements(decisions) {
  const rows = [];
  for (const [name, decision] of decisions) {
    const hit = cacheRow(name, decision);
    const norm = normalizePlaceName(name);
    if (!norm) continue;
    rows.push(hit
      ? `(${quote(norm)}, ${hit.lat}, ${hit.lng}, 'wikidata', ${quote(hit.source_id ?? "")}, ${quote(hit.license)}, ${quote(hit.match_reason)})`
      : `(${quote(norm)}, null, null, 'wikidata', null, null, ${quote(decision?.reason ?? "no_candidate")})`);
  }
  if (rows.length === 0) return [];
  const statements = [];
  for (let i = 0; i < rows.length; i += 500) {
    statements.push(
      "insert into geocode_cache (query_norm, lat, lng, source, source_id, license, match_reason) values\n  "
      + rows.slice(i, i + 500).join(",\n  ")
      + "\non conflict (query_norm) do nothing;",
    );
  }
  return statements;
}

// Ask only what the cache does not already answer, and fold the two together.
async function geocodeCached(names, cache, geocode) {
  const answers = new Map();
  const unknown = [];
  for (const name of names) {
    const cached = cache.get(normalizePlaceName(name));
    if (cached) {
      answers.set(name, cached.lat === null
        ? { place: null, reason: cached.match_reason }
        : { place: { lat: cached.lat, lng: cached.lng, wikidata_id: cached.source_id }, reason: cached.match_reason });
    } else {
      unknown.push(name);
    }
  }
  console.error(`${names.length} names · ${names.length - unknown.length} already cached · ${unknown.length} to ask`);
  if (unknown.length === 0) return { answers, asked: new Map() };
  const fresh = await geocode(unknown);
  for (const [name, decision] of fresh) answers.set(name, decision);
  return { answers, asked: fresh };
}

const cache = await readCache();
console.error(`cache holds ${cache.size} names`);
const rows = await readRows();
console.error(`${rows.length} rows without a point${kind ? ` (${kind})` : ""}`);

const split = rows.map((row) => ({ row, ...splitPlacePhrase(row.place_name, { areaHint: row.area_hint }) }));
const askable = split.filter((entry) => !entry.refusal);

const geocode = createGeocoder({
  onNote: (note) => process.stderr.write(`\r${JSON.stringify(note).slice(0, 100)}          `),
});

// Areas first: they are cities and counties, so they resolve far more often than the
// venues do, and a head with no area is refused anyway.
const areaNames = [...new Set(askable.flatMap((entry) => entry.areas))];
const headNames = [...new Set(askable.map((entry) => entry.head))];
console.error(`${askable.length} askable · ${headNames.length} heads · ${areaNames.length} areas`);

const areaResult = await geocodeCached(areaNames, cache, geocode);
const headResult = await geocodeCached(headNames, cache, geocode);
const areaPoints = areaResult.answers;
const headPoints = headResult.answers;
process.stderr.write("\n");

const accepted = [];
const tally = { accepted: 0, head_unknown: 0, area_unknown: 0, outside_area: 0 };
for (const entry of split) {
  if (entry.refusal) {
    tally[entry.refusal] = (tally[entry.refusal] ?? 0) + 1;
    continue;
  }
  const head = headPoints.get(entry.head)?.place;
  if (!head) { tally.head_unknown += 1; continue; }
  // The most specific area a gazetteer knows. A country centroid confirms nothing at a
  // hundred kilometres, which is why the specific end of the address is tried first.
  const areaIndex = entry.areas.findIndex((name) => areaPoints.get(name)?.place);
  if (areaIndex < 0) { tally.area_unknown += 1; continue; }
  const area = areaPoints.get(entry.areas[areaIndex]).place;
  // How close the head must be depends on WHICH clause answered: an immediately
  // enclosing street demands metres, a district or county allows a hundred kilometres.
  if (!headIsInsideArea(head, area, radiusForAreaIndex(areaIndex))) {
    tally.outside_area += 1;
    continue;
  }
  tally.accepted += 1;
  accepted.push({ row: entry.row, head, entry, areaName: entry.areas[areaIndex] });
}

console.log(`\n${kind ?? "all"}: ${rows.length} rows`);
for (const [reason, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(26)} ${String(count).padStart(6)}`);
}
console.log(`  accepted = ${(100 * tally.accepted / Math.max(rows.length, 1)).toFixed(1)}% of the batch`);

if (!sqlPath) {
  for (const { row, head, entry } of accepted.slice(0, 10)) {
    console.log(`   ✓ ${entry.head} < ${entry.areas.join(" < ")} -> ${head.lat.toFixed(4)},${head.lng.toFixed(4)}`);
  }
  console.log("\nNothing written. Pass --sql <path> to emit the UPDATEs.");
} else {
  const out = [
    "-- Coordinates for queue rows that had none, from Wikidata (CC0).",
    "-- Rules and the failures that produced them: app/lib/place-name-head.mjs.",
    "-- Each row's point is the gazetteer entry for its HEAD, kept only because it landed",
    "-- inside the AREA the row itself names. Reversible:",
    "--   update location_submissions set lat=null, lng=null, geocode_source=null,",
    "--     geocode_source_id=null, geocode_license=null, geocode_reason=null",
    "--   where geocode_source = 'wikidata';",
    "",
  ];
  for (const { row, head, entry, areaName } of accepted) {
    // `areaName` sits on the accepted record, not on the split — reading it off `entry`
    // wrote "inside undefined" into the provenance of 64 real coordinates. The points were
    // right and the note that says WHY they were kept was empty, which is the half that
    // makes a stored coordinate arguable rather than merely present.
    const reason = `head ${JSON.stringify(entry.head)} inside ${JSON.stringify(areaName)}`;
    out.push(
      `update location_submissions set lat = ${head.lat}, lng = ${head.lng}, `
      + `geocode_source = 'wikidata', geocode_source_id = ${quote(head.wikidata_id ?? head.id ?? "")}, `
      + `geocode_license = ${quote(WIKIDATA_LICENSE.name)}, geocode_reason = ${quote(reason)} `
      + `where id = ${quote(row.id)} and lat is null;`,
    );
  }
  const learned = new Map([...areaResult.asked, ...headResult.asked]);
  const cacheSql = cacheStatements(learned);
  if (cacheSql.length > 0) {
    out.unshift(
      `-- ${learned.size} names learned this run, remembered so the next one does not ask again.`,
      ...cacheSql,
      "",
    );
  }
  fs.writeFileSync(sqlPath, out.join("\n"));
  console.log(`\nwrote ${sqlPath} (${accepted.length} updates)`);
}
