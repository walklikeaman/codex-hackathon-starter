// Snapping a geocoded coordinate to the building it actually refers to.
//
// Geocoders answer "Bradbury Building" with a point on Broadway — the street the
// address sits on — not with the building. OSM publishes the footprint, so we can
// move the pin onto the actual structure and say `building` instead of `street`.
//
// The whole risk here is confidence. Moving a pin is asserting "it is THIS building",
// and in a dense block there are a dozen candidates within 40 m. So the rule is:
//
//   * a point INSIDE exactly one footprint identifies that building — containment is
//     proof, and it works in dense streets where proximity never would;
//   * otherwise, exactly ONE building in range is accepted;
//   * anything else is ambiguous, and an ambiguous snap is not a snap. The original
//     point survives and the precision badge does not improve.
//
// Nothing here fabricates a coordinate: every snapped position is either a mapped
// entrance node or a point proven to lie inside a real mapped footprint.
//
// OSM data is ODbL — attribution is required wherever a snapped coordinate is shown.

import { haversineMeters } from "./geo.mjs";
import { coordinateOrNull, finiteOrNull } from "./numbers.mjs";

export const OSM_ATTRIBUTION = Object.freeze({
  label: "OpenStreetMap contributors",
  license: "ODbL 1.0",
  license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
  source_url: "https://www.openstreetmap.org/copyright",
});

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// A geocoder that lands on a street centroid is typically tens of metres out; beyond
// this the "nearest building" stops being evidence about the address.
export const DEFAULT_SEARCH_RADIUS_M = 60;
export const MAX_SEARCH_RADIUS_M = 150;

// A snap that moves the pin further than this is not a correction, it is a different
// place — the case is a footprint covering a whole complex (an airport, a campus).
export const MAX_SNAP_DISTANCE_M = 100;

// Overpass asks callers to bound their own queries and identify themselves.
export const OVERPASS_TIMEOUT_S = 25;
export const USER_AGENT = "GloryMap/1.0 (+https://github.com/walklikeaman/glorymap)";

export function clampSearchRadius(value) {
  const radius = finiteOrNull(value);
  if (radius === null || radius <= 0) return DEFAULT_SEARCH_RADIUS_M;
  return Math.min(radius, MAX_SEARCH_RADIUS_M);
}

// --- the query ---------------------------------------------------------------

