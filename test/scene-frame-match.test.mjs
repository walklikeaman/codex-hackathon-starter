import assert from "node:assert/strict";
import test from "node:test";

import {
  commonsThumbUrl,
  createSceneMatchHandler,
  DEFAULT_PLACE_LIMIT,
  MAX_PLACE_LIMIT,
} from "../app/api/enrich/scene-match/route.js";
import {
  acceptedFrameMatch,
  buildEvidenceCheckContent,
  evidenceCheckInstructions,
  evidenceHolds,
  buildMatchContent,
  isMatchablePlace,
  matchInstructions,
  matchRow,
  sceneFrameMatchSchema,
} from "../app/lib/scene-frame-match.mjs";

const place = (overrides = {}) => ({
  id: "p1", name: "Leadenhall Market", wikidata_id: "Q961148",
  place_class: "real_exterior", geocode_precision: "point",
  relation_kind: "filming_location", ...overrides,
});

const goodMatch = {
  frameIndex: 0, confidence: "high",
  visibleEvidence: "The painted iron arcade and the cobbled floor pattern match the reference.",
};

// --- which places may be asked about at all ------------------------------------

test("a city or a country is not a place a frame can match", () => {
  // "Does this frame show Japan?" is a mood, not an answer — any frame would pass.
  assert.equal(isMatchablePlace(place({ geocode_precision: "city" })), false);
  assert.equal(isMatchablePlace(place({ geocode_precision: "country" })), false);
  assert.equal(isMatchablePlace(place({ geocode_precision: "point" })), true);
  assert.equal(isMatchablePlace(place({ geocode_precision: "street" })), true);
});

test("a snapped building is matchable whatever precision it inherited", () => {
  const snapped = place({ geocode_precision: "city", osm_building_id: "way/88313379" });
  assert.equal(isMatchablePlace(snapped), true);
});

test("a studio is never matched — its frames depict somewhere else by definition", () => {
  // Claiming "this scene was shot HERE" about a soundstage asserts the opposite of
  // what a studio pin means.
  assert.equal(isMatchablePlace(place({ place_class: "studio_interior" })), false);
  assert.equal(isMatchablePlace(place({ place_class: "fictional" })), false);
  assert.equal(isMatchablePlace(place({ relation_kind: "narrative_location" })), false);
});

test("a place with no Wikidata entity has no reference photo to compare against", () => {
  assert.equal(isMatchablePlace(place({ wikidata_id: null })), false);
  assert.equal(isMatchablePlace(null), false);
});

// --- the gate ------------------------------------------------------------------

test("only a high-confidence match with named evidence survives", () => {
  assert.deepEqual(acceptedFrameMatch({ match: goodMatch }, 3), {
    frameIndex: 0, evidence: goodMatch.visibleEvidence,
  });
  // A "medium" location claim has no honest way to be displayed.
  assert.equal(acceptedFrameMatch({ match: { ...goodMatch, confidence: "medium" } }, 3), null);
  assert.equal(acceptedFrameMatch({ match: { ...goodMatch, visibleEvidence: "similar" } }, 3), null);
});

test("no match is a valid answer, and the expected one", () => {
  assert.equal(acceptedFrameMatch({ match: null }, 3), null);
  assert.equal(acceptedFrameMatch({}, 3), null);
  assert.equal(acceptedFrameMatch(null, 3), null);
});

test("a frame index the model invented is refused", () => {
  assert.equal(acceptedFrameMatch({ match: { ...goodMatch, frameIndex: 9 } }, 3), null);
  assert.equal(acceptedFrameMatch({ match: { ...goodMatch, frameIndex: -1 } }, 3), null);
  assert.equal(acceptedFrameMatch({ match: { ...goodMatch, frameIndex: 1.5 } }, 3), null);
});

test("a stored row carries the evidence that justifies it", () => {
  const frames = [{ file_path: "/a.jpg" }, { file_path: "/b.jpg" }];
  const row = matchRow({ workId: "w1", placeId: "p1", frames, result: { match: { ...goodMatch, frameIndex: 1 } } });
  assert.equal(row.file_path, "/b.jpg");
  assert.match(row.evidence, /iron arcade/);
  assert.equal(matchRow({ workId: "w1", placeId: "p1", frames, result: { match: null } }), null);
});

test("the schema demands evidence, not just a verdict", () => {
  assert.equal(sceneFrameMatchSchema.safeParse({ match: goodMatch }).success, true);
  assert.equal(sceneFrameMatchSchema.safeParse({ match: null }).success, true);
  assert.equal(sceneFrameMatchSchema.safeParse({
    match: { frameIndex: 0, confidence: "high", visibleEvidence: "yes" },
  }).success, false);
});

