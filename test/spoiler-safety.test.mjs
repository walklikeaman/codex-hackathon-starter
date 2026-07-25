import assert from "node:assert/strict";
import test from "node:test";

import { createScenesHandler } from "../app/api/scenes/route.js";
import {
  clampProgress,
  isRevealed,
  placeholderFor,
  progressSummary,
  SAFE_PROGRESS,
  sequenceLabel,
  shapeScenes,
} from "../app/lib/spoiler-safety.mjs";

// Rows as work_scenes() returns them: SQL has already stripped the withheld fields.
const revealedRow = {
  scene_id: "s1", sequence_index: 1, act_or_chapter: "Chapter 1", spoiler_tier: 0,
  revealed: true, plot_beat: "They meet at the square", safe_teaser: "Where it begins",
  place_id: "p1", place_name: "Trafalgar Square", lat: 51.508, lng: -0.128,
};
const withheldRow = {
  scene_id: "s3", sequence_index: 3, act_or_chapter: null, spoiler_tier: 12,
  revealed: false, plot_beat: null, safe_teaser: "The ending", place_id: null,
  place_name: null, lat: null, lng: null,
};

test("spoiler-safe is the DEFAULT, not something you have to ask for", () => {
  // A caller who omits progress must get the safe view, never the whole plot.
  assert.equal(clampProgress(undefined), SAFE_PROGRESS);
  assert.equal(clampProgress(null), SAFE_PROGRESS);
  assert.equal(clampProgress(""), SAFE_PROGRESS);
  assert.equal(clampProgress("nonsense"), SAFE_PROGRESS);
  // A negative value cannot unlock anything either.
  assert.equal(clampProgress(-50), SAFE_PROGRESS);
});

test("clampProgress accepts a real chapter and caps the absurd", () => {
  assert.equal(clampProgress(7), 7);
  assert.equal(clampProgress("12"), 12);
  assert.equal(clampProgress(7.9), 7); // a chapter is whole
  assert.equal(clampProgress(1e9), 9999);
});

test("a scene is revealed only once its tier is reached", () => {
  assert.equal(isRevealed(0, 0), true);   // tier 0 carries no plot at all
  assert.equal(isRevealed(7, 5), false);
  assert.equal(isRevealed(7, 7), true);
  assert.equal(isRevealed(7, 12), true);
  // A missing tier is treated as safe rather than as "hide forever".
  assert.equal(isRevealed(null, 0), true);
});

test("a withheld scene keeps its place in the sequence and nothing else", () => {
  const placeholder = placeholderFor(withheldRow);
  assert.equal(placeholder.revealed, false);
  assert.equal(placeholder.sequence_index, 3);
  assert.equal(placeholder.label, "Scene 3");
  assert.equal(placeholder.safe_teaser, "The ending"); // written to be safe for anyone
  // The things that would spoil the story must be absent, not merely falsy.
  assert.equal("plot_beat" in placeholder, false);
  assert.equal("act_or_chapter" in placeholder, false);
  assert.equal("lat" in placeholder, false);
  assert.equal("lng" in placeholder, false);
  assert.equal("place_name" in placeholder, false);
});

test("shapeScenes never lets a withheld row through, even if SQL changed", () => {
  // Defence in depth: if a future query edit forgot to strip the fields, the shaper
  // still refuses to hand them to the client.
  const leaky = {
    ...withheldRow,
    act_or_chapter: "Chapter 12: The Death of the Detective",
    plot_beat: "He dies at the tower",
    lat: 51.5, lng: -0.12, place_name: "The tower",
  };
  const [shaped] = shapeScenes([leaky], 5);
  assert.equal(shaped.revealed, false);
  assert.equal(JSON.stringify(shaped).includes("Death"), false);
  assert.equal(JSON.stringify(shaped).includes("tower"), false);
  assert.equal(JSON.stringify(shaped).includes("51.5"), false);
});

test("where a scene happens is itself a spoiler, so coordinates are withheld", () => {
  // "The finale is at the lighthouse" gives the ending away as surely as prose.
  const [shaped] = shapeScenes([{ ...withheldRow, lat: 51.5, lng: -0.12 }], 0);
  assert.equal(shaped.lat, undefined);
  assert.equal(shaped.lng, undefined);
});

test("a reached scene comes through whole", () => {
  const [shaped] = shapeScenes([revealedRow], 0);
  assert.equal(shaped.revealed, true);
  assert.equal(shaped.plot_beat, "They meet at the square");
  assert.equal(shaped.place_name, "Trafalgar Square");
  assert.equal(shaped.lat, 51.508);
  assert.equal(shaped.label, "Chapter 1");
});

test("progressSummary says how much is ahead without saying what it is", () => {
  const scenes = shapeScenes([revealedRow, withheldRow], 0);
  assert.deepEqual(progressSummary(scenes), {
    total: 2, revealed: 1, hidden: 1, highestTier: 12,
  });
});

test("sequenceLabel degrades to a neutral label", () => {
  assert.equal(sequenceLabel(4), "Scene 4");
  assert.equal(sequenceLabel(null), "Later scene");
});

// --- route -------------------------------------------------------------------

const WORK = "11111111-1111-1111-1111-111111111111";
const sceneRequest = (query) =>
  new Request(`http://localhost/api/scenes?${new URLSearchParams(query)}`);

function handlerWith(overrides = {}) {
  return createScenesHandler({
    env: {},
    createReader: overrides.createReader ?? (() => overrides.reader ?? {
      scenes: async () => [revealedRow, withheldRow],
    }),
    logError: () => {},
  });
}

test("scenes route requires a real work id", async () => {
  assert.equal((await handlerWith()(sceneRequest({}))).status, 400);
  assert.equal((await handlerWith()(sceneRequest({ workId: "nope" }))).status, 400);
});

test("scenes route passes the clamped progress to the database", async () => {
  // The DATABASE does the hiding, so the value it receives is what matters.
  let seen = null;
  const handler = handlerWith({
    reader: { scenes: async (args) => { seen = args; return []; } },
  });
  await handler(sceneRequest({ workId: WORK, progress: "-5" }));
  assert.equal(seen.progress, SAFE_PROGRESS);

  await handler(sceneRequest({ workId: WORK, progress: "7" }));
  assert.equal(seen.progress, 7);

  await handler(sceneRequest({ workId: WORK })); // omitted entirely
  assert.equal(seen.progress, SAFE_PROGRESS);
});

test("scenes route answers with placeholders and a summary", async () => {
  const body = await (await handlerWith()(sceneRequest({ workId: WORK }))).json();
  assert.equal(body.progress, 0);
  assert.equal(body.scenes[0].revealed, true);
  assert.equal(body.scenes[1].revealed, false);
  assert.deepEqual(body.summary, { total: 2, revealed: 1, hidden: 1, highestTier: 12 });
});

test("the scenes response is never shared-cached", async () => {
  // It depends on how far THIS reader has got; a shared cache would hand one
  // reader's revealed scenes to another.
  const response = await handlerWith()(sceneRequest({ workId: WORK }));
  assert.match(response.headers.get("Cache-Control"), /private|no-store/);
});
