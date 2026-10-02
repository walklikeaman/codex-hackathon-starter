#!/usr/bin/env node
// Snap places of unknown precision onto the OSM building — or street — that confirms them (#45, #73).
//
//   node --env-file=.env.local scripts/snap-places.mjs --scenes          # a story trail's stops
//   node --env-file=.env.local scripts/snap-places.mjs --limit 300       # then everything else
//
// /api/snap takes whichever unsnapped places come first. This asks it about the ones that
// matter first: a place a story trail stops at is a walk somebody is offered, and a stop
// of unknown precision is left off the walk. Measured on 2026-10-03, 40 of the 164 places
// a trail stops at were `none` — held at a published point, unconfirmed.
//
// Each place goes through the same handler /api/snap serves, one at a time, at the pace
// Overpass tolerates; the rules for when a building confirms a place are in
// app/lib/building-snap.mjs. Nothing is written for a place that is not confirmed.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { createSnapHandler, MAX_PAUSE_MS, PAUSE_BETWEEN_CALLS_MS } from "../app/api/snap/route.js";

const args = process.argv.slice(2);
const SCENES = args.includes("--scenes");
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 1000);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function pages(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Unconfirmed places with a coordinate; those a trail stops at first.
const vague = await pages(() => db.from("places").select("id, name")
  .in("geocode_precision", ["none", "city"]).is("osm_building_id", null).is("osm_street_id", null).not("lat", "is", null));
const onTrail = new Set((await pages(() => db.from("work_place_links").select("place_id").not("scene_id", "is", null)))
  .map((link) => link.place_id));
const queue = [...vague.filter((place) => onTrail.has(place.id)), ...(SCENES ? [] : vague.filter((place) => !onTrail.has(place.id)))]
  .slice(0, limit);
console.log(`${vague.length} unconfirmed places, ${vague.filter((place) => onTrail.has(place.id)).length} on a trail; asking about ${queue.length}`);

const token = `snap-${Math.random().toString(36).slice(2)}`;
const handler = createSnapHandler({ env: { ...process.env, ENRICH_TOKEN: token }, logError: (message) => console.log(`    ! ${message}`) });

const tally = {};
let pause = PAUSE_BETWEEN_CALLS_MS;
for (const [index, place] of queue.entries()) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  const response = await handler(new Request("http://local/api/snap", {
    method: "POST",
    headers: { "content-type": "application/json", "x-enrich-token": token },
    body: JSON.stringify({ place_id: place.id }),
  }));
  const [result] = (await response.json()).results ?? [];
  const reason = result?.snapped ? "snapped" : result?.reason ?? `http_${response.status}`;
  tally[reason] = (tally[reason] ?? 0) + 1;
  // Being throttled slows the rest of the run, and never speeds back up.
  if (reason === "overpass_unavailable") pause = Math.min(pause * 2, MAX_PAUSE_MS);
  console.log(`  ${reason.padEnd(24)} ${place.name.slice(0, 60)}${result?.snapped ? `  → ${result.street_name ?? result.building_name ?? result.osm_building_id}${result.moved_m === undefined ? "" : ` (${result.moved_m} m)`}` : ""}`);
}
console.log("\n", tally);
