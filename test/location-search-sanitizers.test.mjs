import assert from "node:assert/strict";
import test from "node:test";

import { POST as discover } from "../app/api/locations/discover/route.js";
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
function withKey(value, run) {
  const saved = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
  return run().finally(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });
}

const post = (body) => new Request("http://localhost/api/locations/discover", {
  method: "POST", headers: { "Content-Type": "application/json" }, body,
});

test("discover without a model key is a 503, before the body is read", () => withKey(undefined, async () => {
  const response = await discover(post(JSON.stringify({ city: { name: "London" } })));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
}));

test("discover with an empty or malformed body is a 400, and no search is made", () => withKey("sk-test-not-a-real-key", async () => {
  for (const body of ["", "{", "{}", JSON.stringify({ city: { name: "London" } })]) {
    const response = await discover(post(body));
    assert.equal(response.status, 400, body);
  }
}));
