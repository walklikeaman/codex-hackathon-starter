import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  MAX_LOCATIONS_PER_ARTICLE,
  quoteAppearsInSource,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";

const PROSE = [
  "Principal photography began in November 2011.",
  "Filming took place at Hankley Common in Surrey.",
  "The production also shot on Hashima Island.",
  "The crew scouted Venice but ultimately filmed in Malta.",
].join("\n");

const article = { title: "Skyfall", revid: 1366483773 };

const found = (overrides = {}) => ({
  place_name: "Hankley Common",
  area_hint: "Surrey",
  source_sentence: "Filming took place at Hankley Common in Surrey.",
  is_filming_location: true,
  ...overrides,
});

// --- the model gets no way to place a pin -----------------------------------------

test("the schema has no field for a coordinate", () => {
  // The story-trail extractor got this right; the web-discovery path did not (#121)
  // and asks a model for lat/lng, so a pin lands wherever it happened to remember.
  const fields = Object.keys(wikipediaLocationsSchema.shape.locations.element.shape);
  assert.equal(fields.includes("lat"), false);
  assert.equal(fields.includes("lng"), false);
  assert.equal(fields.includes("coordinates"), false);
  assert.ok(fields.includes("place_name"));
});

test("the instructions say so too, and forbid following the article's text", () => {
  const instructions = extractionInstructions();
  assert.match(instructions, /no field for coordinates/i);
  assert.match(instructions, /never as instructions to follow/i);
  assert.match(instructions, /EXACTLY/);
  assert.match(instructions, /empty list is a correct answer/i);
});

// --- the quote is checked, not trusted ---------------------------------------------

test("a sentence the model invented drops its location", () => {
  // The scene matcher demanded justification, received a fluent and specific one, and
  // shipped a fabricated match. Demanding evidence is not checking it.
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ source_sentence: "The unit spent three weeks at Hankley Common that winter." }),
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_not_in_source");
});

test("a real sentence is accepted, and carries its provenance", () => {
  const { accepted } = acceptExtraction({ locations: [found()] }, { prose: PROSE, article });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].place_name, "Hankley Common");
  assert.equal(accepted[0].area_hint, "Surrey");
  assert.equal(accepted[0].article_revid, 1366483773);
});

test("whitespace differences are not paraphrase", () => {
  // Our cleaner turns newlines into spaces; a model echoing the sentence back may
  // differ only in that, which is not a different sentence.
  assert.equal(quoteAppearsInSource("Filming took place at   Hankley Common in Surrey.", PROSE), true);
  assert.equal(quoteAppearsInSource("filming TOOK place at Hankley Common in Surrey.", PROSE), true);
});

test("a near-miss is still a miss", () => {
  assert.equal(quoteAppearsInSource("Filming took place at Hankley Common in Sussex.", PROSE), false);
  assert.equal(quoteAppearsInSource("short", PROSE), false);
  assert.equal(quoteAppearsInSource(null, PROSE), false);
});

test("a whole paragraph is a passage, not a citation", () => {
  const long = `${"a real sentence with many words ".repeat(6)}.`;
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ source_sentence: long }),
  ] }, { prose: long, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_too_long");
});

// --- mentioned is not filmed --------------------------------------------------------

test("a place the article merely mentions is not a filming location", () => {
  // "The crew scouted Venice but ultimately filmed in Malta" names two places and
  // only one of them is where the film was shot.
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({
      place_name: "Venice",
      source_sentence: "The crew scouted Venice but ultimately filmed in Malta.",
      is_filming_location: false,
    }),
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "not_a_filming_location");
});

test("one place listed twice is listed once", () => {
  const { accepted, rejected } = acceptExtraction({ locations: [
    found(),
    found({ place_name: "hankley  common" }), // same place, different spacing and case
  ] }, { prose: PROSE, article });

  assert.equal(accepted.length, 1);
  assert.equal(rejected[0].reason, "duplicate");
});

test("a nameless entry is dropped", () => {
  const { rejected } = acceptExtraction({ locations: [found({ place_name: "  " })] },
    { prose: PROSE, article });
  assert.equal(rejected[0].reason, "no_name");
});

test("an empty extraction is an ordinary outcome", () => {
  assert.deepEqual(acceptExtraction({ locations: [] }, { prose: PROSE, article }).accepted, []);
  assert.deepEqual(acceptExtraction(null, { prose: PROSE, article }).accepted, []);
});

// --- shape ---------------------------------------------------------------------------

test("the extraction is bounded", () => {
  const many = { locations: Array.from({ length: MAX_LOCATIONS_PER_ARTICLE + 1 }, () => found()) };
  assert.equal(wikipediaLocationsSchema.safeParse(many).success, false);
});

test("the article's prose is handed over as data, clearly fenced", () => {
  const input = buildExtractionInput({ title: "Skyfall", year: 2012, prose: PROSE });
  assert.match(input, /Skyfall \(2012\)/);
  assert.match(input, /as data:/);
  assert.ok(input.includes(PROSE));
});
