import assert from "node:assert/strict";
import test from "node:test";

import { createTrailHandler, PLOT_PASSES } from "../app/api/trail/route.js";

const WORK = "11111111-1111-1111-1111-111111111111";

// Sherlock Holmes (2009), cut down: the plot as Wikipedia tells it, and the places we hold
// with what the location guide says each plays.
const PLOT = {
  title: "Sherlock Holmes (2009 film)",
  url: "https://en.wikipedia.org/w/index.php?title=Sherlock_Holmes_(2009_film)&oldid=1",
  text: "Holmes visits Blackwood in his cell at Pentonville Prison before the hanging. "
    + "Days later the groundskeeper finds the Blackwood family tomb shattered from within. "
    + "Holmes and Watson cross the unfinished Tower Bridge to stop the final ritual.",
};
const PLACES = [
  { id: "p-somerset", name: "Somerset House", plays: "Appears as \"Pentonville Prison (cell)\"." },
  { id: "p-brompton", name: "Brompton Cemetery", plays: "Appears as \"Blackwood Family Vault\"." },
  { id: "p-stanley", name: "Stanley Dock", plays: "Appears as \"Bridge Construction\"." },
  { id: "p-cliveden", name: "Cliveden House", plays: "Appears as \"Grand Hotel (interior)\"." },
];

const reply = (matches) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ matches }) } }],
});

// Out of order on purpose: the order must come from the TEXT, not from the reply.
const GOOD = reply([
  { location: "Stanley Dock", plot_quote: "cross the unfinished Tower Bridge to stop the final ritual", fictional: false },
  { location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false },
  { location: "Brompton Cemetery", plot_quote: "finds the Blackwood family tomb shattered from within", fictional: true },
  // Paraphrased — not in the text, so not placed anywhere.
  { location: "Cliveden House", plot_quote: "Irene meets Holmes at a grand hotel in London", fictional: true },
]);

function handlerWith(overrides = {}) {
  const calls = { generated: 0, saved: null, linked: null };
  const replies = overrides.replies ?? [GOOD, GOOD];
  const handler = createTrailHandler({
    env: { ENRICH_TOKEN: "test-token", OPENAI_API_KEY: "k" },
    createRuntime: () => ("runtime" in overrides ? overrides.runtime : {
      provider: "openai", tier: "careful", model: "m", extraBody: {},
      client: { chat: { completions: { create: async (body) => {
        calls.input = body.messages[1].content;
        const answer = replies[Math.min(calls.generated, replies.length - 1)];
        calls.generated += 1;
        return answer;
      } } } },
    }),
    createStore: overrides.createStore ?? (() => ({
      loadWork: async () => ("work" in overrides
        ? overrides.work
        : { id: WORK, title: "Sherlock Holmes", kind: "film", year: 2009, wikidata_id: "Q206374" }),
      existingScenes: async () => overrides.existingScenes ?? [],
      workPlaces: async () => overrides.places ?? PLACES,
      plotOf: async () => ("plot" in overrides ? overrides.plot : PLOT),
      linkScenes: async (workId, links) => { calls.linked = links; return links.length; },
      saveScenes: async (workId, scenes) => {
        calls.saved = scenes;
        return scenes.map((scene, index) => ({ id: `s${index}`, sequence_index: scene.sequence_index }));
      },
    })),
    logError: () => {},
  });
  return { handler, calls };
}

const trailRequest = (body) => new Request("http://localhost/api/trail", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-enrich-token": "test-token" },
  body: JSON.stringify(body),
});

test("a work that already has a trail costs no model call", async () => {
  const { handler, calls } = handlerWith({ existingScenes: [{ id: "s1", sequence_index: 1, plot_beat: "…" }] });
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();
  assert.equal(body.cached, true);
  assert.equal(calls.generated, 0);
});

