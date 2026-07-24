// Map read path — pure query parsing and GeoJSON shaping for /api/map/points.
// The map serves the persistent graph (places / work_place_links / place_evidence)
// rather than a live SPARQL query, so a viewport is one indexed database call.
//
// The point of shipping the grounding fields inline is honesty: the client must be
// able to show WHAT a pin is (street vs studio vs coarse city centroid) and how well
// it is evidenced, instead of drawing every point as an equally confident dot.

import { hasValidCoordinate, MAP_THRESHOLD } from "./grounding.mjs";

// Below this zoom the database returns grid clusters instead of individual places.
export const CLUSTER_BELOW_ZOOM = 12;
export const MAX_MAP_POINTS = 2000;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

const WORK_KINDS = new Set(["film", "series", "book", "track", "album"]);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Number(null) and Number("") are both 0, so a missing bbox parameter would silently
// become a perfectly valid coordinate at Null Island. Reject absent values outright.
function finite(value, { min, max }) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

// Same trap on the row side: a place with lat/lng NULL must not coerce to 0,0.
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Parse a viewport request. Returns { error } instead of a query when the request is
// unusable, so the caller can say WHICH part was wrong rather than blaming the bbox.
//
// A filter that was asked for but could not be honoured is an error, never a silent
// widening: quietly dropping an unparseable workId would answer "your film's places"
// with the entire graph, which reads as a wrong answer rather than a rejected one.
export function parseMapQuery(searchParams) {
  const west = finite(searchParams.get("west"), { min: -180, max: 180 });
  const east = finite(searchParams.get("east"), { min: -180, max: 180 });
  const south = finite(searchParams.get("south"), { min: -90, max: 90 });
  const north = finite(searchParams.get("north"), { min: -90, max: 90 });
  if (west === null || east === null || south === null || north === null) {
    return { error: "Provide a valid bbox (west, south, east, north)" };
  }

  const zoomRaw = searchParams.get("z");
  const zoom = zoomRaw === null ? CLUSTER_BELOW_ZOOM : finite(zoomRaw, { min: MIN_ZOOM, max: MAX_ZOOM });
  if (zoom === null) return { error: `Zoom must be between ${MIN_ZOOM} and ${MAX_ZOOM}` };

  const workIdRaw = searchParams.get("workId");
  if (workIdRaw !== null && !UUID.test(workIdRaw)) {
    return { error: "workId must be a uuid" };
  }

  const kindsParam = searchParams.get("kinds");
  let kinds = null;
  if (kindsParam !== null) {
    const requested = kindsParam.split(",").map((kind) => kind.trim()).filter(Boolean);
    if (requested.length === 0 || requested.some((kind) => !WORK_KINDS.has(kind))) {
      return { error: `kinds must be one or more of: ${[...WORK_KINDS].join(", ")}` };
    }
    kinds = [...new Set(requested)];
  }

  const roundedZoom = Math.round(zoom);
  return {
    // Longitude is NOT normalized: west > east is meaningful — it is a viewport
    // crossing the antimeridian, and the SQL reads it as [west,180] ∪ [-180,east].
    // Sorting the pair would turn that window into its own complement.
    west,
    east,
    south: Math.min(south, north),
    north: Math.max(south, north),
    zoom: roundedZoom,
    workId: workIdRaw,
    kinds,
    clustered: roundedZoom < CLUSTER_BELOW_ZOOM,
  };
}

// How a pin should read on the map. Kept here (not in the client) so every surface
// tells the same story about a point.
export function pointBadge(row) {
  if (row.shot_on_set) return "studio";
  if (row.place_class === "narrative_real") return "narrative";
  if (row.geocode_precision === "country" || row.geocode_precision === "city") return "approximate";
  return "exact";
}

function placeFeature(row) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      place_id: row.place_id,
      wikidata_id: row.wikidata_id,
      name: row.name,
      place_class: row.place_class,
      geocode_precision: row.geocode_precision,
      shot_on_set: row.shot_on_set === true,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      confidence_band: row.confidence_band,
      work_count: row.work_count ?? 0,
      evidence_count: row.evidence_count ?? 0,
      badge: pointBadge(row),
      source_url: row.wikidata_id ? `https://www.wikidata.org/wiki/${row.wikidata_id}` : null,
    },
  };
}

function clusterFeature(row) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    properties: {
      cluster: true,
      point_count: row.cluster_count ?? 0,
      sample_name: row.sample_name ?? null,
      has_studio: row.has_studio === true,
    },
  };
}

// Shape the RPC rows into GeoJSON. Rows without a usable coordinate are dropped here
// too — the database already filters them, but the map must never receive a pin it
// cannot honestly place.
export function buildMapResponse(query, rows, fictionalRows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const features = source
    .filter((row) => hasValidCoordinate(numeric(row?.lat), numeric(row?.lng)))
    .map((row) => (query.clustered ? clusterFeature(row) : placeFeature(row)));

  return {
    type: "FeatureCollection",
    features,
    clustered: query.clustered,
    zoom: query.zoom,
    truncated: !query.clustered && features.length >= MAX_MAP_POINTS,
    map_threshold: MAP_THRESHOLD,
    // Fiction is never a pin, but it is real content: the client shows it as a strip
    // so "set in Mordor" is visible instead of silently missing.
    fictional: (Array.isArray(fictionalRows) ? fictionalRows : []).map((row) => ({
      place_id: row.place_id,
      wikidata_id: row.wikidata_id,
      name: row.name,
      work_count: row.work_count ?? 0,
    })),
  };
}
