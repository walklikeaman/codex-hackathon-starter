import test from "node:test";
import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import {
  discoveredLocationsSchema,
  discoveryRequestSchema,
  normalizeDiscoveredLocations,
  webSearchSources,
} from "../app/lib/location-discovery-schema.mjs";

const request = discoveryRequestSchema.parse({
  city: { name: "London", lat: 51.5072, lng: -0.1276, radiusKm: 20 },
  work: { id: "Q4941", title: "Skyfall", kind: "film" },
  existingLocations: [{ place: "National Gallery", lat: 51.5089, lng: -0.1283 }],
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

test("keeps only cited, in-city, non-duplicate researched locations", () => {
  const parsed = discoveredLocationsSchema.parse({
    locations: [
      {
        place: "Old Royal Naval College",
        scene: "London pursuit",
        description: "Skyfall used this riverside complex as a filming location.",
        lat: 51.4837,
        lng: -0.0059,
        sourceUrl: "https://example.com/source",
      },
      {
        place: "National Gallery",
        scene: "Bond meets Q",
        description: "The scene was filmed here.",
        lat: 51.5089,
        lng: -0.1283,
        sourceUrl: "https://example.com/source",
      },
      {
        place: "Unsupported place",
        scene: "Unknown",
        description: "No consulted source supports this.",
        lat: 51.5,
        lng: -0.1,
        sourceUrl: "https://unsupported.example/place",
      },
      {
        place: "Paris place",
        scene: "Outside the city",
        description: "This is too far away.",
        lat: 48.8566,
        lng: 2.3522,
        sourceUrl: "https://example.com/source",
      },
    ],
  });
  const sources = new Map([["https://example.com/source", {
    url: "https://example.com/source",
    title: "Evidence",
  }]]);

  const locations = normalizeDiscoveredLocations(parsed, request, sources);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].loc_name, "Old Royal Naval College");
  assert.equal(locations[0].evidence_source, "web_search");
  assert.equal(locations[0].source_title, "Evidence");
});

test("uses a story-setting relation for researched book locations", () => {
  const bookRequest = {
    ...request,
    work: { id: "Q1", title: "Example Book", kind: "book" },
    existingLocations: [],
  };
  const parsed = discoveredLocationsSchema.parse({
    locations: [{
      place: "Regent's Park",
      scene: "A walk through the park",
      description: "The novel follows its character through Regent's Park.",
      lat: 51.5313,
      lng: -0.1569,
      sourceUrl: "https://example.com/book",
    }],
  });
  const sources = new Map([["https://example.com/book", {
    url: "https://example.com/book",
    title: "Book source",
  }]]);

  const [location] = normalizeDiscoveredLocations(parsed, bookRequest, sources);
  assert.equal(location.relation_kind, "researched_story_setting");
  assert.equal(location.relation_label, "Researched story setting");
});
