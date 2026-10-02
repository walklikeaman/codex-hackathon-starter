#!/usr/bin/env node
// Fill story trails for the best-known films in a city (#73).
//
//   node --env-file=.env.local scripts/fill-story-trails.mjs --city london --limit 25
//   node --env-file=.env.local scripts/fill-story-trails.mjs --city london --limit 25 --redo
//   node --env-file=.env.local scripts/fill-story-trails.mjs --city london --dry
//
// A trail is only worth extracting for a film that has somewhere to walk: this picks
// films (not series — a multi-season story has no single order) with at least
// --min-walkable places in the city held to a walkable precision, ranked by IMDb fame
// (score × log10 votes, the same measure "Known for" uses), and runs each through the
// same handler /api/trail serves, in this process.
//
// --redo re-extracts films that already have a trail. It removes only what a trail
// added — the scenes, their evidence rows, and the scene number on each filming link —
// never the links themselves, which carry their own evidence and predate any trail.
//
// Costs money: three passes of gpt-5-mini per film, about a cent and a half.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { createTrailHandler } from "../app/api/trail/route.js";

const CITIES = Object.freeze({
  london: { south: 51.28, north: 51.70, west: -0.51, east: 0.33 },
  "new-york": { south: 40.49, north: 40.92, west: -74.26, east: -73.70 },
  "los-angeles": { south: 33.70, north: 34.34, west: -118.67, east: -118.15 },
  paris: { south: 48.81, north: 48.91, west: 2.22, east: 2.47 },
});
const WALKABLE = new Set(["point", "street", "building"]);

const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const city = option("city", "london");
const box = CITIES[city];
const limit = Number(option("limit", 20));
const minWalkable = Number(option("min-walkable", 3));
const REDO = args.includes("--redo");
const DRY = args.includes("--dry");

if (!box) {
  console.error(`unknown --city; one of ${Object.keys(CITIES).join(", ")}`);
  process.exit(2);
}

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

// Films with at least `minWalkable` walkable places in the box, by fame.
async function candidates() {
  const links = await pages(() => db
    .from("work_place_links")
    .select("work_id, places!inner ( id, lat, lng, geocode_precision, osm_building_id )")
    .gte("places.lat", box.south).lte("places.lat", box.north)
    .gte("places.lng", box.west).lte("places.lng", box.east));
  const walkable = new Map();
  for (const link of links) {
    const place = link.places;
    if (!place.osm_building_id && !WALKABLE.has(String(place.geocode_precision))) continue;
    if (!walkable.has(link.work_id)) walkable.set(link.work_id, new Set());
    walkable.get(link.work_id).add(place.id);
  }
  const ids = [...walkable].filter(([, set]) => set.size >= minWalkable).map(([id]) => id);

  const works = [];
  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200);
    const { data, error } = await db.from("works").select("id, title, year, kind").in("id", slice).eq("kind", "film");
    if (error) throw new Error(error.message);
    const { data: ratings, error: ratingError } = await db.from("work_ratings")
      .select("work_id, score, votes").eq("source", "imdb").gte("votes", 1000).in("work_id", slice);
    if (ratingError) throw new Error(ratingError.message);
    const fame = new Map(ratings.map((row) => [row.work_id, (row.score / 10) * Math.log10(row.votes)]));
    for (const work of data) {
      if (fame.has(work.id)) works.push({ ...work, fame: fame.get(work.id), walkable: walkable.get(work.id).size });
    }
  }
  return works.sort((left, right) => right.fame - left.fame).slice(0, limit);
}

async function existingScenes(workIds) {
  const { data, error } = await db.from("scenes").select("id, work_id").in("work_id", workIds);
  if (error) throw new Error(error.message);
  return data;
}

// Only what a trail added: scene numbers on links, scene evidence, the scenes.
async function clearTrail(workId) {
  const { data: scenes, error } = await db.from("scenes").select("id").eq("work_id", workId);
  if (error) throw new Error(error.message);
  const ids = scenes.map((scene) => scene.id);
  if (ids.length === 0) return 0;
  for (const [step, run] of [
    ["unlink", () => db.from("work_place_links").update({ scene_id: null, narrative_order: null }).in("scene_id", ids)],
    ["evidence", () => db.from("place_evidence").delete().eq("subject_type", "scene").in("subject_id", ids)],
    ["scenes", () => db.from("scenes").delete().in("id", ids)],
  ]) {
    const { error: stepError } = await run();
    if (stepError) throw new Error(`${step}: ${stepError.message}`);
  }
  return ids.length;
}

const works = await candidates();
const already = new Set((await existingScenes(works.map((work) => work.id))).map((row) => row.work_id));
console.log(`${works.length} films in ${city} with ${minWalkable}+ walkable places; ${already.size} already have a trail${REDO ? " (redoing)" : ""}`);

if (DRY) {
  for (const work of works) console.log(`  ${work.fame.toFixed(1)}  ${work.walkable} walkable  ${already.has(work.id) ? "trail " : "      "}${work.title} (${work.year})`);
  process.exit(0);
}

const token = `fill-${Math.random().toString(36).slice(2)}`;
const handler = createTrailHandler({
  env: { ...process.env, ENRICH_TOKEN: token },
  logError: (message, detail) => console.log(`    ! ${message} ${detail?.message ?? ""}`),
});

let scenes = 0;
let filled = 0;
for (const work of works) {
  if (already.has(work.id)) {
    if (!REDO) { console.log(`  skip   ${work.title} (has a trail)`); continue; }
    await clearTrail(work.id);
  }
  const started = Date.now();
  const response = await handler(new Request("http://local/api/trail", {
    method: "POST",
    headers: { "content-type": "application/json", "x-enrich-token": token },
    body: JSON.stringify({ work_id: work.id }),
  }));
  const body = await response.json().catch(() => ({}));
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`  ${String(response.status)}    ${work.title.padEnd(40)} ${String(seconds).padStart(3)}s  placed=${body.extracted ?? 0} linked=${body.linked ?? "-"} ${body.reason ?? body.error ?? ""}`);
  if (body.extracted) { scenes += body.extracted; filled += 1; }
}
console.log(`\n${filled} trails, ${scenes} scenes.`);
