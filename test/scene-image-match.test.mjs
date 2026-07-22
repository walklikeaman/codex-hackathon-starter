import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedSceneImageMatch,
  acceptedSceneImageMatches,
  buildSceneImageContent,
  buildWikidataSceneQuery,
  canonicalSceneImageQuery,
  createSceneMatchRateLimiter,
  isAllowedLocationImageUrl,
  isStudioLocation,
  parseSceneImageRequest,
  parseWikidataSceneContext,
  sceneMatchClientId,
} from "../app/lib/scene-image-match.mjs";

const locationImageUrl = "https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg";
const photographicFrame = {
  isPhotographicFrame: true,
  hasProminentTitleOrLogo: false,
};

function validParams() {
  return new URLSearchParams({
    tmdbId: "185",
    workId: "Q181086",
    locationId: "Q386707",
  });
}

function wikidataPayload(overrides = {}) {
  return {
    results: {
      bindings: [{
        workLabel: { value: "A Clockwork Orange" },
        locationLabel: { value: "HM Prison Wandsworth" },
        tmdbId: { value: "185" },
        image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg" },
        ...overrides,
      }],
    },
  };
}

test("accepts only canonical TMDB and Wikidata ids", () => {
  const parsed = parseSceneImageRequest(validParams());
  assert.deepEqual(parsed, {
    tmdbId: "185",
    workId: "Q181086",
    locationId: "Q386707",
  });

  const invalid = validParams();
  invalid.set("workId", "not-a-qid");
  assert.equal(parseSceneImageRequest(invalid), null);
});

test("builds one canonical cache query and a bounded Wikidata pair query", () => {
  const request = parseSceneImageRequest(validParams());
  assert.equal(
    canonicalSceneImageQuery(request),
    "tmdbId=185&workId=Q181086&locationId=Q386707&v=4",
  );
  assert.equal(
    canonicalSceneImageQuery(request, "signed-capability"),
    "tmdbId=185&workId=Q181086&locationId=Q386707&token=signed-capability&v=4",
  );

  const query = buildWikidataSceneQuery(request);
  assert.match(query, /VALUES \?work \{ wd:Q181086 \}/);
  assert.match(query, /VALUES \?location \{ wd:Q386707 \}/);
  assert.match(query, /wdt:P915 \?location/);
  assert.throws(
    () => buildWikidataSceneQuery({ workId: "Q1 } UNION {", locationId: "Q2" }),
    /canonical Q ids/,
  );
});

test("uses only the canonical Wikidata pair to obtain matching context", () => {
  const context = parseWikidataSceneContext(wikidataPayload(), {
    tmdbId: "185",
    workId: "Q181086",
    locationId: "Q386707",
  });

  assert.deepEqual(context, {
    filmTitle: "A Clockwork Orange",
    place: "HM Prison Wandsworth",
    locationImageUrl,
  });
  assert.equal(parseWikidataSceneContext(wikidataPayload(), {
    tmdbId: "999",
    workId: "Q181086",
    locationId: "Q386707",
  }), null);
});

test("accepts only trusted HTTPS location image hosts", () => {
  assert.equal(isAllowedLocationImageUrl(locationImageUrl), true);
  assert.equal(isAllowedLocationImageUrl("https://example.com/private.jpg"), false);
  assert.equal(isAllowedLocationImageUrl("http://commons.wikimedia.org/file.jpg"), false);
});

test("builds one reference image followed by numbered candidates", () => {
  const content = buildSceneImageContent({
    filmTitle: "Test Film",
    place: "Test Place",
    locationImageUrl,
    candidateImageUrls: ["https://image.tmdb.org/t/p/w780/one.jpg", "https://image.tmdb.org/t/p/w780/two.jpg"],
  });

  assert.deepEqual(
    content.filter((item) => item.type === "input_image").map((item) => item.image_url),
    [
      locationImageUrl,
      "https://image.tmdb.org/t/p/w780/one.jpg",
      "https://image.tmdb.org/t/p/w780/two.jpg",
    ],
  );
  assert.match(content[0].text, /already verified/);
  assert.match(content[0].text, /interior-to-exterior/);
  assert.equal(content.some((item) => item.text === "CANDIDATE 1"), true);
});

test("accepts only an in-range high-confidence match", () => {
  assert.equal(acceptedSceneImageMatch({ ...photographicFrame, candidateIndex: 1, confidence: "high" }, 2), 1);
  assert.equal(acceptedSceneImageMatch({ ...photographicFrame, candidateIndex: 1, confidence: "medium" }, 2), null);
  assert.equal(acceptedSceneImageMatch({ ...photographicFrame, candidateIndex: 2, confidence: "high" }, 2), null);
  assert.equal(acceptedSceneImageMatch({ ...photographicFrame, candidateIndex: -1, confidence: "none" }, 2), null);
  assert.equal(acceptedSceneImageMatch({
    ...photographicFrame,
    candidateIndex: 0,
    confidence: "high",
    isPhotographicFrame: false,
    hasProminentTitleOrLogo: true,
  }, 2), null);
});

test("keeps up to three distinct high-confidence frame matches", () => {
  const matches = acceptedSceneImageMatches({
    matches: [
      { ...photographicFrame, candidateIndex: 1, confidence: "high" },
      { ...photographicFrame, candidateIndex: 1, confidence: "high" },
      { ...photographicFrame, candidateIndex: 2, confidence: "medium" },
      { ...photographicFrame, candidateIndex: 3, confidence: "high" },
      { ...photographicFrame, candidateIndex: 4, confidence: "high" },
      { ...photographicFrame, candidateIndex: 5, confidence: "high" },
    ],
  }, 6);

  assert.deepEqual(matches.map((match) => match.candidateIndex), [1, 3, 4]);
});

test("recognizes explicit studio locations without guessing generic interiors", () => {
  assert.equal(isStudioLocation("Warner Bros. Studios, Leavesden"), true);
  assert.equal(isStudioLocation("Stage 4 sound-stage"), true);
  assert.equal(isStudioLocation("The interior of a London pub"), false);

  const content = buildSceneImageContent({
    filmTitle: "Test Film",
    place: "Pinewood Studios",
    locationImageUrl: null,
    candidateImageUrls: ["https://image.tmdb.org/t/p/w780/one.jpg"],
  });

  assert.equal(content.filter((item) => item.type === "input_image").length, 1);
  assert.match(content[0].text, /exact soundstage is not visually verifiable/);
});

test("limits origin scene matching requests per client window", () => {
  const allow = createSceneMatchRateLimiter({ limit: 2, windowMs: 1_000 });
  assert.equal(allow("client", 0), true);
  assert.equal(allow("client", 10), true);
  assert.equal(allow("client", 20), false);
  assert.equal(allow("client", 1_001), true);
});

test("derives the rate-limit identity from the first forwarded address", () => {
  const request = new Request("http://localhost", {
    headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
  });
  assert.equal(sceneMatchClientId(request), "203.0.113.10");
});
