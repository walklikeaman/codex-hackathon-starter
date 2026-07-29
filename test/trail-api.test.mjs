import assert from "node:assert/strict";
import test from "node:test";

import { createTrailHandler } from "../app/api/trail/route.js";

const WORK = "11111111-1111-1111-1111-111111111111";

const parsedTrail = {
  scenes: [
    {
      sequence_index: 1, place_name: "Trafalgar Square", geo_hint: "London",
      plot_beat: "They meet under the column.", safe_teaser: "Where it begins",
      spoiler_tier: 1, is_fictional_setting: false,
    },
    {
      sequence_index: 2, place_name: "Hogwarts", geo_hint: "",
      plot_beat: "The letter arrives.", safe_teaser: "A journey starts",
      spoiler_tier: 3, is_fictional_setting: true,
    },
  ],
};

function handlerWith(overrides = {}) {
  const calls = { generated: 0, saved: null };
  const handler = createTrailHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k", ...overrides.env },
    createOpenAIClient: () => ({
      responses: {
        parse: async () => {
          calls.generated += 1;
          return overrides.response ?? { status: "completed", output_parsed: parsedTrail };
        },
      },
    }),
    createStore: overrides.createStore ?? (() => ({
      // `??` cannot tell "not supplied" from "deliberately null", which is exactly
      // what the 404 case needs to express.
      loadWork: async () => ("work" in overrides
        ? overrides.work
        : { id: WORK, title: "Notting Hill", kind: "film", year: 1999 }),
      existingScenes: async () => overrides.existingScenes ?? [],
      saveScenes: async (workId, scenes) => { calls.saved = scenes; return scenes.length; },
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
    response: { status: "completed", output_parsed: { scenes: [] } },
  });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.deepEqual(body.scenes, []);
  assert.equal(body.reason, "no_extractable_trail");
  assert.equal(calls.saved, null); // nothing written
});

test("a refused or truncated response fails loudly rather than saving junk", async () => {
  const { handler, calls } = handlerWith({
    response: { status: "incomplete", output_parsed: null },
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
