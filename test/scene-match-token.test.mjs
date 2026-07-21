import assert from "node:assert/strict";
import test from "node:test";

import {
  addSceneMatchTokens,
  sceneMatchSigningSecret,
  signSceneMatchRequest,
  verifySceneMatchToken,
} from "../app/lib/scene-match-token.mjs";

const request = {
  tmdbId: "185",
  workId: "Q181086",
  locationId: "Q386707",
};

test("signs and verifies one canonical film-location capability", () => {
  const token = signSceneMatchRequest(request, "test-secret");

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verifySceneMatchToken(request, token, "test-secret"), true);
  assert.equal(verifySceneMatchToken({ ...request, locationId: "Q1" }, token, "test-secret"), false);
  const tampered = `${token.slice(0, -1)}${token.endsWith("x") ? "y" : "x"}`;
  assert.equal(verifySceneMatchToken(request, tampered, "test-secret"), false);
});

test("rejects signing malformed ids or an empty secret", () => {
  assert.equal(signSceneMatchRequest({ ...request, workId: "invalid" }, "test-secret"), null);
  assert.equal(signSceneMatchRequest(request, ""), null);
  assert.equal(verifySceneMatchToken(request, "invalid", "test-secret"), false);
});

test("uses an explicit signing secret before the OpenAI key", () => {
  assert.equal(sceneMatchSigningSecret({
    SCENE_MATCH_SIGNING_SECRET: "dedicated-secret",
    OPENAI_API_KEY: "openai-key",
  }), "dedicated-secret");
  assert.equal(sceneMatchSigningSecret({ OPENAI_API_KEY: "openai-key" }), "openai-key");
});

test("adds capabilities only to canonical film records returned by the server", () => {
  const film = {
    kind: "film",
    film_tmdb_id: "185",
    work_wikidata_id: "Q181086",
    loc_wikidata_id: "Q386707",
  };
  const series = { ...film, kind: "series" };
  const [signedFilm, unsignedSeries] = addSceneMatchTokens(
    [film, series],
    { OPENAI_API_KEY: "openai-key" },
  );

  assert.equal(
    verifySceneMatchToken(request, signedFilm.scene_match_token, "openai-key"),
    true,
  );
  assert.equal(unsignedSeries.scene_match_token, undefined);
});
