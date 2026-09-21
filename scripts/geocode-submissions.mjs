#!/usr/bin/env node
// Give the queue's pointless rows a point — or say why they cannot have one.
//
//   node scripts/geocode-submissions.mjs --kind movielocations --limit 500
//   node scripts/geocode-submissions.mjs --kind reelstreets --limit 2000 --sql out.sql
//   node scripts/geocode-submissions.mjs --kind wikipedia --limit 2000 --write
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
// `--sql` emits the UPDATEs instead of running them, which was the only shape available
// while this machine held the anon key and writes had to go through the Supabase MCP. It
// still is the right shape when somebody wants to read 12,000 coordinates before they land.
// `--write` is the other half, and it refuses to run without a real service key rather than
// sending PATCHes that anon silently cannot apply — a write that returns 200 and changes
// nothing is the worst of the three outcomes.
//
// **The cache is the reason a direct write matters.** The pass is ~1,320 WDQS queries and
// close to two hours; `--sql` remembers nothing until somebody applies the file, so an
// interrupted run asks the whole thing again. Written as it goes, an interruption costs
// only what it had not yet asked.

import fs from "node:fs";
import process from "node:process";

import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { WIKIDATA_LICENSE, cacheRow } from "../app/lib/geocode-wikidata.mjs";
import { normalizePlaceName } from "../app/lib/place-dedup.mjs";
import {
  AREA_RADIUS_KM, anchorsFrom, headIsInsideAnyCandidate, radiusForAreaIndex, splitPlacePhrase,
} from "../app/lib/place-name-head.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const kind = flag("--kind");
const limit = Number(flag("--limit", "500"));
const sqlPath = flag("--sql");
const WRITE = args.includes("--write");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and a Supabase key in the environment.");
  process.exit(1);
}
// Anon can read this queue and cannot change it. PostgREST answers a refused PATCH with
// 200 and an empty result, so without this check `--write` would report success over
// nothing at all.
if (WRITE && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("--write needs SUPABASE_SERVICE_ROLE_KEY; the anon key cannot change the queue.");
  process.exit(1);
}
if (WRITE && sqlPath) {
  console.error("--write and --sql are two answers to the same question; pick one.");
  process.exit(1);
}

// PostgREST caps a response at 1,000 rows and says nothing about it, so a `--limit 2000`
// that quietly returned 1,000 would look like a batch that finished. Paged deliberately.
const PAGE = 1000;

