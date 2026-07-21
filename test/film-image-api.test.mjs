import assert from "node:assert/strict";
import test from "node:test";

import { createFilmImageHandler } from "../app/api/film-image/route.js";
import { signSceneMatchRequest } from "../app/lib/scene-match-token.mjs";

function filmImageRequest(overrides = {}, init = {}) {
  const params = new URLSearchParams({
    tmdbId: "185",
    workId: "Q181086",
    locationId: "Q386707",
    ...overrides,
  });
  return new Request(`http://localhost/api/film-image?${params}`, init);
}

function wikidataResponse(bindings = [{
  workLabel: { value: "A Clockwork Orange" },
  locationLabel: { value: "HM Prison Wandsworth" },
  tmdbId: { value: "185" },
  image: { value: "https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg" },
}]) {
  return new Response(JSON.stringify({ results: { bindings } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tmdbResponse() {
  return new Response(JSON.stringify({
    backdrops: [
      { file_path: "/generic.jpg", vote_count: 20, vote_average: 8, width: 1920 },
      { file_path: "/matching.jpg", vote_count: 10, vote_average: 7, width: 1920 },
    ],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function upstreamFetch({ bindings } = {}) {
  return async (url) => {
    const endpoint = new URL(url);
    if (endpoint.hostname === "query.wikidata.org") return wikidataResponse(bindings);
    if (endpoint.hostname === "api.themoviedb.org") return tmdbResponse();
    throw new Error(`Unexpected upstream ${endpoint.hostname}`);
  };
}

function handlerForMatch({ outputParsed, status = "completed", onParse } = {}) {
  return createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
      OPENAI_VISION_MODEL: "test-vision-model",
    },
    fetchImpl: upstreamFetch(),
    allowRequest: () => true,
    verifyToken: () => true,
    logError: () => {},
    createOpenAIClient: () => ({
      responses: {
        parse: async (body, options) => {
          onParse?.(body, options);
          return { status, output_parsed: outputParsed };
        },
      },
    }),
  });
}

test("film image API rejects incomplete canonical ids", async () => {
  const handler = createFilmImageHandler({ env: {} });
  const response = await handler(filmImageRequest({ workId: "invalid" }));

  assert.equal(response.status, 400);
});

test("film image API redirects non-canonical cache-busting queries", async () => {
  const handler = createFilmImageHandler({ env: {} });
  const response = await handler(filmImageRequest({ ignored: "cache-buster" }));

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/api/film-image?tmdbId=185&workId=Q181086&locationId=Q386707",
  );
});

test("film image API stays honest when matching is not configured", async () => {
  const handler = createFilmImageHandler({ env: {} });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, null);
  assert.equal(payload.reason, "tmdb_not_configured");
});

test("film image API requires a server-issued film-location capability", async () => {
  let upstreamCalled = false;
  const handler = createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
    },
    fetchImpl: async () => {
      upstreamCalled = true;
      throw new Error("must not run");
    },
  });
  const response = await handler(filmImageRequest());

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(upstreamCalled, false);
});

test("film image API rate-limits origin work before paid calls", async () => {
  const handler = createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
    },
    verifyToken: () => true,
    allowRequest: () => false,
  });
  const response = await handler(filmImageRequest());

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "600");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("film image API rejects an unverified film-location pair before paid matching", async () => {
  const token = signSceneMatchRequest({
    tmdbId: "185",
    workId: "Q181086",
    locationId: "Q386707",
  }, "openai-test-key");
  const handler = createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
    },
    fetchImpl: upstreamFetch({ bindings: [] }),
    allowRequest: () => true,
  });
  const response = await handler(filmImageRequest({ token }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, null);
  assert.equal(payload.reason, "unverified_film_location");
});

test("film image API returns the location-matched candidate instead of the top backdrop", async () => {
  const request = filmImageRequest();
  const handler = handlerForMatch({
    outputParsed: {
      candidateIndex: 1,
      confidence: "high",
      evidence: "The same prison gate and brick wings are visible.",
    },
    onParse: (body, options) => {
      assert.equal(body.model, "test-vision-model");
      assert.equal(body.reasoning.effort, "low");
      assert.equal(body.max_output_tokens, 600);
      assert.equal(
        body.input[0].content.filter((item) => item.type === "input_image").length,
        3,
      );
      assert.equal(options.signal, request.signal);
    },
  });
  const response = await handler(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, "https://image.tmdb.org/t/p/w780/matching.jpg");
  assert.equal(payload.match_method, "openai_vision");
  assert.equal(payload.match_confidence, "high");
});

test("film image API hides a generic backdrop when confidence is not high", async () => {
  const handler = handlerForMatch({
    outputParsed: {
      candidateIndex: 0,
      confidence: "medium",
      evidence: "The city looks similar but no landmark is conclusive.",
    },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, null);
  assert.equal(payload.reason, "no_high_confidence_match");
  assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
});

test("film image API never caches incomplete or refused matcher output as no-match", async () => {
  const handler = handlerForMatch({ status: "incomplete", outputParsed: null });
  const response = await handler(filmImageRequest());

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("film image API never falls back to a generic backdrop after a matcher error", async () => {
  const handler = createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
    },
    fetchImpl: upstreamFetch(),
    verifyToken: () => true,
    allowRequest: () => true,
    logError: () => {},
    createOpenAIClient: () => ({
      responses: {
        parse: async () => { throw new Error("Vision unavailable"); },
      },
    }),
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.image_url, undefined);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
