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
  })).max(30).default([]),
});

export const discoveredLocationsSchema = z.object({
  locations: z.array(z.object({
    place: z.string().trim().min(1).max(240),
    scene: z.string().trim().min(1).max(320),
    description: z.string().trim().min(1).max(800),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    // OpenAI Structured Outputs does not support JSON Schema's `uri` format.
    // The URL is still restricted to a consulted web-search source below.
    sourceUrl: z.string().min(1).max(2048),
  })).max(5),
});

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

function locationKey(place) {
  return place.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function normalizeDiscoveredLocations(parsed, request, consultedSources) {
  const center = { lat: request.city.lat, lng: request.city.lng };
  const existing = request.existingLocations;
  const seen = new Set(existing.map((location) => location.place.toLowerCase()));
  const normalized = [];

  for (const location of parsed.locations) {
    const source = consultedSources.get(canonicalUrl(location.sourceUrl));
    const point = { lat: location.lat, lng: location.lng };
    const duplicate = existing.some((known) =>
      known.place.toLowerCase() === location.place.toLowerCase()
      || distanceKm(point, known) < 0.05,
    );
    if (!source || duplicate || seen.has(location.place.toLowerCase())) continue;
    if (distanceKm(center, point) > request.city.radiusKm) continue;

    seen.add(location.place.toLowerCase());
    normalized.push({
      work_wikidata_id: request.work.id,
      work_title: request.work.title,
      work_year: null,
      kind: request.work.kind,
      loc_wikidata_id: `web-${locationKey(location.place)}-${location.lat.toFixed(5)}-${location.lng.toFixed(5)}`,
      loc_name: location.place,
      lat: location.lat,
      lng: location.lng,
      commons_image: null,
      relation_kind: request.work.kind === "book" ? "researched_story_setting" : "researched_filming_location",
      relation_property: null,
      relation_label: request.work.kind === "book" ? "Researched story setting" : "Researched filming location",
      relation_description: location.description,
      scene_title: location.scene,
      source_url: source.url,
      source_title: source.title,
      evidence_source: "web_search",
    });
  }

  return normalized;
}