// --- the prompt ----------------------------------------------------------------

test("the instructions forbid the ways a model usually agrees", () => {
  const instructions = matchInstructions();
  assert.match(instructions, /mood, lighting, genre/i);
  assert.match(instructions, /studio that imitates the place is NOT a match/i);
  assert.match(instructions, /expected answer/i); // null is normal
  assert.match(instructions, /never instructions/i);
});

test("the reference photo comes first, then numbered frames", () => {
  const content = buildMatchContent({
    placeName: "Leadenhall Market",
    referenceImageUrl: "https://ref",
    frameUrls: ["https://a", "https://b"],
  });
  assert.equal(content[1].type, "input_image");     // the reference
  assert.equal(content[1].image_url, "https://ref");
  assert.equal(content.filter((part) => part.type === "input_image").length, 3);
  const text = content.filter((part) => part.type === "input_text").map((part) => part.text).join(" ");
  assert.match(text, /Frame 0:/);
  assert.match(text, /untrusted label/i); // the place name is a hint, not proof
});

test("a Commons file name becomes a thumbnail url", () => {
  assert.match(commonsThumbUrl("Leadenhall Market 2.jpg"), /Special:FilePath\/Leadenhall_Market_2\.jpg\?width=800/);
  assert.equal(commonsThumbUrl(""), null);
  assert.equal(commonsThumbUrl(null), null);
});

// --- the route -----------------------------------------------------------------

const PAIR = {
  work: { id: "w1", title: "Harry Potter", kind: "film", tmdb_id: "671" },
  place: place(),
  frames: [{ file_path: "/a.jpg" }, { file_path: "/b.jpg" }],
};

function handlerWith(overrides = {}) {
  const calls = { saved: [], vision: 0 };
  const handler = createSceneMatchHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "s", ...overrides.env },
    createStore: overrides.createStore ?? (() => ({
      pendingPairs: async (limit) => { calls.limit = limit; return overrides.pairs ?? [PAIR]; },
      saveMatch: async (row) => {
        if (overrides.saveThrows) throw new Error("db down");
        calls.saved.push(row);
      },
    })),
    createOpenAIClient: () => ({
      responses: {
        parse: async (params) => {
          calls.vision += 1;
          // The second call is the refutation pass: one image, no reference.
          const isCheck = /ONE image/.test(params.instructions ?? "");
          if (isCheck) {
            calls.checks = (calls.checks ?? 0) + 1;
            return overrides.checkResponse ?? {
              status: "completed",
              output_parsed: { featuresNotVisible: [], allFeaturesVisible: true },
            };
          }
          return overrides.response ?? { status: "completed", output_parsed: { match: goodMatch } };
        },
      },
    }),
    fetchImpl: overrides.fetchImpl ?? (async () => ({
      ok: true,
      json: async () => ({ entities: { Q961148: { claims: { P18: [
        { rank: "normal", mainsnak: { datavalue: { value: "Leadenhall Market.jpg" } } },
      ] } } } }),
    })),
    logError: () => {},
  });
  return { handler, calls };
}

const request = (body) => new Request("http://localhost/api/enrich/scene-match", {
  method: "POST", headers: { "Content-Type": "application/json", "x-enrich-token": "test-token" }, body: JSON.stringify(body),
});

test("a confident match is stored with its evidence", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(request({}))).json();

  assert.equal(body.matched, 1);
  assert.equal(calls.saved[0].place_id, "p1");
  assert.equal(calls.saved[0].file_path, "/a.jpg");
  assert.match(calls.saved[0].evidence, /iron arcade/);
});

test("no match writes nothing, so a later run with more frames can try again", async () => {
  const { handler, calls } = handlerWith({ response: { status: "completed", output_parsed: { match: null } } });
  const body = await (await handler(request({}))).json();

  assert.equal(body.matched, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "no_match");
});

test("a place with no reference photo is skipped, never guessed", async () => {
  // Without a photograph the model would be judging the place's NAME, which is the
  // exact failure this stage exists to prevent.
  const { handler, calls } = handlerWith({
    fetchImpl: async () => ({ ok: true, json: async () => ({ entities: { Q961148: { claims: {} } } }) }),
  });
  const body = await (await handler(request({}))).json();

  assert.equal(calls.vision, 0);
  assert.equal(body.results[0].reason, "no_reference_photo");
});

