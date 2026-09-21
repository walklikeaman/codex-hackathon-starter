import assert from "node:assert/strict";
import test from "node:test";

import {
  payloadFromVerdict, sceneInputsHash, verdictIsCurrent, verdictRow,
} from "../app/lib/scene-verdicts.mjs";

const INPUTS = {
  tmdbId: "185",
  sceneContext: {
    filmTitle: "A Clockwork Orange",
    place: "HM Prison Wandsworth",
    locationImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg?width=800",
  },
  candidatePaths: ["/a.jpg", "/b.jpg"],
  studio: false,
};

test("the same inputs give the same fingerprint", () => {
  assert.equal(sceneInputsHash(INPUTS), sceneInputsHash({ ...INPUTS }));
  assert.match(sceneInputsHash(INPUTS), /^[0-9a-f]{64}$/);
});

// Each of these is a way the world can change under a remembered "no". Every one must
// make the "no" stale, or it would outlive the thing it was about.
test("anything the model is shown, changed, is a different question", () => {
  const base = sceneInputsHash(INPUTS);
  const changes = {
    "TMDB added a backdrop": { ...INPUTS, candidatePaths: [...INPUTS.candidatePaths, "/c.jpg"] },
    "TMDB reordered them": { ...INPUTS, candidatePaths: ["/b.jpg", "/a.jpg"] },
    "the place got a photo": { ...INPUTS, sceneContext: { ...INPUTS.sceneContext, locationImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/New.jpg?width=800" } },
    "the place was relabelled": { ...INPUTS, sceneContext: { ...INPUTS.sceneContext, place: "Wandsworth Prison" } },
    "it became a studio": { ...INPUTS, studio: true },
    "a different film": { ...INPUTS, tmdbId: "186" },
  };
  for (const [why, inputs] of Object.entries(changes)) {
    assert.notEqual(sceneInputsHash(inputs), base, why);
  }
});

test("a verdict answers again only for the same matcher and the same inputs", () => {
  const hash = sceneInputsHash(INPUTS);
  const row = { reason: "no_high_confidence_match", matcher_version: "4", inputs_hash: hash };
  assert.equal(verdictIsCurrent(row, { matcherVersion: "4", inputsHash: hash }), true);
  assert.equal(verdictIsCurrent(row, { matcherVersion: "5", inputsHash: hash }), false);
  assert.equal(verdictIsCurrent(row, { matcherVersion: "4", inputsHash: "0".repeat(64) }), false);
  assert.equal(verdictIsCurrent({ ...row, reason: "no_candidates" }, { matcherVersion: "4", inputsHash: hash }), false);
  assert.equal(verdictIsCurrent(null, { matcherVersion: "4", inputsHash: hash }), false);
});

test("a verdict row refuses ids and fingerprints that are not what they claim", () => {
  const good = { workId: "Q181086", locationId: "Q386707", matcherVersion: "4", inputsHash: sceneInputsHash(INPUTS), matchConfidence: "low", candidates: 2 };
  const row = verdictRow(good);
  assert.equal(row.reason, "no_high_confidence_match");
  assert.equal(row.candidates, 2);
  assert.ok(Date.parse(row.judged_at));
  assert.equal(verdictRow({ ...good, workId: "Q1|Q2" }), null);
  assert.equal(verdictRow({ ...good, inputsHash: "abc" }), null);
  assert.equal(verdictRow({ ...good, candidates: -1 }).candidates, 0);
});

test("a remembered no reads back as the payload a fresh no returns", () => {
  const payload = payloadFromVerdict({ reason: "no_high_confidence_match", match_confidence: "low" }, { sourceUrl: "https://x" });
  assert.deepEqual(payload, {
    image_url: null, source_url: "https://x", frames: [], match_confidence: "low",
    reason: "no_high_confidence_match", stored: true,
  });
});
