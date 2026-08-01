// Web-researched story locations (#121).
//
// This path used to ask the model for `lat`/`lng`. That is the one thing this project
// exists not to do: a recalled coordinate is confident, plausible, and unfalsifiable,
// and every check downstream then validated the invention rather than the place. The
// radius test only confirmed the made-up point was plausibly located; the identity
// string baked it in; and the map labelled the result "sourced" beside genuinely
// verified Wikidata places.
//
// So the model now returns a NAME and its citation, and nothing else it could get
// wrong quietly. Names become points through the same Wikidata geocoder the enrichment
// script uses — which refuses homonyms rather than ranking them — and a name that
// cannot be placed is reported as unplaced, never plotted.

import { z } from "zod";
import { distanceKm } from "./location-search.mjs";

export const discoveryRequestSchema = z.object({
  city: z.object({
    name: z.string().trim().min(1).max(120),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusKm: z.number().min(1).max(50),
  }),
  work: z.object({
    id: z.string().min(1).max(160),
    title: z.string().trim().min(1).max(240),
    kind: z.enum(["film", "series", "book"]),
  }),
  existingLocations: z.array(z.object({
    place: z.string().trim().min(1).max(240),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    // Optional so an older client still works. When present it is the strongest
    // duplicate check available: two records of the same Wikidata entity are the same
    // place however differently the prose spelled it.
    wikidataId: z.string().trim().max(24).nullish(),
  })).max(30).default([]),
});

// No coordinate field. The model cannot supply a point because it is never asked for
// one, which is a stronger guarantee than instructing it not to guess.
export const discoveredLocationsSchema = z.object({
  locations: z.array(z.object({
    place: z.string().trim().min(1).max(240),
    scene: z.string().trim().min(1).max(320),
    description: z.string().trim().min(1).max(800),
    // OpenAI Structured Outputs does not support JSON Schema's `uri` format.
    // The URL is still restricted to a consulted web-search source below.
    sourceUrl: z.string().min(1).max(2048),
  })).max(5),
});

// How close two points must be to be the same place. A building's Wikidata coordinate
// and a web source's description of the same building differ by metres, not hundreds.
const SAME_PLACE_KM = 0.05;

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function webSearchSources(response) {
  const sources = new Map();
  for (const item of response?.output ?? []) {
    if (item.type !== "web_search_call") continue;
    for (const source of item.action?.sources ?? []) {
      const canonical = canonicalUrl(source.url);
      if (canonical) sources.set(canonical, { url: source.url, title: source.title ?? "Source" });
    }
  }
  return sources;
}

// Step one: which returned claims are worth spending a geocoder query on.
//
// Everything here can be decided without knowing where the place is — a claim with no
// consulted source behind it is worthless whether or not it can be located, and paying
// for a lookup first would only delay the same rejection.
export function acceptDiscoveries(parsed, request, consultedSources) {
  const claims = [];
  const rejected = [];
  const seen = new Set(request.existingLocations.map((location) => location.place.toLowerCase()));

  for (const location of parsed?.locations ?? []) {
    const place = String(location?.place ?? "").trim();
    const key = place.toLowerCase();
    const source = consultedSources.get(canonicalUrl(location?.sourceUrl));

    if (!place) { rejected.push({ place, reason: "no_name" }); continue; }
    // The citation is the whole basis of the claim. A URL the search never consulted is
    // a remembered one, and a remembered URL is not evidence.
    if (!source) { rejected.push({ place, reason: "source_not_consulted" }); continue; }
    if (seen.has(key)) { rejected.push({ place, reason: "duplicate_name" }); continue; }

    seen.add(key);
    claims.push({
      place,
      scene: String(location.scene ?? "").trim(),
      description: String(location.description ?? "").trim(),
      source,
    });
  }

  return { claims, rejected };
}

// Step two: place the accepted claims, using coordinates that came from Wikidata.
//
// `located` maps a place name to the geocoder's decision. A claim the geocoder refused
// is returned under `unplaced` with the reason it refused — an ambiguous homonym is a
// different problem from a name nothing matched, and the caller can say so honestly
// instead of quietly returning fewer results than it found.
export function placeDiscoveries(claims, request, located) {
  const center = { lat: request.city.lat, lng: request.city.lng };
  const existing = request.existingLocations;
  const knownIds = new Set(existing.map((location) => location.wikidataId).filter(Boolean));
  const locations = [];
  const unplaced = [];

  for (const claim of claims) {
    const chosen = located?.get(claim.place);
    if (!chosen?.place) {
      unplaced.push({ place: claim.place, reason: chosen?.reason ?? "not_attempted" });
      continue;
    }

    const point = { lat: chosen.place.lat, lng: chosen.place.lng };

    // Same Wikidata entity as something already on the map. This check did not exist
    // before because there was no entity to compare — a recalled coordinate has no
    // identity, only a position.
    if (knownIds.has(chosen.place.wikidata_id)) {
      unplaced.push({ place: claim.place, reason: "already_on_map" });
      continue;
    }
    if (existing.some((known) => distanceKm(point, known) < SAME_PLACE_KM)) {
      unplaced.push({ place: claim.place, reason: "already_on_map" });
      continue;
    }
    // Now a meaningful test: a sourced point outside the city the user is looking at.
    if (distanceKm(center, point) > request.city.radiusKm) {
      unplaced.push({ place: claim.place, reason: "outside_city" });
      continue;
    }

    knownIds.add(chosen.place.wikidata_id);
    locations.push({
      work_wikidata_id: request.work.id,
      work_title: request.work.title,
      work_year: null,
      kind: request.work.kind,
      // A real entity id rather than a slug of the invented coordinate. This is what
      // lets the same place found twice, by two routes, be recognised as one place.
      loc_wikidata_id: chosen.place.wikidata_id,
      loc_name: chosen.place.name || claim.place,
      lat: point.lat,
      lng: point.lng,
      commons_image: null,
      relation_kind: request.work.kind === "book" ? "researched_story_setting" : "researched_filming_location",
      relation_property: null,
      relation_label: request.work.kind === "book" ? "Researched story setting" : "Researched filming location",
      relation_description: claim.description,
      scene_title: claim.scene,
      source_url: claim.source.url,
      source_title: claim.source.title,
      evidence_source: "web_search",
      // Where the POINT came from, which is a different question from where the CLAIM
      // came from. The web source said the film shot here; Wikidata said where here is.
      geocode_source: "wikidata",
      geocode_source_id: chosen.place.wikidata_id,
      geocode_reason: chosen.reason,
    });
  }

  return { locations, unplaced };
}
