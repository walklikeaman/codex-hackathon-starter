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
  params.delete("v");
  params.set("v", overrides.v ?? "4");
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

function tmdbResponse(backdrops = [
  { file_path: "/generic.jpg", vote_count: 20, vote_average: 8, width: 1920 },
  { file_path: "/matching.jpg", vote_count: 10, vote_average: 7, width: 1920 },
]) {
  return new Response(JSON.stringify({
    backdrops,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function upstreamFetch({ bindings, backdrops } = {}) {
  return async (url) => {
    const endpoint = new URL(url);
    if (endpoint.hostname === "query.wikidata.org") return wikidataResponse(bindings);
    if (endpoint.hostname === "api.themoviedb.org") return tmdbResponse(backdrops);
    throw new Error(`Unexpected upstream ${endpoint.hostname}`);
  };
}

function frameMatch(overrides = {}) {
  return {
    isPhotographicFrame: true,
    hasProminentTitleOrLogo: false,
    ...overrides,
  };
}

function handlerForMatch({
  outputParsed,
  verificationParsed,
  status = "completed",
  onParse,
  onVerify,
  backdrops,
  bindings,
} = {}) {
  let parseCall = 0;
  return createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
      OPENAI_VISION_MODEL: "test-vision-model",
    },
    fetchImpl: upstreamFetch({ backdrops, bindings }),
    allowRequest: () => true,
    verifyToken: () => true,
    logError: () => {},
    createOpenAIClient: () => ({
      responses: {
        parse: async (body, options) => {
          const call = parseCall;
          parseCall += 1;
          if (call === 0) {
            onParse?.(body, options);
            return { status, output_parsed: outputParsed };
          }

          onVerify?.(body, options);
          return {
            status: "completed",
            output_parsed: verificationParsed ?? {
              matches: (outputParsed?.matches ?? [])
                .filter((match) => match.confidence === "high"
                  && match.isPhotographicFrame === true
                  && match.hasProminentTitleOrLogo === false)
                .map((match, index) => ({ ...match, candidateIndex: index })),
            },
          };
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

test("film image API redirects stale or cache-busting queries to the current matcher version", async () => {
  const handler = createFilmImageHandler({ env: {} });
  const response = await handler(filmImageRequest({ v: "1", ignored: "cache-buster" }));

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/api/film-image?tmdbId=185&workId=Q181086&locationId=Q386707&v=4",
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
      matches: [frameMatch({
        candidateIndex: 1,
        confidence: "high",
        locationType: "building",
        description: "The same prison gate and brick wings are visible.",
      })],
    },
    onParse: (body, options) => {
      assert.equal(body.model, "test-vision-model");
      assert.equal(body.reasoning.effort, "low");
      assert.equal(body.max_output_tokens, 1000);
      assert.match(body.instructions, /already been verified/);
      assert.match(body.instructions, /up to three distinct candidate frames/);
      assert.equal(
        body.input[0].content.filter((item) => item.type === "input_image").length,
        3,
      );
      assert.equal(options.signal, request.signal);
    },
    onVerify: (body) => {
      assert.match(body.instructions, /final verifier/);
      assert.equal(
        body.input[0].content.filter((item) => item.type === "input_image").length,
        1,
      );
    },
  });
  const response = await handler(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, "https://image.tmdb.org/t/p/w780/matching.jpg");
  assert.equal(payload.match_method, "openai_vision");
  assert.equal(payload.match_confidence, "high");
  assert.deepEqual(payload.frames, [{
    image_url: "https://image.tmdb.org/t/p/w780/matching.jpg",
    source_url: "https://www.themoviedb.org/movie/185/images/backdrops",
    location_name: "HM Prison Wandsworth",
    location_type: "building",
    description: "The same prison gate and brick wings are visible.",
    match_confidence: "high",
    match_method: "openai_vision",
  }]);
});

test("film image API returns up to three distinct described frames", async () => {
  const handler = handlerForMatch({
    outputParsed: {
      matches: [
        frameMatch({
          candidateIndex: 1,
          confidence: "high",
          locationType: "building",
          description: "The brick gate matches the verified prison location.",
        }),
        frameMatch({
          candidateIndex: 0,
          confidence: "high",
          locationType: "building",
          description: "The institutional courtyard repeats the same brick layout.",
        }),
      ],
    },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.frames.length, 2);
  assert.deepEqual(
    payload.frames.map((frame) => frame.image_url),
    [
      "https://image.tmdb.org/t/p/w780/matching.jpg",
      "https://image.tmdb.org/t/p/w780/generic.jpg",
    ],
  );
  assert.equal(payload.image_url, payload.frames[0].image_url);
});

test("film image API rejects a shortlisted image that fails exact final verification", async () => {
  const handler = handlerForMatch({
    outputParsed: {
      matches: [frameMatch({
        candidateIndex: 0,
        confidence: "high",
        locationType: "building",
        description: "The first pass claims this artwork shows the location.",
      })],
    },
    verificationParsed: { matches: [] },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, null);
  assert.deepEqual(payload.frames, []);
  assert.equal(payload.reason, "no_high_confidence_match");
});

test("film image API can associate representative frames with an explicit studio", async () => {
  const handler = handlerForMatch({
    bindings: [{
      workLabel: { value: "Test Film" },
      locationLabel: { value: "Pinewood Studios" },
      tmdbId: { value: "185" },
    }],
    outputParsed: {
      matches: [frameMatch({
        candidateIndex: 0,
        confidence: "high",
        locationType: "building",
        description: "An interior production frame; the exact soundstage is not visible.",
      })],
    },
    onParse: (body) => {
      assert.equal(
        body.input[0].content.filter((item) => item.type === "input_image").length,
        2,
      );
      assert.match(body.input[0].content[0].text, /explicitly a studio/);
    },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.frames[0].location_name, "Pinewood Studios");
  assert.equal(payload.frames[0].location_type, "studio");
});

test("film image API can match a relevant backdrop beyond the first six", async () => {
  const backdrops = Array.from({ length: 11 }, (_, index) => ({
    file_path: `/candidate-${index}.jpg`,
    vote_count: 11 - index,
    vote_average: 7,
    width: 1920,
  }));
  const handler = handlerForMatch({
    backdrops,
    outputParsed: {
      matches: [frameMatch({
        candidateIndex: 10,
        confidence: "high",
        locationType: "building",
        description: "The same prison courtyard is visible.",
      })],
    },
    onParse: (body) => {
      assert.equal(
        body.input[0].content.filter((item) => item.type === "input_image").length,
        12,
      );
    },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.image_url, "https://image.tmdb.org/t/p/w780/candidate-10.jpg");
  assert.equal(payload.match_confidence, "high");
});

test("film image API hides a generic backdrop when confidence is not high", async () => {
  const handler = handlerForMatch({
    outputParsed: {
      matches: [frameMatch({
        candidateIndex: 0,
        confidence: "medium",
        locationType: "street",
        description: "The city looks similar but no landmark is conclusive.",
      })],
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
