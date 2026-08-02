import assert from "node:assert/strict";
import test from "node:test";

import { createTrailHandler } from "../app/api/trail/route.js";

const WORK = "11111111-1111-1111-1111-111111111111";

const parsedTrail = {
  scenes: [
    {
      sequence_index: 1, place_name: "Trafalgar Square", geo_hint: "London",
      plot_beat: "They meet under the column.", safe_teaser: "Where it begins",
      spoiler_tier: 1, is_fictional_setting: false, known_place: null,
    },
    {
      sequence_index: 2, place_name: "Hogwarts", geo_hint: "",
      plot_beat: "The letter arrives.", safe_teaser: "A journey starts",
      spoiler_tier: 3, is_fictional_setting: true, known_place: null,
    },
  ],
};

// What the model layer actually returns now: a chat completion whose content is the
// JSON, validated against the real schema on the way through. The old harness handed
// back `output_parsed` and so never exercised the schema at all — which is how a
// fixture missing a required field passed for weeks.
const modelReply = (parsed) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(parsed) } }],
});

function handlerWith(overrides = {}) {
  const calls = { generated: 0, saved: null };
  const handler = createTrailHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k", ...overrides.env },
    createRuntime: () => ("runtime" in overrides ? overrides.runtime : {
      provider: "openrouter", tier: "cheap", model: "free-model", extraBody: {},
      client: { chat: { completions: { create: async (body) => {
        calls.instructions = body.messages[0].content;
        calls.generated += 1;
        return overrides.response ?? {
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(parsedTrail) } }],
        };
      } } } },
    }),
    createStore: overrides.createStore ?? (() => ({
      // `??` cannot tell "not supplied" from "deliberately null", which is exactly
      // what the 404 case needs to express.
      loadWork: async () => ("work" in overrides
        ? overrides.work
        : { id: WORK, title: "Notting Hill", kind: "film", year: 1999 }),
      existingScenes: async () => overrides.existingScenes ?? [],
      workPlaces: async () => overrides.places ?? [],
      linkScenes: async (workId, links) => {
        if (overrides.linkThrows) throw new Error("db down");
        calls.linked = links;
        return links.length;
      },
      saveScenes: async (workId, scenes) => {
        calls.saved = scenes;
        return scenes.map((scene, index) => ({ id: `s${index}`, sequence_index: scene.sequence_index }));
      },
    })),
    logError: () => {},
  });
  return { handler, calls };
}

const trailRequest = (body) =>
  new Request("http://localhost/api/trail", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-enrich-token": "test-token" },
    body: JSON.stringify(body),
  });

