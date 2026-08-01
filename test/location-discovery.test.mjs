import test from "node:test";
import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import {
  acceptDiscoveries,
  discoveredLocationsSchema,
  discoveryRequestSchema,
  placeDiscoveries,
  webSearchSources,
} from "../app/lib/location-discovery-schema.mjs";

const request = discoveryRequestSchema.parse({
  city: { name: "London", lat: 51.5072, lng: -0.1276, radiusKm: 20 },
  work: { id: "Q4941", title: "Skyfall", kind: "film" },
  existingLocations: [
    { place: "National Gallery", lat: 51.5089, lng: -0.1283, wikidataId: "Q180788" },
  ],
});

const SOURCES = new Map([["https://example.com/source", {
  url: "https://example.com/source",
  title: "Evidence",
}]]);

const claim = (overrides = {}) => ({
  place: "Old Royal Naval College",
  scene: "London pursuit",
  description: "Skyfall used this riverside complex as a filming location.",
  sourceUrl: "https://example.com/source",
  ...overrides,
});

const found = (lat, lng, extra = {}) => ({
  place: { wikidata_id: "Q1023309", name: "Old Royal Naval College", lat, lng, ...extra },
  reason: "unique",
});

// --- the model is given no way to place a pin (#121) ---------------------------------

test("the schema has no field for a coordinate", () => {
  // This path used to ask for lat/lng, so a pin landed wherever the model happened to
  // remember — and every check below then validated the invention.
  const fields = Object.keys(discoveredLocationsSchema.shape.locations.element.shape);
  assert.equal(fields.includes("lat"), false);
  assert.equal(fields.includes("lng"), false);
  assert.equal(fields.includes("coordinates"), false);
  assert.ok(fields.includes("place"));
  assert.ok(fields.includes("sourceUrl"));
});

test("uses a Structured Outputs schema supported by OpenAI", () => {
  const format = zodTextFormat(discoveredLocationsSchema, "researched_story_locations");
  const sourceUrl = format.schema.properties.locations.items.properties.sourceUrl;

  assert.equal(sourceUrl.type, "string");
  assert.equal(sourceUrl.format, undefined);
});

test("extracts complete consulted sources from web search output", () => {
  const sources = webSearchSources({
    output: [{
      type: "web_search_call",
      action: { sources: [{ url: "https://example.com/source", title: "Evidence" }] },
    }],
  });

  assert.deepEqual(sources.get("https://example.com/source"), {
    url: "https://example.com/source",
    title: "Evidence",
  });
});

// --- what is worth a geocoder query -------------------------------------------------

test("a claim whose URL the search never consulted is refused", () => {
  // A remembered URL is not evidence, and rejecting it before the lookup costs nothing.
  const parsed = discoveredLocationsSchema.parse({ locations: [
    claim(),
    claim({ place: "Unsupported place", sourceUrl: "https://unsupported.example/place" }),
  ] });

  const { claims, rejected } = acceptDiscoveries(parsed, request, SOURCES);
  assert.equal(claims.length, 1);
  assert.equal(rejected[0].reason, "source_not_consulted");
});

test("a place already on the map is not researched again", () => {
  const parsed = discoveredLocationsSchema.parse({ locations: [claim({ place: "National Gallery" })] });
  const { claims, rejected } = acceptDiscoveries(parsed, request, SOURCES);

  assert.equal(claims.length, 0);
  assert.equal(rejected[0].reason, "duplicate_name");
});

// --- placing what survived -----------------------------------------------------------

test("a located claim carries the point's provenance separately from the claim's", () => {
  // The web source said the film shot here; Wikidata said where here is. Recording one
  // source for both makes the coordinate look as researched as the connection.
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim()] }), request, SOURCES);
  const { locations } = placeDiscoveries(claims, request,
    new Map([["Old Royal Naval College", found(51.4837, -0.0059)]]));

  assert.equal(locations.length, 1);
  assert.equal(locations[0].source_url, "https://example.com/source");
  assert.equal(locations[0].geocode_source, "wikidata");
  assert.equal(locations[0].geocode_source_id, "Q1023309");
  assert.equal(locations[0].evidence_source, "web_search");
});

