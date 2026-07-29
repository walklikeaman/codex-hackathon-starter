import assert from "node:assert/strict";
import test from "node:test";

import { ENRICH_TOKEN_HEADER, enrichGuard, presentedToken, secretsMatch } from "../app/lib/enrich-auth.mjs";
import { createSnapHandler } from "../app/api/snap/route.js";
import { createStillsEnrichHandler } from "../app/api/enrich/stills/route.js";
import { createSceneMatchHandler } from "../app/api/enrich/scene-match/route.js";
import { createTrailHandler } from "../app/api/trail/route.js";

const withToken = (token) => new Request("http://localhost/x", {
  method: "POST",
  headers: token ? { [ENRICH_TOKEN_HEADER]: token } : {},
  body: "{}",
});

// --- fail closed ----------------------------------------------------------------

test("a route with no token configured is SHUT, not open", () => {
  // The opposite default — "no secret set, so let everyone in" — is how a guard
  // silently stops guarding after an environment is rebuilt.
  const refusal = enrichGuard(withToken("anything"), {});
  assert.equal(refusal.status, 503);
});

test("an empty or blank token counts as not configured", () => {
  assert.equal(enrichGuard(withToken("x"), { ENRICH_TOKEN: "" }).status, 503);
  assert.equal(enrichGuard(withToken("x"), { ENRICH_TOKEN: "   " }).status, 503);
});

test("'not configured' and 'not you' are different answers", () => {
  // Collapsing them would hide a broken deployment behind an ordinary rejection.
  assert.equal(enrichGuard(withToken("wrong"), { ENRICH_TOKEN: "right" }).status, 401);
  assert.equal(enrichGuard(withToken("right"), {}).status, 503);
});

test("the right token passes", () => {
  assert.equal(enrichGuard(withToken("right"), { ENRICH_TOKEN: "right" }), null);
});

test("a missing header is refused, not treated as absent-therefore-fine", () => {
  assert.equal(enrichGuard(withToken(null), { ENRICH_TOKEN: "right" }).status, 401);
});

test("the refusal says nothing useful to someone guessing", async () => {
  const body = await enrichGuard(withToken("wrong"), { ENRICH_TOKEN: "right" }).json();
  assert.equal(body.error, "Not authorised.");
  assert.equal(JSON.stringify(body).includes("right"), false);
});

// --- the comparison --------------------------------------------------------------

test("comparison does not short-circuit on a matching prefix", () => {
  // A plain === leaks the length and the shared prefix through timing.
  assert.equal(secretsMatch("secret", "secret"), true);
  assert.equal(secretsMatch("secret", "secretx"), false);
  assert.equal(secretsMatch("s", "secret"), false);
  assert.equal(secretsMatch("", "secret"), false);
  assert.equal(secretsMatch("secret", ""), false);
});

test("a token longer than the buffer is still compared safely", () => {
  const long = "a".repeat(200);
  assert.equal(secretsMatch(long, long), true);
  assert.equal(secretsMatch(long, `${long}b`), false);
});

test("non-strings never match", () => {
  assert.equal(secretsMatch(null, "x"), false);
  assert.equal(secretsMatch("x", null), false);
  assert.equal(secretsMatch(undefined, undefined), false);
});

// --- how a token may arrive -------------------------------------------------------

test("a bearer header works too, because a scheduler may only send that", () => {
  const bearer = new Request("http://x", { method: "POST", headers: { authorization: "Bearer abc" } });
  assert.equal(presentedToken(bearer), "abc");

  const direct = new Request("http://x", { method: "POST", headers: { [ENRICH_TOKEN_HEADER]: " abc " } });
  assert.equal(presentedToken(direct), "abc");

  assert.equal(presentedToken(new Request("http://x", { method: "POST" })), null);
  assert.equal(presentedToken(null), null);
});

// --- the routes actually refuse, before spending anything -------------------------

const nothingShouldRun = () => {
  throw new Error("the guard let a request through");
};

test("an unauthorised request costs ZERO model calls and touches no database", async () => {
  // The whole point: the refusal happens before anything is read, parsed or paid for.
  const routes = [
    createSnapHandler({ env: {}, createStore: nothingShouldRun, resolveSnap: nothingShouldRun }),
    createStillsEnrichHandler({ env: {}, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
    createSceneMatchHandler({ env: {}, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
    createTrailHandler({ env: {}, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
  ];

  for (const route of routes) {
    const response = await route(withToken("guess"));
    assert.equal(response.status, 503, "unconfigured routes must refuse");
  }
});

test("a wrong token is refused by every write route", async () => {
  const env = { ENRICH_TOKEN: "right", OPENAI_API_KEY: "k",
    NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "s" };
  const routes = [
    createSnapHandler({ env, createStore: nothingShouldRun, resolveSnap: nothingShouldRun }),
    createStillsEnrichHandler({ env, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
    createSceneMatchHandler({ env, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
    createTrailHandler({ env, createStore: nothingShouldRun, createOpenAIClient: nothingShouldRun }),
  ];

  for (const route of routes) {
    assert.equal((await route(withToken("wrong"))).status, 401);
  }
});
