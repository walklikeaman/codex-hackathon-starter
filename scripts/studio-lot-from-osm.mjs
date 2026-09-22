#!/usr/bin/env node
// One studio lot's fence, from OpenStreetMap, in the shape app/lib/studio-lots.mjs keeps.
//
//   node scripts/studio-lot-from-osm.mjs way/372859983 --slug red-studios --name "Red Studios Hollywood" \
//     --access view_only [--wikidata Q7312287]
//
// The first 25 lots were built by hand and the recipe lived only in that file's header.
// This is the recipe, so a 26th is the same kind of object as the first: the ring as OSM
// draws it, simplified to 2.2 m (Ramer-Douglas-Peucker) and stored at five decimals,
// with the element it came from named so it can be re-checked.
//
// A relation that declares `outer` members means them (Universal's carries 103 building
// footprints beside its one outer ring, and using them all would put the backlot streets
// outside the lot); one with no `outer` at all is assembled from parcels, and every
// member is used (Paramount).
//
// It prints the entry. It does not edit studio-lots.mjs: which element is the lot and
// not the car park beside it is a judgement, and the person making it should paste it.

import process from "node:process";

const args = process.argv.slice(2);
const element = args.find((arg) => /^(way|relation)\/\d+$/.test(arg));
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);

if (!element || !option("slug") || !option("name") || !option("access")) {
  console.error("usage: studio-lot-from-osm.mjs way/<id>|relation/<id> --slug <slug> --name <name> --access view_only|ticketed|open [--wikidata Q…]");
  process.exit(2);
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const TOLERANCE_M = 2.2;

async function overpass(query) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(ENDPOINTS[attempt % ENDPOINTS.length], {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "GloryMap/1.0 (studio lot polygons)" },
      });
      if (response.ok) return await response.json();
    } catch {
      // try the next mirror
    }
    await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1)));
  }
  throw new Error("Overpass did not answer");
}

// Metres between a point and a segment, on a local flat projection — accurate to well
// under a metre at the size of a studio lot.
function offset(point, start, end) {
  const k = Math.cos((point[0] * Math.PI) / 180);
  const project = ([lat, lng]) => [lat * 111_320, lng * 111_320 * k];
  const [px, py] = project(point);
  const [ax, ay] = project(start);
  const [bx, by] = project(end);
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(points) {
  if (points.length < 3) return points;
  let furthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = offset(points[i], points[0], points[points.length - 1]);
    if (distance > furthest) { furthest = distance; index = i; }
  }
  if (furthest <= TOLERANCE_M) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1)).slice(0, -1), ...simplify(points.slice(index))];
}

const round = (value) => Math.round(value * 1e5) / 1e5;

function ringFrom(geometry) {
  const points = geometry.map(({ lat, lon }) => [lat, lon]);
  const first = points[0];
  const last = points[points.length - 1];
  const open = points.length > 2 && first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
  const finish = (ring) => ring.map(([lat, lng]) => [round(lat), round(lng)]);
  if (open.length < 4) return finish(open);
  // A closed loop is simplified as two halves split at the vertex furthest from the
  // first: run as one open line from a point back to itself, the whole ring would
  // collapse to that point.
  let far = 0;
  for (let i = 1; i < open.length; i += 1) {
    if (offset(open[i], open[0], open[0]) > offset(open[far], open[0], open[0])) far = i;
  }
  const out = simplify(open.slice(0, far + 1));
  const back = simplify([...open.slice(far), open[0]]);
  return finish([...out.slice(0, -1), ...back.slice(0, -1)]);
}

const [kind, id] = element.split("/");
const payload = await overpass(`[out:json][timeout:60];${kind}(${id});out geom;`);
const found = payload.elements?.[0];
if (!found) throw new Error(`${element} not found`);

let rings;
if (kind === "way") {
  rings = [ringFrom(found.geometry)];
} else {
  const ways = (found.members ?? []).filter((member) => member.type === "way" && member.geometry);
  const outer = ways.filter((member) => member.role === "outer");
  rings = (outer.length ? outer : ways).map((member) => ringFrom(member.geometry));
}

const entry = {
  slug: option("slug"),
  name: option("name"),
  osm: element,
  wikidata: option("wikidata"),
  access: option("access"),
  rings,
};

const vertices = rings.reduce((total, ring) => total + ring.length, 0);
console.error(`${element} "${found.tags?.name ?? ""}" → ${rings.length} ring(s), ${vertices} vertices`);
const accessName = { view_only: "ACCESS.view_only", ticketed: "ACCESS.ticketed", open: "ACCESS.open" }[entry.access];
console.log(`  {
    slug: ${JSON.stringify(entry.slug)},
    name: ${JSON.stringify(entry.name)},
    osm: ${JSON.stringify(entry.osm)},
    wikidata: ${JSON.stringify(entry.wikidata)},
    access: ${accessName},
    rings: [
${entry.rings.map((ring) => `      [${ring.map(([lat, lng]) => `[${lat},${lng}]`).join(", ")}],`).join("\n")}
    ],
  },`);
