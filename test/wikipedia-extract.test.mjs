import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  MAX_LOCATIONS_PER_ARTICLE,
  quoteAppearsInSource,
  sentenceMentionsPlace,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";
import { MAX_QUOTE_WORDS } from "../app/lib/wikipedia-source.mjs";

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
  // The code drops a quote over 30 words. A model told only "400 characters" by the
  // schema loses locations to a rule nobody stated.
  assert.match(instructions, new RegExp(`at most ${MAX_QUOTE_WORDS} words`));
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

test("several sentences are a passage, not a citation", () => {
  // The load-bearing rule. A paragraph carries far more of the article than the one
  // sentence needed to support the claim.
  const passage = "Filming began in Surrey. The unit then moved to Malta. Later they shot in Istanbul.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ source_sentence: passage }),
  ] }, { prose: passage, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_multiple_sentences");
});

test("a run-on sentence is still refused, and named differently", () => {
  // Two rules failed under one name before, so a log line could not tell "the model
  // joined two sentences" from "the sentence was enormous" — different fixes.
  const runOn = `${"a real sentence with many many more words ".repeat(8)}.`;
  const { rejected } = acceptExtraction({ locations: [
    found({ source_sentence: runOn }),
  ] }, { prose: runOn, article });

  assert.equal(rejected[0].reason, "quote_too_long");
});

test("an ordinary Wikipedia sentence survives the cap", () => {
  // The cap was 30 words and threw away real evidence. The quote exists so a reviewer
  // can verify the claim, and a sentence cut off mid-way cannot be verified.
  const typical = "Filming took place at Hankley Common in Surrey, which stood in for the "
    + "Scottish Highlands, with the production building a full-size replica of the lodge on site.";
  assert.ok(typical.split(/\s+/).length > 25);
  const { accepted } = acceptExtraction({ locations: [
    found({ source_sentence: typical }),
  ] }, { prose: typical, article });

  assert.equal(accepted.length, 1);
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

test("one place too many drops that place, not the whole answer", () => {
  // A hard schema max cost us every location in Skyfall because the model found
  // thirteen. The cap is policy about review volume; it must not be a cliff.
  const many = { locations: Array.from({ length: MAX_LOCATIONS_PER_ARTICLE + 3 }, (_, i) => found({
    place_name: `Place ${i}`,
    source_sentence: `Filming took place at Place ${i} that winter.`,
  })) };
  const prose = many.locations.map((l) => l.source_sentence).join("\n");

  assert.equal(wikipediaLocationsSchema.safeParse(many).success, true);
  const { accepted, rejected } = acceptExtraction(many, { prose, article });
  assert.equal(accepted.length, MAX_LOCATIONS_PER_ARTICLE);
  assert.equal(rejected.filter((r) => r.reason === "over_limit").length, 3);
});

test("the reply is still bounded in shape", () => {
  const absurd = { locations: Array.from({ length: 200 }, () => found()) };
  assert.equal(wikipediaLocationsSchema.safeParse(absurd).success, false);
});

test("the model is told the cap it is judged by", () => {
  assert.match(extractionInstructions(), new RegExp(`at most ${MAX_LOCATIONS_PER_ARTICLE} places`));
});

test("the article's prose is handed over as data, clearly fenced", () => {
  const input = buildExtractionInput({ title: "Skyfall", year: 2012, prose: PROSE });
  assert.match(input, /Skyfall \(2012\)/);
  assert.match(input, /as data:/);
  assert.ok(input.includes(PROSE));
});

// --- a real sentence about the wrong place ---------------------------------------------

test("a real sentence that never mentions the place is not evidence for it", () => {
  // Seen in the first live run: "Ascot Racecourse" arrived cited to "The Virgin Active
  // pool in London's Canary Wharf acted as Bond's...". The sentence is genuinely in the
  // article, so the verbatim check passed — it just says nothing about Ascot.
  const prose = "The Virgin Active pool in London's Canary Wharf acted as Bond's gym.";
  const { accepted, rejected } = acceptExtraction({ locations: [
    found({ place_name: "Ascot Racecourse", source_sentence: prose }),
  ] }, { prose, article });

  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "quote_is_about_elsewhere");
});

test("a common word shared by two names does not count as a mention", () => {
  // "Square", "station" and "hospital" appear in half the names in a Production section.
  assert.equal(sentenceMentionsPlace("Filming moved to Parliament Square.", "Cadogan Square"), false);
  assert.equal(sentenceMentionsPlace("Filming moved to Cadogan Square.", "Cadogan Square"), true);
});

test("a name made only of common words is not judged by this rule", () => {
  // It cannot be checked this way, so it passes rather than being refused on a test
  // that cannot see it.
  assert.equal(sentenceMentionsPlace("Filming took place nearby that winter.", "The Common"), true);
});

test("one malformed item costs itself, not the whole extraction", () => {
  // Seen live: the French article yielded 27 places and a single empty source_sentence
  // at index 26 failed the schema, taking the other 26 with it. A schema is
  // all-or-nothing, so per-field limits belong in the accept pass.
  const parsed = wikipediaLocationsSchema.parse({ locations: [
    found(),
    { place_name: "Somewhere", area_hint: "", source_sentence: "", is_filming_location: true },
    { place_name: "X", area_hint: "", source_sentence: PROSE.split("\n")[1], is_filming_location: true },
  ] });

  const { accepted, rejected } = acceptExtraction(parsed, { prose: PROSE, article });
  assert.equal(accepted.length, 1);
  assert.deepEqual(rejected.map((r) => r.reason).sort(), ["no_name", "quote_wrong_length"]);
});
