// "The place today" — a cascade of photo sources, ordered by what we may legally keep.
//
// The order is a licensing decision, not a quality one:
//
//   1. Mapillary        CC BY-SA — storable, and its compass_angle lets us match the
//                       direction a film frame was shot from.
//   2. Wikimedia Commons per-file free licences — storable, needs author + licence.
//   3. Google Street View  NOT storable. Its terms forbid caching or saving imagery,
//                       so it can only ever be a LIVE embed and can never appear in a
//                       saved before/after composition. Only the pano_id may be kept.
//
// Everything here returns a normalised attribution, because a photo we cannot credit
// is a photo we do not show (app/lib/attribution.mjs).

import { normalizeAttribution } from "./attribution.mjs";

export const SOURCE_ORDER = Object.freeze(["mapillary", "wikimedia", "streetview"]);

// Whether a candidate may be stored, or only displayed live. The UI uses this to keep
// Street View out of anything it saves.
export const STORABLE = Object.freeze({
  mapillary: true,
  wikimedia: true,
  streetview: false,
});

// How far a photo may be from the place before it stops being a photo OF it.
export const DEFAULT_RADIUS_M = 120;
const MAX_RADIUS_M = 500;

export function clampRadius(radius) {
  const value = Number(radius);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RADIUS_M;
  return Math.min(Math.round(value), MAX_RADIUS_M);
}

// Smallest angle between two bearings, in degrees (0..180). Used to prefer a photo
// facing the same way the film frame was shot.
export function bearingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diff = Math.abs(((a - b) % 360 + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

// Rank candidates within one source: closest first, but a photo pointing the right way
// wins over a marginally closer one pointing elsewhere.
export function scoreCandidate(candidate, { heading = null } = {}) {
  const distance = Number.isFinite(candidate?.distance_m) ? candidate.distance_m : DEFAULT_RADIUS_M;
  const delta = heading === null ? null : bearingDelta(candidate?.compass_angle, heading);
  // 1 point per metre; up to 90 points of penalty for facing away. A photo 30 m closer
  // but pointing backwards should not beat one aimed at the subject.
  const facingPenalty = delta === null ? 0 : Math.min(delta, 90);
  return distance + facingPenalty;
}

// Pick the photo to show: first source in cascade order that yields a candidate we can
// legally credit. Sources are NOT mixed — a source with a usable photo wins outright,
// so the credit shown always matches where the image came from.
export function choosePlacePhoto(candidatesBySource, { heading = null } = {}) {
  for (const source of SOURCE_ORDER) {
    const candidates = candidatesBySource?.[source];
    if (!Array.isArray(candidates) || candidates.length === 0) continue;

    const usable = candidates
      .map((candidate) => ({
        ...candidate,
        source,
        storable: STORABLE[source] === true,
        attribution: normalizeAttribution(candidate.attribution ?? { source }),
      }))
      // The fail-safe: no credit, no photo. A Commons file without author/licence is
      // dropped here rather than shown uncredited.
      .filter((candidate) => candidate.attribution && isCreditable(candidate))
      .sort((left, right) => scoreCandidate(left, { heading }) - scoreCandidate(right, { heading }));

    if (usable.length > 0) return usable[0];
  }
  return null;
}

function isCreditable(candidate) {
  const attribution = candidate.attribution;
  if (!attribution) return false;
  // Per-file licensed sources must carry both fields; the others are covered by the
  // source-level notice.
  if (candidate.source === "wikimedia" || candidate.source === "mapillary") {
    return Boolean(attribution.author && attribution.license);
  }
  return true;
}

// Street View is a live embed only. Building this URL is the ONLY way it may appear,
// and the result must never be saved — hence no download/proxy helper anywhere.
export function streetViewEmbedUrl({ lat, lng, heading = null, key }) {
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = new URL("https://www.google.com/maps/embed/v1/streetview");
  url.searchParams.set("key", key);
  url.searchParams.set("location", `${lat},${lng}`);
  if (Number.isFinite(heading)) url.searchParams.set("heading", String(Math.round(heading)));
  return url.toString();
}
