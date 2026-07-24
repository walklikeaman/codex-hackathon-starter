// Visual vocabulary for the graph layer — pure, so what a pin MEANS is decided here
// and unit-tested, not buried in a Leaflet callback.
//
// The point of distinct styling is honesty (ARCHITECTURE.md §3): a filmed-on-this-street
// point, a studio that merely stands in for the story, a book's real setting, and a
// city-centroid approximation are four different claims and must not look identical.

import { CLUSTER_BELOW_ZOOM } from "./map-points.mjs";

export const BADGE_STYLES = Object.freeze({
  // Filmed right here, coordinates good to the point.
  exact: Object.freeze({
    color: "#f7b733", fillColor: "#f7b733", fillOpacity: 0.85,
    radius: 7, weight: 2, dashArray: null,
    label: "Filmed here", hint: "Exact location from Wikidata",
  }),
  // We only know the city/country: drawn deliberately larger and dashed so it reads
  // as a region, never as a doorstep.
  approximate: Object.freeze({
    color: "#f7b733", fillColor: "#f7b733", fillOpacity: 0.18,
    radius: 12, weight: 2, dashArray: "3 4",
    label: "Approximate", hint: "Only the city or country is known",
  }),
  // Real, correctly located — but it depicts somewhere else.
  studio: Object.freeze({
    color: "#b98cff", fillColor: "#b98cff", fillOpacity: 0.8,
    radius: 8, weight: 2, dashArray: null,
    label: "Studio", hint: "Shot on a set — the story is set elsewhere",
  }),
  // A book's setting: real place, but narrative rather than a shooting location.
  narrative: Object.freeze({
    color: "#6fd3c7", fillColor: "#6fd3c7", fillOpacity: 0.75,
    radius: 7, weight: 2, dashArray: null,
    label: "Set here", hint: "Where the story takes place",
  }),
});

const FALLBACK_BADGE = "exact";

export function badgeStyle(badge) {
  return BADGE_STYLES[badge] ?? BADGE_STYLES[FALLBACK_BADGE];
}

// Selection is shown by growing the ring rather than recolouring it, so the badge
// (what the point IS) survives the interaction state.
export function pointStyle(feature, { selected = false } = {}) {
  const base = badgeStyle(feature?.properties?.badge);
  if (!selected) return base;
  return {
    ...base,
    radius: base.radius + 4,
    weight: 3,
    color: "#fff3a5",
    fillOpacity: Math.min(1, base.fillOpacity + 0.15),
  };
}

// Cluster bubbles scale LOGARITHMICALLY. A sqrt (or linear) scale saturates against
// the upper clamp almost immediately — with sqrt*3 a cluster of 50 and one of 5000
// were both drawn at the maximum radius, which tells the reader they are the same
// size. log10 keeps 1 → 10 → 100 → 1000 visibly distinct across the whole range.
export function clusterRadius(count) {
  const n = Number.isFinite(count) && count > 0 ? count : 1;
  return Math.max(12, Math.min(30, 12 + Math.log10(n) * 4.5));
}

export function clusterStyle(count, { hasStudio = false } = {}) {
  return {
    radius: clusterRadius(count),
    color: hasStudio ? "#b98cff" : "#f7b733",
    fillColor: "#16130c",
    fillOpacity: 0.78,
    weight: 2,
  };
}

// Leaflet bounds → the query the endpoint expects. Longitude is passed through as
// west/east without sorting: Leaflet reports a date-line-crossing viewport that way and
// the API reads it as a crossing window, not as its complement.
export function viewportQuery(bounds, zoom, { workId = null, kinds = null } = {}) {
  if (!bounds) return null;
  const west = bounds.getWest?.() ?? bounds.west;
  const east = bounds.getEast?.() ?? bounds.east;
  const south = bounds.getSouth?.() ?? bounds.south;
  const north = bounds.getNorth?.() ?? bounds.north;
  if (![west, east, south, north].every((value) => Number.isFinite(value))) return null;

  const params = new URLSearchParams({
    // Leaflet can report longitudes outside [-180,180] after wrapping; clamp so the
    // API's own validation doesn't reject a legitimate viewport.
    west: String(Math.max(-180, Math.min(180, west))),
    east: String(Math.max(-180, Math.min(180, east))),
    south: String(Math.max(-90, Math.min(90, south))),
    north: String(Math.max(-90, Math.min(90, north))),
    z: String(Math.round(zoom ?? CLUSTER_BELOW_ZOOM)),
  });
  if (workId) params.set("workId", workId);
  if (kinds?.length) params.set("kinds", kinds.join(","));
  return params.toString();
}

// A short, honest one-liner for a point's popup.
export function pointSummary(properties) {
  if (!properties) return "";
  const style = badgeStyle(properties.badge);
  const works = properties.work_count === 1 ? "1 work" : `${properties.work_count ?? 0} works`;
  return `${style.label} · ${works}`;
}