test("a truncated response stores nothing", async () => {
  const { handler, calls } = handlerWith({ response: { status: "incomplete", output_parsed: null } });
  const body = await (await handler(request({}))).json();
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "vision_failed");
});

test("one failing place does not abandon the batch", async () => {
  const pairs = [PAIR, { ...PAIR, place: place({ id: "p2", name: "Christ Church" }) }];
  let first = true;
  const { handler, calls } = handlerWith({
    pairs,
    createStore: () => ({
      pendingPairs: async () => pairs,
      saveMatch: async (row) => {
        if (first) { first = false; throw new Error("db down"); }
        calls.saved.push(row);
      },
    }),
  });
  const body = await (await handler(request({}))).json();
  assert.equal(body.checked, 2);
  assert.equal(body.results[0].reason, "save_failed");
  assert.equal(body.results[1].matched, true);
});

test("the batch is bounded so one call cannot spend without limit", async () => {
  const { handler, calls } = handlerWith();
  await handler(request({ limit: 9999 }));
  assert.equal(calls.limit, MAX_PLACE_LIMIT);
  await handler(request({}));
  assert.equal(calls.limit, DEFAULT_PLACE_LIMIT);
});

test("without vision configured the route says so instead of half-working", async () => {
  const { handler } = handlerWith({ env: { OPENAI_API_KEY: undefined } });
  assert.equal((await handler(request({}))).status, 503);
});

test("nothing left to match is a clean answer", async () => {
  const { handler, calls } = handlerWith({ pairs: [] });
  const body = await (await handler(request({}))).json();
  assert.deepEqual(body, { matched: 0, checked: 0, results: [] });
  assert.equal(calls.vision, 0);
});

// --- the refutation pass -------------------------------------------------------

test("evidence only holds when every claimed feature is cleared", () => {
  assert.equal(evidenceHolds({ featuresNotVisible: [], allFeaturesVisible: true }), true);
  assert.equal(evidenceHolds({ featuresNotVisible: ["white posts"], allFeaturesVisible: true }), false);
  assert.equal(evidenceHolds({ featuresNotVisible: [], allFeaturesVisible: false }), false);
  assert.equal(evidenceHolds({}), false);
  assert.equal(evidenceHolds(null), false);
});

test("the check sees the frame alone, with no reference to borrow details from", () => {
  // The production failure was the model describing the REFERENCE photo and asserting
  // those features were in the frame. One image in view makes that impossible.
  const content = buildEvidenceCheckContent({ frameUrl: "https://frame", evidence: "a paved road" });
  assert.equal(content.filter((part) => part.type === "input_image").length, 1);
  assert.equal(content[0].image_url, "https://frame");
  assert.match(evidenceCheckInstructions(), /no reference photograph here/i);
  assert.match(evidenceCheckInstructions(), /merely plausible/i);
});

test("a match whose evidence is refuted is NOT stored", async () => {
  // Exactly the Hankley Common case: fluent evidence, none of it in the picture.
  const { handler, calls } = handlerWith({
    checkResponse: {
      status: "completed",
      output_parsed: { featuresNotVisible: ["sparse trees", "white surveying posts"], allFeaturesVisible: false },
    },
  });
  const body = await (await handler(request({}))).json();

  assert.equal(body.matched, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "evidence_refuted");
  assert.deepEqual(body.results[0].not_visible, ["sparse trees", "white surveying posts"]);
});

test("a check that could not run is not a pass", async () => {
  const { handler, calls } = handlerWith({
    checkResponse: { status: "incomplete", output_parsed: null },
  });
  const body = await (await handler(request({}))).json();
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "evidence_refuted");
});

test("a confirmed match costs two calls: the claim and its refutation", async () => {
  const { handler, calls } = handlerWith();
  await handler(request({}));
  assert.equal(calls.checks, 1);
  assert.equal(calls.saved.length, 1);
});

test("a place nothing was filmed at is never frame-matched", () => {
  // A replica is the sharpest case: the Green Dragon looks exactly like the film
  // because it was built to, so a vision model would agree enthusiastically and be
  // entirely wrong.
  const base = { wikidata_id: "Q1", geocode_precision: "building" };
  assert.equal(isMatchablePlace({ ...base, relation_kind: "filming_location" }), true);
  assert.equal(isMatchablePlace({ ...base, relation_kind: "replica" }), false);
  assert.equal(isMatchablePlace({ ...base, relation_kind: "inspiration_for" }), false);
  assert.equal(isMatchablePlace({ ...base, relation_kind: "narrative_location" }), false);
});