async function readPage(offset, size) {
  const filters = [
    "select=id,work_id,place_name,area_hint,source_kind",
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
      `${url}/rest/v1/geocode_cache?select=query_norm,lat,lng,source_id,match_reason,candidates&limit=1000&offset=${offset}&order=query_norm.asc`,
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

// **One description of a learned name, and two ways to deliver it.** This was a single
// function that could only produce SQL. Splitting it is what lets `--write` and `--sql`
// carry the same rows rather than two spellings of the same row that drift apart — and a
// cache whose two writers disagreed would be worse than no cache, because the disagreement
// would only show up as a coordinate nobody could explain.
function cacheEntries(decisions) {
  const entries = [];
  for (const [name, decision] of decisions) {
    const norm = normalizePlaceName(name);
    if (!norm) continue;
    const hit = cacheRow(name, decision);
    // Only what an anchor needs: a coordinate and an id per candidate. The label and the
    // population are the chooser's business and it has already had its say.
    const anchors = (decision?.candidates ?? [])
      .filter(Boolean)
      .map((candidate) => ({ wikidata_id: candidate.wikidata_id, lat: candidate.lat, lng: candidate.lng }));
    entries.push({
      query_norm: norm,
      // A null coordinate is a real answer — "we asked, and there is nothing to find" —
      // and two thirds of this corpus answers that way.
      lat: hit ? hit.lat : null,
      lng: hit ? hit.lng : null,
      source: "wikidata",
      source_id: hit ? (hit.source_id ?? "") : null,
      license: hit ? hit.license : null,
      match_reason: hit ? hit.match_reason : (decision?.reason ?? "no_candidate"),
      candidates: anchors.length > 0 ? anchors : null,
    });
  }
  return entries;
}

function cacheStatements(entries) {
  if (entries.length === 0) return [];
  const value = (entry) => "("
    + [
      quote(entry.query_norm),
      entry.lat === null ? "null" : entry.lat,
      entry.lng === null ? "null" : entry.lng,
      "'wikidata'",
      entry.source_id === null ? "null" : quote(entry.source_id),
      entry.license === null ? "null" : quote(entry.license),
      quote(entry.match_reason),
      entry.candidates ? `${quote(JSON.stringify(entry.candidates))}::jsonb` : "null",
    ].join(", ") + ")";
  const statements = [];
  for (let i = 0; i < entries.length; i += 500) {
    statements.push(
      "insert into geocode_cache (query_norm, lat, lng, source, source_id, license, match_reason, candidates) values\n  "
      + entries.slice(i, i + 500).map(value).join(",\n  ")
      + "\non conflict (query_norm) do nothing;",
    );
  }
  return statements;
}

// The provenance a stored coordinate owes, built once for both deliveries. `areaName` sits
// on the accepted record rather than on the split — reading it off `entry` wrote "inside
// undefined" into the provenance of 64 real coordinates. The points were right and the note
// that says WHY they were kept was empty, which is the half that makes a stored coordinate
// arguable rather than merely present. The strength of the check travels with it: "inside
// London" and "inside one of eleven places called London" are different claims, and a
// reader must be able to tell them apart without re-running anything.
function updateFor({ row, head, entry, areaName, verdict }) {
  const among = verdict.considered > 1 ? ` (1 of ${verdict.considered} of that name)` : "";
  return {
    id: row.id,
    patch: {
      lat: head.lat,
      lng: head.lng,
      geocode_source: "wikidata",
      geocode_source_id: head.wikidata_id ?? head.id ?? "",
      geocode_license: WIKIDATA_LICENSE.name,
      geocode_reason: `head ${JSON.stringify(entry.head)} inside ${JSON.stringify(areaName)}${among}`,
    },
  };
}

// **A write that changes nothing must not read as success.** PostgREST answers a PATCH that
// matched no row with 200 and an empty body, and RLS refuses the same way, so the count of
// rows that came back is the only honest measure of what happened. `lat is null` stays in
// the filter for the same reason it is in the SQL: a row somebody has placed since the
// batch was read is not ours to overwrite.
async function writeEverything(updates, entries) {
  const auth = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  let remembered = 0;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const response = await fetch(`${url}/rest/v1/geocode_cache?on_conflict=query_norm`, {
      method: "POST",
      headers: { ...auth, Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) throw new Error(`cache write failed: ${response.status} ${await response.text()}`);
    remembered += chunk.length;
  }

  let applied = 0;
  const failures = [];
  for (const { id, patch } of updates) {
    const response = await fetch(
      `${url}/rest/v1/location_submissions?id=eq.${encodeURIComponent(id)}&lat=is.null`,
      { method: "PATCH", headers: { ...auth, Prefer: "return=representation" }, body: JSON.stringify(patch) },
    );
    if (!response.ok) { failures.push(`${id}: ${response.status} ${(await response.text()).slice(0, 120)}`); continue; }
    const changed = await response.json();
    if (Array.isArray(changed) && changed.length === 1) applied += 1;
    else failures.push(`${id}: matched no row — placed by somebody else since this batch was read`);
  }
  return { remembered, applied, failures };
}

// Ask only what the cache does not already answer, and fold the two together.
async function geocodeCached(names, cache, geocode) {
  const answers = new Map();
  const unknown = [];
  for (const name of names) {
    const cached = cache.get(normalizePlaceName(name));
    if (cached) {
      // The candidates come back with the refusal, or the anchor test would quietly see
      // fewer of them on a second run than on the first.
      answers.set(name, cached.lat === null
        ? { place: null, reason: cached.match_reason, candidates: cached.candidates ?? [] }
        : {
          place: { lat: cached.lat, lng: cached.lng, wikidata_id: cached.source_id },
          reason: cached.match_reason,
          candidates: cached.candidates ?? [],
        });
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
// **The work's own placed rows are an area the row never had to name.**
//
// Measured on the 158 fandom rows, 12.09: 58 refused as `no_area_to_check_against` and 14
// as `area_unknown` — the dominant failure, and intrinsic to the source. Fandom tables name
// the place the SCENE is set in, not the country the camera was in, and the ingest is right
// not to hand that to a geocoder.
//
// But those 158 rows belong to **15 works, and all 15 already hold placed rows** — 217
// points between them. "Somerset House" for Dr. No can be checked against the twenty other
// London points that film already has.
//
// This is allowed where a model's `area_hint` is not: `near` is documented as coming from
// the request rather than from a model, and this comes from the catalogue, which is firmer
// still. It is a sanity check rather than a precision tool — a film shoots across
// continents, so a sibling says "somewhere this film was" and nothing narrower. At
// AREA_RADIUS_KM it would still have caught Bognor in Ontario.
async function readSiblings() {
  const points = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const filters = [
      "select=work_id,lat,lng", "lat=not.is.null", `limit=${PAGE}`, `offset=${offset}`, "order=id.asc",
    ].join("&");
    const response = await fetch(`${url}/rest/v1/location_submissions?${filters}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`sibling read failed: ${response.status}`);
    const batch = await response.json();
    for (const row of batch) {
      if (!row.work_id) continue;
      if (!points.has(row.work_id)) points.set(row.work_id, []);
      points.get(row.work_id).push({ lat: Number(row.lat), lng: Number(row.lng) });
    }
    if (batch.length < PAGE) break;
  }
  return points;
}

const siblings = await readSiblings();
console.error(`${siblings.size} works already hold a placed row`);

const tally = { accepted: 0, head_unknown: 0, area_unknown: 0, outside_area: 0, outside_the_works_own_places: 0 };
for (const entry of split) {
  // "No area to check against" is only fatal when there is nothing ELSE to check against.
  // A row whose work already holds placed points has an area; it simply is not written in
  // the row. Every other refusal — a head we cannot ask about at all — still ends it here.
  const hasSiblings = (siblings.get(entry.row.work_id) ?? []).length > 0;
  const rescuable = entry.refusal === "no_area_to_check_against" && entry.head && hasSiblings;
  if (entry.refusal && !rescuable) {
    tally[entry.refusal] = (tally[entry.refusal] ?? 0) + 1;
    continue;
  }
  const head = headPoints.get(entry.head)?.place;
  if (!head) { tally.head_unknown += 1; continue; }
  // The most specific area a gazetteer knows. A country centroid confirms nothing at a
  // hundred kilometres, which is why the specific end of the address is tried first.
  // The first area the gazetteer can say ANYTHING about — a chosen place, or the
  // candidates it refused to choose between (#149). `london` is a refusal here and a
  // perfectly good thing to sanity-check a London street against.
  const areaIndex = entry.areas.findIndex((name) => anchorsFrom(areaPoints.get(name)).length > 0);
  // The row's own areas first — they are more specific than the film's whole footprint.
  // The siblings are the fallback, not the preference.
  const own = siblings.get(entry.row.work_id) ?? [];
  if (areaIndex < 0 && own.length === 0) { tally.area_unknown += 1; continue; }
  const usingSiblings = areaIndex < 0;
  const anchors = usingSiblings ? own : anchorsFrom(areaPoints.get(entry.areas[areaIndex]));
  // How close the head must be depends on WHICH clause answered: an immediately
  // enclosing street demands metres, a district or county allows a hundred kilometres.
  const verdict = headIsInsideAnyCandidate(
    head, anchors, usingSiblings ? AREA_RADIUS_KM : radiusForAreaIndex(areaIndex),
  );
  if (!verdict.inside) {
    tally[usingSiblings ? "outside_the_works_own_places" : "outside_area"] += 1;
    continue;
  }
  tally.accepted += 1;
  if (usingSiblings) tally.anchored_on_a_sibling = (tally.anchored_on_a_sibling ?? 0) + 1;
  if (verdict.considered > 1) tally.anchored_among_homonyms = (tally.anchored_among_homonyms ?? 0) + 1;
  accepted.push({
    row: entry.row, head, entry, verdict, usingSiblings,
    areaName: usingSiblings ? `${own.length} placed rows of the same work` : entry.areas[areaIndex],
  });
}

console.log(`\n${kind ?? "all"}: ${rows.length} rows`);
for (const [reason, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(26)} ${String(count).padStart(6)}`);
}
console.log(`  accepted = ${(100 * tally.accepted / Math.max(rows.length, 1)).toFixed(1)}% of the batch`);

const learned = cacheEntries(new Map([...areaResult.asked, ...headResult.asked]));

if (WRITE) {
  const updates = accepted.map(updateFor);
  const { remembered, applied, failures } = await writeEverything(updates, learned);
  console.log(`\nplaced ${applied} of ${updates.length} rows · remembered ${remembered} names`);
  if (failures.length > 0) {
    console.log(`  ${failures.length} did not apply:`);
    for (const failure of failures.slice(0, 10)) console.log(`   ${failure}`);
    // A partial write is not a success, and a run that reported one would be believed.
    process.exitCode = 1;
  }
} else if (!sqlPath) {
  for (const { row, head, entry } of accepted.slice(0, 10)) {
    console.log(`   ✓ ${entry.head} < ${entry.areas.join(" < ")} -> ${head.lat.toFixed(4)},${head.lng.toFixed(4)}`);
  }
  console.log("\nNothing written. Pass --write to apply, or --sql <path> to emit the UPDATEs.");
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
  for (const accept of accepted) {
    const { id, patch } = updateFor(accept);
    out.push(
      `update location_submissions set lat = ${patch.lat}, lng = ${patch.lng}, `
      + `geocode_source = 'wikidata', geocode_source_id = ${quote(patch.geocode_source_id)}, `
      + `geocode_license = ${quote(patch.geocode_license)}, geocode_reason = ${quote(patch.geocode_reason)} `
      + `where id = ${quote(id)} and lat is null;`,
    );
  }
  const cacheSql = cacheStatements(learned);
  if (cacheSql.length > 0) {
    out.unshift(
      `-- ${learned.length} names learned this run, remembered so the next one does not ask again.`,
      ...cacheSql,
      "",
    );
  }
  fs.writeFileSync(sqlPath, out.join("\n"));
  console.log(`\nwrote ${sqlPath} (${accepted.length} updates)`);
}
