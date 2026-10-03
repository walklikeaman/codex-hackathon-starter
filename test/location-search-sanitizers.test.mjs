import assert from "node:assert/strict";
import test from "node:test";

import { createDiscoverHandler } from "../app/api/locations/discover/route.js";
import { isWikidataId, numberInRange } from "../app/lib/location-search.mjs";

// These two stand between request input and a SPARQL query string (#84): every id that
// reaches a query is checked by isWikidataId, and every number by numberInRange.

test("only a Q-id is a Wikidata id — anything that could carry SPARQL is not", () => {
  assert.equal(isWikidataId("Q42"), true);
  assert.equal(isWikidataId("Q193375"), true);
  for (const value of ["", "Q", "42", "q42", "Q42 ", " Q42", "Q42}", "Q42> ?x", "wd:Q42", "Q42\nUNION", null, undefined]) {
    assert.equal(isWikidataId(value), false, JSON.stringify(value));
  }
});

test("a missing number takes the fallback; a bad one is null, never coerced into range", () => {
  const range = { min: 1, max: 50 };
  assert.equal(numberInRange(undefined, 10, range), 10);
  assert.equal(numberInRange(null, 10, range), 10);
  assert.equal(numberInRange("", 10, range), 10);
  assert.equal(numberInRange("25", 10, range), 25);
  assert.equal(numberInRange(1, 10, range), 1);
  assert.equal(numberInRange(50, 10, range), 50);
  for (const value of ["abc", "NaN", Number.NaN, "Infinity", 0, 51, -3, "1e9", "5; DROP"]) {
    assert.equal(numberInRange(value, 10, range), null, String(value));
  }
});

// The discover route pays for a web search; both refusals must happen before it does.
const nothingShouldRun = () => { throw new Error("no client may be made"); };
const post = (body) => new Request("http://localhost/api/locations/discover", {
  method: "POST", headers: { "Content-Type": "application/json" }, body,
});

test("discover without a model key is a 503, before the body is read", async () => {
  const discover = createDiscoverHandler({ env: {}, createOpenAIClient: nothingShouldRun });
  const response = await discover(post(JSON.stringify({ city: { name: "London" } })));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AI location research is not configured." });
});

test("discover with an empty or malformed body is a 400, and no search is made", async () => {
  const discover = createDiscoverHandler({ env: { OPENAI_API_KEY: "sk-test" }, createOpenAIClient: nothingShouldRun });
  for (const body of ["", "{", "{}", JSON.stringify({ city: { name: "London" } })]) {
    const response = await discover(post(body));
    assert.equal(response.status, 400, body);
  }
});

test("a failed search is a 502 the reader can act on, logged without the provider's message", async () => {
  const logged = [];
  const discover = createDiscoverHandler({
    env: { OPENAI_API_KEY: "sk-test" },
    createOpenAIClient: () => ({ responses: { parse: async () => { throw Object.assign(new Error("org-secret quota"), { name: "RateLimitError", status: 429 }); } } }),
    logError: (...args) => logged.push(args),
  });
  const body = {
    city: { id: "Q84", name: "London", lat: 51.5, lng: -0.12, radiusKm: 20 },
    work: { id: "Q1", title: "Skyfall", kind: "film" },
    existingLocations: [],
  };
  const response = await discover(post(JSON.stringify(body)));
  if (response.status === 400) return assert.fail(`the fixture no longer passes the request schema: ${JSON.stringify(await response.json())}`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Could not research more locations. Try again." });
  assert.deepEqual(logged, [["AI location research failed", { name: "RateLimitError", status: 429 }]]);
});