test("the order is the order of the plot text, whatever order the model answered in", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(trailRequest({ work_id: WORK }))).json();

  assert.equal(calls.generated, PLOT_PASSES);
  assert.deepEqual(calls.saved.map((scene) => scene.known_place), ["Somerset House", "Brompton Cemetery", "Stanley Dock"]);
  assert.deepEqual(calls.saved.map((scene) => scene.sequence_index), [1, 2, 3]);
  // What the guide says each place plays, not what the model calls it.
  assert.deepEqual(calls.saved.map((scene) => scene.place_name), ["Pentonville Prison (cell)", "Blackwood Family Vault", "Bridge Construction"]);
  assert.equal(body.extracted, 3);
  assert.equal(body.linked, 3);
  assert.deepEqual(calls.linked.map((link) => link.place_id), ["p-somerset", "p-brompton", "p-stanley"]);
  // Each link carries the evidence for its place in the story: the passage, and where from.
  assert.equal(calls.linked[0].quote, "Holmes visits Blackwood in his cell at Pentonville Prison");
  assert.equal(calls.linked[0].source_url, PLOT.url);
});

test("a quote that is not in the plot places nothing", async () => {
  const { handler, calls } = handlerWith();
  await handler(trailRequest({ work_id: WORK }));
  assert.equal(calls.saved.some((scene) => scene.known_place === "Cliveden House"), false);
});

test("the plot and the guide lines are what the model is shown", async () => {
  const { handler, calls } = handlerWith();
  await handler(trailRequest({ work_id: WORK }));
  assert.match(calls.input, /Pentonville Prison \(cell\)/);
  assert.match(calls.input, /PLOT TEXT \(Sherlock Holmes, 2009\)/);
  assert.match(calls.input, /tomb shattered from within/);
});

// Each pass's quotes are checked against the text, so their union cannot add a claim the
// plot does not support; it only recovers what one pass missed.
test("two passes are merged, and a pass that fails costs only its own finds", async () => {
  const onlyDock = reply([{ location: "Stanley Dock", plot_quote: "cross the unfinished Tower Bridge to stop the final ritual", fictional: false }]);
  const onlyCell = reply([{ location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false }]);
  const merged = handlerWith({ replies: [onlyDock, onlyCell] });
  await merged.handler(trailRequest({ work_id: WORK }));
  assert.deepEqual(merged.calls.saved.map((scene) => scene.known_place), ["Somerset House", "Stanley Dock"]);

  const broken = { choices: [{ finish_reason: "length", message: { content: "{" } }] };
  const half = handlerWith({ replies: [broken, onlyCell] });
  await half.handler(trailRequest({ work_id: WORK }));
  assert.deepEqual(half.calls.saved.map((scene) => scene.known_place), ["Somerset House"]);

  const none = handlerWith({ replies: [broken, broken] });
  assert.equal((await none.handler(trailRequest({ work_id: WORK }))).status, 502);
  assert.equal(none.calls.saved, null);
});

// Each of these is "not yet", never a cached empty trail: a work gains places and an
// article gains a plot.
test("nothing to order by is an honest answer, and nothing is saved", async () => {
  for (const [overrides, reason] of [
    [{ places: [] }, "no_known_places"],
    [{ plot: null }, "no_plot_to_order_by"],
    [{ replies: [reply([]), reply([])] }, "nothing_placed_in_plot"],
  ]) {
    const { handler, calls } = handlerWith(overrides);
    const body = await (await handler(trailRequest({ work_id: WORK }))).json();
    assert.equal(body.reason, reason);
    assert.equal(calls.saved, null);
  }
});

test("the request is validated before any work is done", async () => {
  const { handler, calls } = handlerWith();
  assert.equal((await handler(trailRequest({}))).status, 400);
  assert.equal((await handler(trailRequest({ work_id: "nope" }))).status, 400);
  assert.equal(calls.generated, 0);
});

test("an unknown work is a 404, not an extraction", async () => {
  const { handler, calls } = handlerWith({ work: null });
  assert.equal((await handler(trailRequest({ work_id: WORK }))).status, 404);
  assert.equal(calls.generated, 0);
});

test("without the service role the route says so instead of half-working", async () => {
  const { handler } = handlerWith({ createStore: () => null });
  assert.equal((await handler(trailRequest({ work_id: WORK }))).status, 503);
});