test("the identity is the entity, not a slug of the coordinate", () => {
  // A recalled coordinate has no identity, only a position — so the same place found
  // twice used to become two places.
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim()] }), request, SOURCES);
  const { locations } = placeDiscoveries(claims, request,
    new Map([["Old Royal Naval College", found(51.4837, -0.0059)]]));

  assert.equal(locations[0].loc_wikidata_id, "Q1023309");
});

test("a name the geocoder refused is reported, never plotted", () => {
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim({ place: "Cambridge" })] }), request, SOURCES);
  const { locations, unplaced } = placeDiscoveries(claims, request,
    new Map([["Cambridge", { place: null, reason: "ambiguous_homonyms" }]]));

  assert.equal(locations.length, 0);
  assert.deepEqual(unplaced, [{ place: "Cambridge", reason: "ambiguous_homonyms" }]);
});

test("a name the geocoder was never asked about is not silently dropped", () => {
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim()] }), request, SOURCES);
  const { unplaced } = placeDiscoveries(claims, request, new Map());

  assert.equal(unplaced[0].reason, "not_attempted");
});

test("a sourced point outside the city is dropped — now a meaningful test", () => {
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim({ place: "Paris place" })] }), request, SOURCES);
  const { locations, unplaced } = placeDiscoveries(claims, request,
    new Map([["Paris place", found(48.8566, 2.3522)]]));

  assert.equal(locations.length, 0);
  assert.equal(unplaced[0].reason, "outside_city");
});

test("the same Wikidata entity already on the map is recognised despite a different name", () => {
  // "The National Gallery" and "National Gallery" never matched by string; Q180788
  // matches itself.
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim({ place: "The National Gallery, London" })] }),
    request, SOURCES);
  const { locations, unplaced } = placeDiscoveries(claims, request, new Map([
    ["The National Gallery, London",
      { place: { wikidata_id: "Q180788", name: "National Gallery", lat: 51.5089, lng: -0.1283 }, reason: "unique" }],
  ]));

  assert.equal(locations.length, 0);
  assert.equal(unplaced[0].reason, "already_on_map");
});

test("two claims resolving to one entity yield one place", () => {
  const { claims } = acceptDiscoveries(discoveredLocationsSchema.parse({ locations: [
    claim({ place: "Old Royal Naval College" }),
    claim({ place: "Greenwich Naval College" }),
  ] }), request, SOURCES);
  const { locations } = placeDiscoveries(claims, request, new Map([
    ["Old Royal Naval College", found(51.4837, -0.0059)],
    ["Greenwich Naval College", found(51.4837, -0.0059)],
  ]));

  assert.equal(locations.length, 1);
});

test("an older client without entity ids still gets duplicate protection by distance", () => {
  const legacy = discoveryRequestSchema.parse({
    city: { name: "London", lat: 51.5072, lng: -0.1276, radiusKm: 20 },
    work: { id: "Q4941", title: "Skyfall", kind: "film" },
    existingLocations: [{ place: "National Gallery", lat: 51.5089, lng: -0.1283 }],
  });
  const { claims } = acceptDiscoveries(
    discoveredLocationsSchema.parse({ locations: [claim({ place: "Trafalgar Square gallery" })] }),
    legacy, SOURCES);
  const { unplaced } = placeDiscoveries(claims, legacy, new Map([
    ["Trafalgar Square gallery",
      { place: { wikidata_id: "Q180788", name: "National Gallery", lat: 51.5089, lng: -0.1283 }, reason: "unique" }],
  ]));

  assert.equal(unplaced[0].reason, "already_on_map");
});

test("uses a story-setting relation for researched book locations", () => {
  const bookRequest = { ...request, work: { id: "Q1", title: "Example Book", kind: "book" }, existingLocations: [] };
  const { claims } = acceptDiscoveries(discoveredLocationsSchema.parse({ locations: [
    claim({ place: "Regent's Park", description: "The novel follows its character through Regent's Park." }),
  ] }), bookRequest, SOURCES);
  const { locations } = placeDiscoveries(claims, bookRequest, new Map([
    ["Regent's Park", { place: { wikidata_id: "Q208079", name: "Regent's Park", lat: 51.5313, lng: -0.1569 }, reason: "unique" }],
  ]));

  assert.equal(locations[0].relation_kind, "researched_story_setting");
  assert.equal(locations[0].relation_label, "Researched story setting");
});