test("a work that already has a trail costs no model call", async () => {
  // Extraction is the expensive step and the story does not change, so the scenes
  // table IS the cache.
  const { handler, calls } = handlerWith({
    existingScenes: [{ id: "s1", sequence_index: 1, plot_beat: "…" }],
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(body.cached, true);
  assert.equal(calls.generated, 0);
  assert.equal(body.scenes.length, 1);
});

test("a first extraction saves the scenes for next time", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(body.cached, false);
  assert.equal(calls.generated, 1);
  assert.equal(body.extracted, 2);
  assert.equal(calls.saved.length, 2);
  // The fictional scene is KEPT as a scene — it is real content; it simply must not
  // be given a coordinate later.
  assert.equal(calls.saved[1].is_fictional_setting, true);
});

test("an empty extraction is an honest answer, not a cached trail", async () => {
  // Caching "nothing" would permanently mark a work as having no story.
  const { handler, calls } = handlerWith({
    response: modelReply({ scenes: [] }),
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.deepEqual(body.scenes, []);
  assert.equal(body.reason, "no_extractable_trail");
  assert.equal(calls.saved, null); // nothing written
});

test("a refused or truncated response fails loudly rather than saving junk", async () => {
  const { handler, calls } = handlerWith({
    response: { choices: [{ finish_reason: "length", message: { content: "{" } }] },
  });
  const response = await handler(trailRequest({ work_id: WORK }));
  assert.equal(response.status, 502);
  assert.equal(calls.saved, null);
});

test("the request is validated before any work is done", async () => {
  const { handler, calls } = handlerWith();
  assert.equal((await handler(trailRequest({}))).status, 400);
  assert.equal((await handler(trailRequest({ work_id: "nope" }))).status, 400);
  assert.equal(calls.generated, 0);
});

test("an unknown work is a 404, not an extraction", async () => {
  const { handler, calls } = handlerWith({ work: null });
  const response = await handler(trailRequest({ work_id: WORK }));
  assert.equal(response.status, 404);
  assert.equal(calls.generated, 0);
});

test("without the service role the route says so instead of half-working", async () => {
  const { handler } = handlerWith({ createStore: () => null });
  assert.equal((await handler(trailRequest({ work_id: WORK }))).status, 503);
});

// --- grounded extraction ---------------------------------------------------------

const PLACES = [
  { id: "p1", name: "Portobello Road Market", lat: 51.5156, lng: -0.2057 },
  { id: "p2", name: "Leadenhall Market", lat: 51.5127, lng: -0.0835 },
];

test("the model is handed the places we already hold, and told null is fine", async () => {
  // Without this it named places as the STORY does — "Notting Hill Bookshop" — which
  // is right for a story and unmappable for us, and matching that afterwards would be
  // guessing.
  const { handler, calls } = handlerWith({ places: PLACES });
  await handler(trailRequest({ work_id: WORK }));

  assert.match(calls.instructions, /Portobello Road Market/);
  assert.match(calls.instructions, /Leadenhall Market/);
  assert.match(calls.instructions, /null is a normal/i);
  assert.match(calls.instructions, /Never invent a value/i);
});

test("a scene tied to a known place gets linked to it", async () => {
  const { handler, calls } = handlerWith({
    places: PLACES,
    response: modelReply({ scenes: [
      { ...parsedTrail.scenes[0], known_place: "Portobello Road Market" },
    ] }),
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(body.linked, 1);
  assert.equal(calls.linked[0].place_id, "p1");
  assert.equal(calls.linked[0].scene_id, "s0");
});

test("a place the model invented links to nothing", async () => {
  // `known_place` is only ever a KEY into our list; a value outside it finds nothing
  // and the scene simply has no place, which is a normal outcome.
  const { handler, calls } = handlerWith({
    places: PLACES,
    response: modelReply({ scenes: [
      { ...parsedTrail.scenes[0], known_place: "The Bookshop That Never Was" },
    ] }),
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(body.linked, 0);
  assert.deepEqual(calls.linked, []);
});

test("a failed link loses a pin, not the extraction", async () => {
  const { handler, calls } = handlerWith({
    places: PLACES, linkThrows: true,
    response: modelReply({ scenes: [
      { ...parsedTrail.scenes[0], known_place: "Portobello Road Market" },
    ] }),
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(body.extracted, 1);   // the scenes survived
  assert.equal(body.linked, 0);
  assert.ok(calls.saved.length > 0);
});

test("a work with no mapped places says so rather than listing nothing", async () => {
  const { handler, calls } = handlerWith({ places: [] });
  await handler(trailRequest({ work_id: WORK }));
  assert.match(calls.instructions, /known_place must be null/i);
});

test("a scene whose own name matches ours links, even with known_place null", async () => {
  // The model names places exactly as we do but leaves known_place null in almost
  // every case. This is still an exact match into our own closed list — not fuzzy
  // matching — so it recovers the link without loosening the rule.
  const { handler, calls } = handlerWith({
    places: PLACES,
    response: modelReply({ scenes: [
      { ...parsedTrail.scenes[0], place_name: "Leadenhall Market", known_place: null },
    ] }),
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();
  assert.equal(body.linked, 1);
  assert.equal(calls.linked[0].place_id, "p2");
});

test("a name outside our list still links to nothing", async () => {
  const { handler } = handlerWith({
    places: PLACES,
    response: modelReply({ scenes: [
      { ...parsedTrail.scenes[0], place_name: "Diagon Alley", known_place: null },
    ] }),
  });
  assert.equal((await (await handler(trailRequest({ work_id: WORK }))).json()).linked, 0);
});
