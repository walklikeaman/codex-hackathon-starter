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

// What Wikidata's entity API says about the pair. `null` is a pair Wikidata does not
// state: the film exists, but not with this place as a filming location.
const CLOCKWORK = {
  workLabel: "A Clockwork Orange",
  locationLabel: "HM Prison Wandsworth",
  tmdbId: "185",
  image: "Test.jpg",
};

function statement(value, rank = "normal") {
  return { rank, mainsnak: { datavalue: { value } } };
}

function wikidataResponse(pair = CLOCKWORK) {
  const entities = {
    Q181086: {
      id: "Q181086",
      labels: { en: { value: pair?.workLabel ?? "A Clockwork Orange" } },
      claims: {
        P915: pair ? [statement({ id: "Q386707" })] : [],
        P4947: [statement(pair?.tmdbId ?? "185")],
      },
    },
    Q386707: {
      id: "Q386707",
      labels: { en: { value: pair?.locationLabel ?? "HM Prison Wandsworth" } },
      claims: { P18: pair?.image ? [statement(pair.image)] : [] },
    },
  };
  return new Response(JSON.stringify({ entities }), {
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

function upstreamFetch({ pair, backdrops } = {}) {
  return async (url) => {
    const endpoint = new URL(url);
    if (endpoint.hostname === "www.wikidata.org") return wikidataResponse(pair);
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
  pair,
  createFrameStore,
  fetchImpl,
  allowRequest,
  logError,
} = {}) {
  let parseCall = 0;
  return createFilmImageHandler({
    env: {
      TMDB_API_READ_ACCESS_TOKEN: "tmdb-test-token",
      OPENAI_API_KEY: "openai-test-key",
      OPENAI_VISION_MODEL: "test-vision-model",
    },
    fetchImpl: fetchImpl ?? upstreamFetch({ backdrops, pair }),
    allowRequest: allowRequest ?? (() => true),
    verifyToken: () => true,
    logError: logError ?? (() => {}),
    createFrameStore: createFrameStore ?? (() => null),
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
      SCENE_MATCH_SIGNING_SECRET: "openai-test-key",
    },
    fetchImpl: upstreamFetch({ pair: null }),
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
    // The first frame is the card's backdrop and the rest are 180 px strip thumbnails,
    // so they are not the same size (#198).
    [
      "https://image.tmdb.org/t/p/w780/matching.jpg",
      "https://image.tmdb.org/t/p/w400/generic.jpg",
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
    pair: { workLabel: "Test Film", locationLabel: "Pinewood Studios", tmdbId: "185", image: null },
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

// --- the answer, kept on our rows (#198) -------------------------------------------------

const TWO_FRAMES = {
  matches: [
    frameMatch({
      candidateIndex: 1, confidence: "high", locationType: "building",
      description: "The brick gate matches the verified prison location.",
    }),
    frameMatch({
      candidateIndex: 0, confidence: "high", locationType: "building",
      description: "The institutional courtyard repeats the same brick layout.",
    }),
  ],
};

const RESOLVED = {
  work_id: "11111111-1111-1111-1111-111111111111",
  place_id: "22222222-2222-2222-2222-222222222222",
  place_name: "HM Prison Wandsworth",
  linked: true,
  file_path: null,
};

function frameStore(resolved, { saveError, resolveError } = {}) {
  const calls = { resolve: [], save: [] };
  return {
    calls,
    create: () => ({
      async resolve(work, place) {
        calls.resolve.push([work, place]);
        if (resolveError) throw resolveError;
        return resolved;
      },
      async save(row) {
        calls.save.push(row);
        if (saveError) throw saveError;
      },
    }),
  };
}

test("a frame already on our rows is served without Wikidata, TMDB, a model, or the limiter", async () => {
  const store = frameStore({
    ...RESOLVED,
    file_path: "/matching.jpg",
    evidence: "The brick gate matches the verified prison location.",
    method: "film_image",
    matcher_version: "4",
    location_type: "building",
    also: [{ file_path: "/generic.jpg", evidence: "The courtyard repeats the brick layout.", location_type: "building" }],
  });
  let upstream = 0;
  let limited = 0;
  let parsed = 0;
  const handler = handlerForMatch({
    createFrameStore: store.create,
    fetchImpl: async () => { upstream += 1; throw new Error("no upstream expected"); },
    allowRequest: () => { limited += 1; return true; },
    onParse: () => { parsed += 1; },
  });
  const response = await handler(filmImageRequest());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(store.calls.resolve, [["Q181086", "Q386707"]]);
  assert.equal(upstream, 0);
  assert.equal(parsed, 0);
  assert.equal(limited, 0);
  assert.equal(payload.stored, true);
  assert.deepEqual(payload.frames.map((frame) => frame.image_url), [
    "https://image.tmdb.org/t/p/w780/matching.jpg",
    "https://image.tmdb.org/t/p/w400/generic.jpg",
  ]);
  assert.equal(payload.frames[0].location_name, "HM Prison Wandsworth");
  assert.equal(payload.frames[0].description, "The brick gate matches the verified prison location.");
  assert.match(response.headers.get("cache-control"), /s-maxage=2592000/);
});

test("a live match on a pair the graph links is written down, gallery and version included", async () => {
  const store = frameStore(RESOLVED);
  const handler = handlerForMatch({ createFrameStore: store.create, outputParsed: TWO_FRAMES });
  const response = await handler(filmImageRequest());

  assert.equal(response.status, 200);
  assert.equal(store.calls.save.length, 1);
  assert.deepEqual(store.calls.save[0], {
    work_id: RESOLVED.work_id,
    place_id: RESOLVED.place_id,
    file_path: "/matching.jpg",
    evidence: "The brick gate matches the verified prison location.",
    location_type: "building",
    method: "film_image",
    matcher_version: "4",
    also: [{
      file_path: "/generic.jpg",
      evidence: "The institutional courtyard repeats the same brick layout.",
      location_type: "building",
    }],
  });
});

// Wikidata states the pair; our graph does not. Writing a frame would assert the link by
// the back door, so the card answers live and records nothing.
test("a pair our graph does not link is matched but not recorded", async () => {
  for (const resolved of [{ ...RESOLVED, linked: false }, null]) {
    const store = frameStore(resolved);
    const handler = handlerForMatch({ createFrameStore: store.create, outputParsed: TWO_FRAMES });
    const payload = await (await handler(filmImageRequest())).json();
    assert.equal(payload.frames.length, 2);
    assert.equal(store.calls.save.length, 0);
  }
});

// Bumping the matcher version is how a changed matcher disowns its old answers.
test("a card frame from an older matcher is matched again, and not overwritten", async () => {
  const store = frameStore({
    ...RESOLVED,
    file_path: "/old.jpg",
    evidence: "Recorded by a matcher that has since changed.",
    method: "film_image",
    matcher_version: "3",
  });
  let parsed = 0;
  const handler = handlerForMatch({
    createFrameStore: store.create, outputParsed: TWO_FRAMES, onParse: () => { parsed += 1; },
  });
  const payload = await (await handler(filmImageRequest())).json();

  assert.equal(parsed, 1);
  assert.equal(payload.stored, undefined);
  assert.equal(store.calls.save.length, 0, "the row exists; replacing it is not this route's call");
});

test("a store that fails costs a live match, never the answer", async () => {
  const logged = [];
  const failingLookup = frameStore(RESOLVED, { resolveError: new Error("db down") });
  const lookupHandler = handlerForMatch({
    createFrameStore: failingLookup.create, outputParsed: TWO_FRAMES, logError: (...args) => logged.push(args),
  });
  const first = await lookupHandler(filmImageRequest());
  assert.equal(first.status, 200);
  assert.equal((await first.json()).frames.length, 2);

  const failingSave = frameStore(RESOLVED, { saveError: new Error("constraint") });
  const saveHandler = handlerForMatch({
    createFrameStore: failingSave.create, outputParsed: TWO_FRAMES, logError: (...args) => logged.push(args),
  });
  const second = await saveHandler(filmImageRequest());
  assert.equal(second.status, 200);
  assert.equal(failingSave.calls.save.length, 1);
  assert.equal(logged.length, 2);
});

// --- a slow or refusing Wikidata (the cold-ask 502) --------------------------------------

function flakyWikidata(firstAnswers) {
  const answers = [...firstAnswers];
  const calls = { wikidata: 0 };
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url);
    if (endpoint.hostname === "www.wikidata.org") {
      calls.wikidata += 1;
      const next = answers.shift();
      if (next === "timeout") {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      }
      if (typeof next === "number") {
        return new Response("slow down", { status: next, headers: { "Retry-After": "0" } });
      }
      return wikidataResponse();
    }
    if (endpoint.hostname === "api.themoviedb.org") return tmdbResponse();
    throw new Error(`Unexpected upstream ${endpoint.hostname}`);
  };
  return { fetchImpl, calls };
}

const ONE_FRAME = {
  matches: [frameMatch({
    candidateIndex: 1, confidence: "high", locationType: "building",
    description: "The brick gate matches the verified prison location.",
  })],
};

test("a Wikidata 429 or timeout is asked once more before the card is told anything", async () => {
  for (const first of [429, 503, "timeout"]) {
    const { fetchImpl, calls } = flakyWikidata([first]);
    const handler = handlerForMatch({ fetchImpl, outputParsed: ONE_FRAME });
    const response = await handler(filmImageRequest());
    assert.equal(response.status, 200, `after ${first}`);
    assert.equal(calls.wikidata, 2);
    assert.equal((await response.json()).frames.length, 1);
  }
});

// A 404 is an answer, not a bad moment: asking again would get the same one.
test("a Wikidata refusal that is not transient is not retried", async () => {
  const { fetchImpl, calls } = flakyWikidata([404]);
  const handler = handlerForMatch({ fetchImpl, outputParsed: ONE_FRAME });
  const response = await handler(filmImageRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.wikidata, 1);
});

// The log used to say only "TimeoutError", which could not tell Wikidata from TMDB.
test("when both attempts fail, the log names the upstream that failed", async () => {
  const logged = [];
  const { fetchImpl, calls } = flakyWikidata(["timeout", "timeout"]);
  const handler = handlerForMatch({ fetchImpl, outputParsed: ONE_FRAME, logError: (...args) => logged.push(args) });
  const response = await handler(filmImageRequest());

  assert.equal(response.status, 502);
  assert.equal(calls.wikidata, 2);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1].stage, "wikidata");
  assert.match(logged[0][1].message, /wikidata: TimeoutError/);
});

test("the pair is checked against the entity API with a bounded reference photo", async () => {
  const seen = [];
  const handler = handlerForMatch({
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      return upstreamFetch()(url, init);
    },
    outputParsed: ONE_FRAME,
    onParse: (body) => {
      const images = body.input[0].content.filter((part) => part.type === "input_image").map((part) => part.image_url);
      assert.equal(images[0], "https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg?width=800");
    },
  });
  // An assertion failing inside onParse surfaces as the route's 502, so the status is
  // what proves the reference-photo check above actually passed.
  assert.equal((await handler(filmImageRequest())).status, 200);
  assert.ok(seen.some((url) => url.startsWith("https://www.wikidata.org/w/api.php?action=wbgetentities")));
  assert.ok(!seen.some((url) => url.includes("query.wikidata.org")));
});

// --- a "no", remembered with what it was a "no" to ---------------------------------------

function verdictStore(initial = null, { lookupError, saveError } = {}) {
  let stored = initial;
  const calls = { lookups: 0, saves: [] };
  return {
    calls,
    get stored() { return stored; },
    create: () => ({
      async resolve() { return null; },
      async save() {},
      async verdict() {
        calls.lookups += 1;
        if (lookupError) throw lookupError;
        return stored;
      },
      async saveVerdict(row) {
        calls.saves.push(row);
        if (saveError) throw saveError;
        stored = row;
      },
    }),
  };
}

const NOTHING_HIGH = {
  matches: [frameMatch({ candidateIndex: 0, confidence: "low", locationType: "street", description: "A generic street." })],
};

test("a paid no is written down with its fingerprint, and the next ask skips the model", async () => {
  const store = verdictStore();
  let parsed = 0;
  const make = () => handlerForMatch({
    createFrameStore: store.create, outputParsed: NOTHING_HIGH, onParse: () => { parsed += 1; },
  });

  const first = await (await make()(filmImageRequest())).json();
  assert.equal(first.reason, "no_high_confidence_match");
  assert.equal(parsed, 1);
  assert.equal(store.calls.saves.length, 1);
  assert.equal(store.calls.saves[0].work_qid, "Q181086");
  assert.equal(store.calls.saves[0].place_qid, "Q386707");
  assert.equal(store.calls.saves[0].matcher_version, "4");
  assert.equal(store.calls.saves[0].candidates, 2);
  assert.match(store.calls.saves[0].inputs_hash, /^[0-9a-f]{64}$/);

  const second = await (await make()(filmImageRequest())).json();
  assert.equal(parsed, 1, "the model was not asked again");
  assert.equal(second.stored, true);
  assert.equal(second.reason, "no_high_confidence_match");
  assert.deepEqual(second.frames, []);
  assert.equal(second.match_confidence, "low");
});

test("a no reached at final verification is remembered too", async () => {
  const store = verdictStore();
  const handler = handlerForMatch({
    createFrameStore: store.create,
    outputParsed: { matches: [frameMatch({ candidateIndex: 0, confidence: "high", locationType: "building", description: "Looks like the gate at first glance." })] },
    verificationParsed: { matches: [] },
  });
  const payload = await (await handler(filmImageRequest())).json();
  assert.equal(payload.reason, "no_high_confidence_match");
  assert.equal(store.calls.saves.length, 1);
});

// TMDB adding a backdrop is exactly the change that could turn a "no" into a frame.
test("a no to different inputs is asked again", async () => {
  const store = verdictStore();
  let parsed = 0;
  await handlerForMatch({ createFrameStore: store.create, outputParsed: NOTHING_HIGH, onParse: () => { parsed += 1; } })(filmImageRequest());
  await handlerForMatch({
    createFrameStore: store.create,
    outputParsed: NOTHING_HIGH,
    onParse: () => { parsed += 1; },
    backdrops: [
      { file_path: "/generic.jpg", vote_count: 20, vote_average: 8, width: 1920 },
      { file_path: "/matching.jpg", vote_count: 10, vote_average: 7, width: 1920 },
      { file_path: "/new.jpg", vote_count: 5, vote_average: 7, width: 1920 },
    ],
  })(filmImageRequest());
  assert.equal(parsed, 2);
  assert.equal(store.calls.saves.length, 2, "the newer no replaces the older one");
});

test("a no from an older matcher is asked again", async () => {
  const store = verdictStore();
  await handlerForMatch({ createFrameStore: store.create, outputParsed: NOTHING_HIGH })(filmImageRequest());
  const old = { ...store.stored, matcher_version: "3" };
  const replay = verdictStore(old);
  let parsed = 0;
  await handlerForMatch({ createFrameStore: replay.create, outputParsed: NOTHING_HIGH, onParse: () => { parsed += 1; } })(filmImageRequest());
  assert.equal(parsed, 1);
});

test("a found frame writes no verdict", async () => {
  const store = verdictStore();
  const handler = handlerForMatch({ createFrameStore: store.create, outputParsed: ONE_FRAME });
  const payload = await (await handler(filmImageRequest())).json();
  assert.equal(payload.frames.length, 1);
  assert.equal(store.calls.saves.length, 0);
});

test("a verdict store that fails costs the model calls, never the answer", async () => {
  const logged = [];
  let parsed = 0;
  const failing = verdictStore({ reason: "no_high_confidence_match" }, { lookupError: new Error("db down"), saveError: new Error("db down") });
  const response = await handlerForMatch({
    createFrameStore: failing.create,
    outputParsed: NOTHING_HIGH,
    onParse: () => { parsed += 1; },
    logError: (...args) => logged.push(args[0]),
  })(filmImageRequest());
  assert.equal(response.status, 200);
  assert.equal(parsed, 1);
  assert.deepEqual(logged, ["Stored verdict lookup failed", "Verdict was not recorded"]);
});
