#!/usr/bin/env node
//
// Verified queue rows → facts in the graph.
//
//   node scripts/promote-verified.mjs --dry-run       # group and count, write nothing
//   node scripts/promote-verified.mjs --limit 200     # a city's worth first
//   node scripts/promote-verified.mjs                 # everything verified
//
// The review has produced verdicts since August and none of them ever reached the graph:
// measured 21.09.2026, 4,703 rows say `verified` and `location_submissions.place_id` is
// null on all 45,448. The map draws 70 places worldwide and the panel reads "Checked
// places · 0" over a city holding thousands of rows we have actually checked.
//
// The arithmetic — which rows are one place, what that place may claim — is in
// app/lib/promote-submission.mjs, with tests. This file only reads, writes and counts.
//
// **Four tables, in an order that never leaves a half-made fact visible.** A place is only
// mappable once it has evidence (`place_is_mappable` requires a row in `place_evidence`),
// so the place is written first, its evidence second, and the work links third. A crash
// between them leaves a place nothing points at, which is invisible rather than wrong.

import { createClient } from "@supabase/supabase-js";

import {
  groupIntoPlaces, linksFromGroup, matchExistingPlace, placeFromGroup, quoteFrom,
} from "../app/lib/promote-submission.mjs";
import { reviewSubmission } from "../app/lib/submission-review.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 0) || null;
const PAGE = 1000;

function env(name) {
  const found = process.env[name];
  if (found) return found;
  throw new Error(`${name} is not set — see .env.local`);
}

const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const COLUMNS = "id, work_id, place_name, lat, lng, source_kind, source_url, source_sentence,"
  + " status, status_reason, wikidata_id, corroborated_by, place_id, geocode_source, geocode_source_id";

async function readVerified() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("location_submissions")
      .select(COLUMNS)
      .eq("status", "verified")
      .is("place_id", null)
      .not("lat", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`queue read failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    process.stderr.write(`\rread ${rows.length}`);
    if (data.length < PAGE) break;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  process.stderr.write("\n");
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

// The graph as it stands, so a promotion lands ON an existing place rather than beside it.
async function readPlaces() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("places")
      .select("id, wikidata_id, name, lat, lng")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`places read failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// One transaction per place, in the database.
//
// The link-evidence trigger is deferrable and checked at COMMIT, and PostgREST gives every
// request its own transaction — so a client that writes the link and then its evidence
// fails on the first commit. `promote_place` (migration 20260921010000) writes the place,
// its evidence, its links, each link's evidence and the submission marks together.
async function promote(place, placeId, rows) {
  const { data, error } = await client.rpc("promote_place", {
    p_place: place,
    p_place_id: placeId,
    p_rows: rows,
  });
  if (error) throw new Error(`promote failed (${place.name}): ${error.message}`);
  return data;
}

const verified = await readVerified();
const existing = await readPlaces();
console.log(`${verified.length} verified rows with a coordinate and no place yet`);
console.log(`${existing.length} places already in the graph`);

const groups = groupIntoPlaces(verified);
console.log(`${groups.length} distinct places`);

// The review's own score for a row, recomputed rather than stored: the rules are the
// authority, and a score copied at write time goes stale the moment they change.
const scores = new Map(verified.map((row) => [row.id, reviewSubmission(row).score]));
const scoreOf = (row) => scores.get(row.id) ?? 0;

const counts = { inserted: 0, matched: 0, links: 0, evidence: 0, submissions: 0, skipped: 0 };

for (const [index, group] of groups.entries()) {
  const place = placeFromGroup(group, { scoreOf });
  if (!place?.name) { counts.skipped += 1; continue; }

  const match = matchExistingPlace(group, existing);
  const rows = group.rows.map((row) => ({
    submission_id: row.id,
    work_id: row.work_id ?? null,
    source_url: row.source_url ?? null,
    source_kind: row.source_kind ?? null,
    snippet: row.source_sentence ?? null,
    // The source's own sentence, only where we may print it — see quoteFrom. promote_place
    // puts it on the link if the link has none; it never overwrites one.
    quote: quoteFrom(row),
    confidence: scoreOf(row),
  }));
  const links = linksFromGroup("counted-only", group.rows, { scoreOf });

  if (DRY_RUN) {
    if (match) counts.matched += 1; else counts.inserted += 1;
    counts.evidence += rows.length;
    counts.links += links.length;
    counts.submissions += rows.length;
  } else {
    const placeId = await promote(place, match?.id ?? null, rows);
    if (match) {
      counts.matched += 1;
    } else {
      counts.inserted += 1;
      existing.push({ id: placeId, wikidata_id: place.wikidata_id, name: place.name, lat: place.lat, lng: place.lng });
    }
    counts.evidence += rows.length;
    counts.links += links.length;
    counts.submissions += rows.length;
  }

  if (index % 200 === 0) process.stderr.write(`\r${index} of ${groups.length}`);
}
process.stderr.write("\n");

console.log(`\n${DRY_RUN ? "would write" : "wrote"}:`);
console.log(`  places inserted       ${counts.inserted}`);
console.log(`  matched existing      ${counts.matched}`);
console.log(`  evidence rows         ${counts.evidence}`);
console.log(`  work links            ${counts.links}`);
console.log(`  submissions linked    ${counts.submissions}`);
if (counts.skipped) console.log(`  skipped (no name)     ${counts.skipped}`);
