// Grounding — the single source of truth for "is a place trustworthy enough to
// map, and how confident are we". Every subsystem (resolver, map, ambient audio)
// imports from here so classification, confidence and the visibility threshold
// never drift apart. See ARCHITECTURE.md §2 (foundational decision #3).
//
// Pure module: no fetch, no framework. Covered by test/grounding.test.mjs.

// Decision #2 — one classification vocabulary. Detected by Wikidata P31 BFS in
// the resolver, never by name-matching. `fictional` and `unknown` are the only
// classes that may carry a NULL coordinate.
export const PLACE_CLASSES = Object.freeze([
  "real_exterior",
  "real_interior",
  "studio_interior",
  "fictional",
  "narrative_real",
  "unknown",
]);

export function isPlaceClass(value) {
  return PLACE_CLASSES.includes(value);
}

// Classes that are never given a real-world coordinate (shown as chips on an
// anchor, not as a map pin).
const NON_GEOCODED_CLASSES = new Set(["fictional"]);

export function isGeocodedClass(placeClass) {
  return isPlaceClass(placeClass) && !NON_GEOCODED_CLASSES.has(placeClass);
}

// Evidence methods and their prior weight (0..1) as an independent probability
// that the point is correct. A single `geoclip_infer` is deliberately weak — it
// is only a hypothesis until corroborated by real geo-tagged photos.
export const METHOD_PRIORS = Object.freeze({
  wikidata_statement: 0.9,
  wikidata_studio_entity: 0.85,
  manual_fix: 0.95,
  vision_verify: 0.8,
  mapillary_match: 0.7,
  commons_geosearch: 0.6,
  web_search_cited: 0.55,
  text_mention: 0.5,
  geoclip_infer: 0.2,
});

export function isEvidenceMethod(value) {
  return Object.prototype.hasOwnProperty.call(METHOD_PRIORS, value);
}

// Decision #3 — one visibility threshold and one set of bands.
export const CONFIDENCE_BANDS = Object.freeze({ verified: 0.75, candidate: 0.4 });
export const MAP_THRESHOLD = CONFIDENCE_BANDS.candidate; // below this = not pinned

export function confidenceBand(confidence) {
  if (!Number.isFinite(confidence)) return "weak";
  if (confidence >= CONFIDENCE_BANDS.verified) return "verified";
  if (confidence >= CONFIDENCE_BANDS.candidate) return "candidate";
  return "weak";
}

function evidenceWeight(row) {
  const prior = METHOD_PRIORS[row?.method];
  if (prior === undefined) return null;
  // An explicit per-row weight (0..1) overrides the method prior when present.
  const w = typeof row.weight === "number" && Number.isFinite(row.weight) ? row.weight : prior;
  return Math.min(1, Math.max(0, w));
}

// Fuse a set of evidence rows into one confidence via noisy-OR over *agreeing*
// evidence, with a penalty for *contradicting* evidence (agrees === false).
// Rows with agrees === null (a bare hypothesis, e.g. a lone geoclip guess) count
// as agreeing but keep their low prior, so they alone can't clear the threshold.
export function fuseConfidence(evidence) {
  const rows = Array.isArray(evidence) ? evidence : [];
  let notWrong = 1; // Π (1 - w) over supporting evidence → noisy-OR
  let penalty = 1; // Π (1 - w) over contradicting evidence
  let supporting = 0;

  for (const row of rows) {
    const w = evidenceWeight(row);
    if (w === null) continue; // unknown method → ignored, never invented
    if (row.agrees === false) {
      penalty *= 1 - w;
    } else {
      notWrong *= 1 - w;
      supporting += 1;
    }
  }

  const confidence = supporting === 0 ? 0 : (1 - notWrong) * penalty;
  const rounded = Math.round(confidence * 1000) / 1000;
  return { confidence: rounded, band: confidenceBand(rounded), supporting };
}

// The core invariant (ARCHITECTURE.md §3): a place is publishable to the map only
// if it has at least one supporting evidence row AND either a valid coordinate or
// is a fictional anchor. The model never writes a coordinate; only evidence does.
export function isPublishable(place, evidence) {
  if (!place || !isPlaceClass(place.place_class)) return false;
  const { supporting } = fuseConfidence(evidence);
  if (supporting < 1) return false;
  if (!isGeocodedClass(place.place_class)) return false; // fictional → chip, not pin
  return hasValidCoordinate(place.lat, place.lng);
}

export function hasValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}
