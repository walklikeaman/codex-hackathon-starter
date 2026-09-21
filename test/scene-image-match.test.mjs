import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedSceneImageMatch,
  acceptedSceneImageMatches,
  buildSceneImageContent,
  buildWikidataSceneEntitiesUrl,
  canonicalSceneImageQuery,
  createSceneMatchRateLimiter,
  isAllowedLocationImageUrl,
  isStudioLocation,
  parseSceneImageRequest,
  parseWikidataSceneEntities,
  truthyValues,
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

function statement(value, rank = "normal") {
  return { rank, mainsnak: { datavalue: { value } } };
}

function wikidataPayload({ p915 = [statement({ id: "Q386707" })], p4947 = [statement("185")], p18 = [statement("Test.jpg")], labels = true } = {}) {
  return {
    entities: {
      Q181086: {
        id: "Q181086",
        labels: labels ? { en: { value: "A Clockwork Orange" } } : {},
        claims: { P915: p915, P4947: p4947 },
      },
      Q386707: {
        id: "Q386707",
        labels: labels ? { en: { value: "HM Prison Wandsworth" } } : {},
        claims: { P18: p18 },
      },
    },
  };
}

const EXPECTED = { tmdbId: "185", workId: "Q181086", locationId: "Q386707" };

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

  const url = buildWikidataSceneEntitiesUrl(request);
  assert.equal(url.hostname, "www.wikidata.org");
  assert.equal(url.searchParams.get("action"), "wbgetentities");
  assert.equal(url.searchParams.get("ids"), "Q181086|Q386707");
  assert.throws(
    () => buildWikidataSceneEntitiesUrl({ workId: "Q1|Q2", locationId: "Q2" }),
    /canonical Q ids/,
  );
});

test("uses only the canonical Wikidata pair to obtain matching context", () => {
  assert.deepEqual(parseWikidataSceneEntities(wikidataPayload(), EXPECTED), {
    filmTitle: "A Clockwork Orange",
    place: "HM Prison Wandsworth",
    // Bounded: P18 names the original upload, measured at up to 7 MB (#198).
    locationImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg?width=800",
  });
  assert.equal(parseWikidataSceneEntities(wikidataPayload(), { ...EXPECTED, tmdbId: "999" }), null);
});

// The old SPARQL gate was `?work wdt:P915 ?location`. The entity API returns every
// statement, so the pair must still pass only on what `wdt:` would have returned.
test("a place counts only if the film states it as a filming location, truthily", () => {
  assert.equal(parseWikidataSceneEntities(wikidataPayload({ p915: [] }), EXPECTED), null);
  assert.equal(
    parseWikidataSceneEntities(wikidataPayload({ p915: [statement({ id: "Q386707" }, "deprecated")] }), EXPECTED),
    null,
    "a deprecated statement is a statement Wikidata itself disowns",
  );
  assert.equal(
    parseWikidataSceneEntities(wikidataPayload({
      p915: [statement({ id: "Q1" }, "preferred"), statement({ id: "Q386707" })],
    }), EXPECTED),
    null,
    "when a preferred statement exists, a normal one is not truthy",
  );
  assert.ok(parseWikidataSceneEntities(wikidataPayload({
    p915: [statement({ id: "Q386707" }, "preferred"), statement({ id: "Q1" })],
  }), EXPECTED));
});

test("truthy values follow the query service's rule exactly", () => {
  const entity = { claims: { P1: [statement("a"), statement("b", "deprecated"), statement("c")] } };
  assert.deepEqual(truthyValues(entity, "P1"), ["a", "c"]);
  assert.deepEqual(truthyValues({ claims: { P1: [statement("a"), statement("b", "preferred")] } }, "P1"), ["b"]);
  assert.deepEqual(truthyValues({}, "P1"), []);
});

test("a missing entity, a missing photo and a missing label are each handled", () => {
  assert.equal(parseWikidataSceneEntities({ entities: { Q181086: { id: "Q181086", missing: "" } } }, EXPECTED), null);
  assert.equal(parseWikidataSceneEntities(null, EXPECTED), null);
  assert.equal(parseWikidataSceneEntities(wikidataPayload({ p18: [] }), EXPECTED).locationImageUrl, null);
  const unlabelled = parseWikidataSceneEntities(wikidataPayload({ labels: false }), EXPECTED);
  assert.equal(unlabelled.filmTitle, "Q181086");
  assert.equal(unlabelled.place, "Q386707");
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