// Buildings around the point, plus any tagged entrance nodes in the same area. The
// timeout is inside the query because that is where Overpass enforces it.
export function overpassQuery(lat, lng, radiusM = DEFAULT_SEARCH_RADIUS_M) {
  const point = coordinateOrNull(lat, lng);
  if (!point) return null;
  const radius = Math.round(clampSearchRadius(radiusM));
  const at = `${radius},${point.lat},${point.lng}`;

  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
  way["building"](around:${at});
  relation["building"](around:${at});
);
out geom tags;
node(around:${at})["entrance"];
out tags;`;
}

// --- geometry ----------------------------------------------------------------
// Latitude and longitude are scaled independently to get metres, which is an affine
// transform — so inside/outside and the area centroid can be computed on the raw
// degrees and only distances need the projection.

const METRES_PER_DEGREE = 111320;

function toRing(geometry) {
  const ring = (Array.isArray(geometry) ? geometry : [])
    .map((node) => coordinateOrNull(node?.lat, node?.lon ?? node?.lng))
    .filter(Boolean);
  // Overpass closes ways by repeating the first node; the algorithms below close the
  // ring themselves, so a repeated vertex would only add a zero-length edge.
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) ring.pop();
  }
  return ring;
}

// Ray casting. A point exactly on the boundary is not reliably classified by any
// implementation of this, which is fine — a boundary case is settled by the distance
// test instead.
export function pointInRing(point, ring) {
  if (!point || !Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const crossingLng = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < crossingLng) inside = !inside;
  }
  return inside;
}

// Area-weighted centroid of the ring.
//
// Computed relative to the first vertex, which matters more than it looks: a building
// is ~40 m across, so on raw degrees every cross product is a difference of numbers
// near 51.5 × 0.12 that has to resolve to about 1e-8. Double precision loses most of
// that to cancellation and the centroid drifts off the building. Shifting to a local
// origin keeps every term at the scale of the building itself.
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const origin = ring[0];
  let twiceArea = 0;
  let lat = 0;
  let lng = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[i].lng - origin.lng;
    const ay = ring[i].lat - origin.lat;
    const bx = ring[j].lng - origin.lng;
    const by = ring[j].lat - origin.lat;
    const cross = bx * ay - ax * by;
    twiceArea += cross;
    lng += (bx + ax) * cross;
    lat += (by + ay) * cross;
  }
  // A degenerate ring (all vertices collinear) has zero area and no centroid.
  if (twiceArea === 0) return null;
  return coordinateOrNull(origin.lat + lat / (3 * twiceArea), origin.lng + lng / (3 * twiceArea));
}

// Distance from a point to the ring's nearest edge — not to its nearest vertex, which
// would read a long wall as far away when you are standing against it.
export function metresToRing(point, ring) {
  if (!point || !Array.isArray(ring) || ring.length === 0) return null;
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const project = (p) => [(p.lng - point.lng) * scale * METRES_PER_DEGREE, (p.lat - point.lat) * METRES_PER_DEGREE];

  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = project(ring[i]);
    const [bx, by] = project(ring[j]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    // Clamped projection onto the segment: t outside [0,1] means the nearest point is
    // an endpoint, not a spot along the wall.
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
    const nx = ax + t * dx;
    const ny = ay + t * dy;
    best = Math.min(best, Math.hypot(nx, ny));
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

// --- parsing -----------------------------------------------------------------

export function parseBuildings(response) {
  const elements = Array.isArray(response?.elements) ? response.elements : [];
  return elements
    .filter((element) => element?.type === "way" || element?.type === "relation")
    // `building=no` is OSM's way of saying "explicitly not a building" — it matches
    // the ["building"] filter but must never be snapped to.
    .filter((element) => element?.tags?.building && element.tags.building !== "no")
    .map((element) => ({
      osm_id: `${element.type}/${element.id}`,
      name: element.tags?.name ?? null,
      tags: element.tags ?? {},
      ring: toRing(element.geometry),
    }))
    .filter((building) => building.ring.length >= 3);
}

export function parseEntrances(response) {
  const elements = Array.isArray(response?.elements) ? response.elements : [];
  return elements
    .filter((element) => element?.type === "node" && element?.tags?.entrance)
    .filter((element) => element.tags.entrance !== "no")
    .map((element) => ({
      osm_id: `node/${element.id}`,
      kind: element.tags.entrance,
      position: coordinateOrNull(element.lat, element.lon ?? element.lng),
    }))
    .filter((entrance) => entrance.position);
}

// An entrance belongs to a building when it is one of that building's own nodes —
// Overpass gives a way's full geometry, so the coordinates match exactly.
export function entranceFor(building, entrances) {
  const onBuilding = (Array.isArray(entrances) ? entrances : []).filter((entrance) =>
    building.ring.some((node) => node.lat === entrance.position.lat && node.lng === entrance.position.lng));
  if (onBuilding.length === 0) return null;
  // A main entrance beats a side door; otherwise any mapped entrance will do.
  return onBuilding.find((entrance) => entrance.kind === "main") ?? onBuilding[0];
}

// --- the decision ------------------------------------------------------------

// Which building does this point refer to? Containment first, because in a dense
// street every candidate is within a few metres of every other.
export function chooseBuilding(point, buildings, { radiusM = DEFAULT_SEARCH_RADIUS_M } = {}) {
  const candidates = Array.isArray(buildings) ? buildings : [];
  if (!point || candidates.length === 0) return { building: null, reason: "no_buildings" };

  const containing = candidates.filter((building) => pointInRing(point, building.ring));
  if (containing.length === 1) return { building: containing[0], reason: "inside_footprint" };
  // Nested or overlapping footprints: we cannot say which one was meant.
  if (containing.length > 1) return { building: null, reason: "ambiguous_overlap" };

  const radius = clampSearchRadius(radiusM);
  const inRange = candidates.filter((building) => {
    const metres = metresToRing(point, building.ring);
    return metres !== null && metres <= radius;
  });
  if (inRange.length === 1) return { building: inRange[0], reason: "only_building_nearby" };
  if (inRange.length === 0) return { building: null, reason: "no_buildings" };
  return { building: null, reason: "ambiguous_neighbours" };
}

// The snapped position for a chosen building, in order of how well it is evidenced:
// a mapped entrance, then the centroid when it genuinely lies inside the footprint.
// A centroid can fall OUTSIDE an L-shaped or U-shaped building, and a pin in the
// courtyard of a building is not on the building.
export function snapPosition(point, building, entrances = []) {
  const entrance = entranceFor(building, entrances);
  if (entrance) return { position: entrance.position, via: "entrance", entrance_id: entrance.osm_id };

  const centroid = ringCentroid(building.ring);
  if (centroid && pointInRing(centroid, building.ring)) {
    return { position: centroid, via: "centroid", entrance_id: null };
  }
  // A concave footprint whose centroid escapes it: the original point is already
  // inside, so it is the best position we can honestly offer.
  if (pointInRing(point, building.ring)) {
    return { position: point, via: "original_inside", entrance_id: null };
  }
  return null;
}

// The whole decision, as data. Never throws, never invents a coordinate, and always
// returns something the caller can store.
export function snapToBuilding({ lat, lng, buildings, entrances = [], radiusM } = {}) {
  const point = coordinateOrNull(lat, lng);
  const unchanged = (reason) => ({
    snapped: false, reason, lat: point?.lat ?? null, lng: point?.lng ?? null,
    geocode_precision: null, osm_building_id: null, building_name: null,
    moved_m: 0, footprint: null, attribution: OSM_ATTRIBUTION,
  });

  if (!point) return unchanged("no_coordinate");

  const { building, reason } = chooseBuilding(point, buildings, { radiusM });
  if (!building) return unchanged(reason);

  const snap = snapPosition(point, building, entrances);
  if (!snap) return unchanged("no_usable_position");

  const moved = Math.round(haversineMeters([point.lat, point.lng], [snap.position.lat, snap.position.lng]));
  // A footprint big enough to move the pin this far is a complex, not an address;
  // the building is still confirmed if we were inside it, but the pin stays put.
  if (moved > MAX_SNAP_DISTANCE_M) {
    if (!pointInRing(point, building.ring)) return unchanged("snap_too_far");
    return {
      ...unchanged("kept_point_inside_large_footprint"),
      snapped: true, geocode_precision: "building",
      osm_building_id: building.osm_id, building_name: building.name,
      footprint: building.ring,
    };
  }

  return {
    snapped: true,
    reason,
    via: snap.via,
    lat: snap.position.lat,
    lng: snap.position.lng,
    geocode_precision: "building",
    osm_building_id: building.osm_id,
    building_name: building.name,
    entrance_id: snap.entrance_id,
    moved_m: moved,
    footprint: building.ring,
    attribution: OSM_ATTRIBUTION,
  };
}

// --- fetching ----------------------------------------------------------------

// Overpass says "slow down" with 429, and with 504 when its slots are full. Both mean
// back off rather than retry; anything else is a genuine failure.
export const RATE_LIMIT_STATUSES = Object.freeze([429, 504]);

// One Overpass call, bounded and identified. Returns a failure object rather than
// throwing so a busy Overpass degrades to "no snap" instead of failing the request
// that asked for it — and says WHICH kind of failure, so the caller can back off
// instead of hammering a service that has just asked it not to.
export async function fetchBuildings({ lat, lng, radiusM, fetchImpl = fetch, endpoint = OVERPASS_ENDPOINT, signal } = {}) {
  const query = overpassQuery(lat, lng, radiusM);
  if (!query) return null;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });
  if (!response?.ok) {
    return { rateLimited: RATE_LIMIT_STATUSES.includes(response?.status), status: response?.status ?? null };
  }

  const payload = await response.json();
  return { buildings: parseBuildings(payload), entrances: parseEntrances(payload) };
}

// Resolve and decide in one call.
export async function resolveBuildingSnap({ lat, lng, radiusM, ...rest } = {}) {
  const found = await fetchBuildings({ lat, lng, radiusM, ...rest });
  if (!found || !found.buildings) {
    return {
      snapped: false,
      reason: "overpass_unavailable",
      // Surfaced so a caller pacing a batch can slow down rather than keep going at
      // the rate that just got it throttled.
      rate_limited: Boolean(found?.rateLimited),
      lat: finiteOrNull(lat), lng: finiteOrNull(lng),
      geocode_precision: null, osm_building_id: null, building_name: null, moved_m: 0,
      footprint: null, attribution: OSM_ATTRIBUTION,
    };
  }
  return snapToBuilding({ lat, lng, radiusM, ...found });
}
