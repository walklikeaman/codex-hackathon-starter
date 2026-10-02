// Confirming that a published pin stands on the street its name says.
//
// A quarter of the places a story trail stops at are streets, not buildings — "Cable
// Street, London E1", "Therapia Road, Honor Oak", "102 Poplar Road" — held at a point a
// location site published, at `none` precision, and therefore left off every walk. A
// street has no footprint to snap to. What OSM does have is the street itself, named: a
// pin within a few metres of a road OSM calls "Cable Street" is on Cable Street.
//
// So this confirms and never moves. The pin stays where its source put it (somewhere along
// the street, which is all the source claimed), and the precision becomes `street` — the
// claim "you can stand here", which is exactly what a trail stop needs. A house number is
// not confirmed by this and is not claimed: "102 Poplar Road" becomes Poplar Road.
//
// OSM data is ODbL; the confirming way is kept on the place, as a building snap keeps its
// footprint.

import { coordinateOrNull } from "./numbers.mjs";
import { normalizePlaceName } from "./place-dedup.mjs";
import { placeHead } from "./place-name-head.mjs";
import { OVERPASS_ENDPOINT, OVERPASS_TIMEOUT_S, RATE_LIMIT_STATUSES, USER_AGENT } from "./building-snap.mjs";

// How far the pin may be from the street's centre line. A road is ~10 m wide and a
// published pin is often on the pavement or a doorstep; past this it is on another street.
export const STREET_RADIUS_M = 30;

// The last word that makes a name a street rather than a building on it.
const STREET_WORDS = new Set([
  "street", "st", "road", "rd", "lane", "avenue", "ave", "square", "terrace", "mews", "place",
  "row", "walk", "gardens", "close", "crescent", "way", "grove", "hill", "yard", "drive",
  "parade", "embankment", "passage", "court", "alley", "boulevard", "circus",
]);

// "102 Poplar Road, Herne Hill" → "Poplar Road"; "Bourne Woods" → null.
export function streetName(name) {
  const head = placeHead(name).replace(/^\d+[a-z]?\s+/i, "").trim();
  const words = normalizePlaceName(head).split(" ").filter(Boolean);
  return words.length >= 2 && STREET_WORDS.has(words.at(-1)) ? head : null;
}

export function streetQuery(lat, lng, radiusM = STREET_RADIUS_M) {
  const point = coordinateOrNull(lat, lng);
  if (!point) return null;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
way["highway"]["name"](around:${Math.round(radiusM)},${point.lat},${point.lng});
out geom tags;`;
}

// Distance from a point to a polyline — an open line, unlike a footprint ring, so there is
// no closing edge from its last node back to its first.
const METRES_PER_DEGREE = 111320;
export function metresToLine(point, line) {
  if (!point || !Array.isArray(line) || line.length === 0) return null;
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const project = (p) => [(p.lng - point.lng) * scale * METRES_PER_DEGREE, (p.lat - point.lat) * METRES_PER_DEGREE];
  if (line.length === 1) return Math.round(Math.hypot(...project(line[0])));
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = project(line[i - 1]);
    const [bx, by] = project(line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return Math.round(best);
}

export function parseStreets(response) {
  return (Array.isArray(response?.elements) ? response.elements : [])
    .filter((element) => element?.type === "way" && element?.tags?.highway && element?.tags?.name)
    .map((element) => ({
      osm_id: `way/${element.id}`,
      name: element.tags.name,
      line: (element.geometry ?? []).map((node) => coordinateOrNull(node?.lat, node?.lon ?? node?.lng)).filter(Boolean),
    }));
}

// The decision. Exact name equality after normalising — "Cable Street" is not "Cable Street
// Mews" — and the nearest matching way within the radius. Several segments of one street
// are one street, so more than one match is not ambiguity.
export function confirmStreet({ lat, lng, name, streets, radiusM = STREET_RADIUS_M } = {}) {
  const point = coordinateOrNull(lat, lng);
  const wanted = normalizePlaceName(streetName(name) ?? "");
  if (!point || !wanted) return { confirmed: false, reason: point ? "not_a_street_name" : "no_coordinate" };
  let best = null;
  for (const street of Array.isArray(streets) ? streets : []) {
    if (normalizePlaceName(street.name) !== wanted) continue;
    const metres = metresToLine(point, street.line);
    if (metres !== null && metres <= radiusM && (!best || metres < best.metres)) best = { street, metres };
  }
  if (!best) return { confirmed: false, reason: "no_such_street_here" };
  return { confirmed: true, reason: "on_named_street", geocode_precision: "street", osm_street_id: best.street.osm_id, street_name: best.street.name, metres: best.metres };
}

export async function resolveStreet({ lat, lng, name, fetchImpl = fetch, endpoint = OVERPASS_ENDPOINT } = {}) {
  if (!streetName(name)) return { confirmed: false, reason: "not_a_street_name" };
  const query = streetQuery(lat, lng);
  if (!query) return { confirmed: false, reason: "no_coordinate" };
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!response?.ok) {
    return { confirmed: false, reason: "overpass_unavailable", rate_limited: RATE_LIMIT_STATUSES.includes(response?.status) };
  }
  return confirmStreet({ lat, lng, name, streets: parseStreets(await response.json()) });
}
