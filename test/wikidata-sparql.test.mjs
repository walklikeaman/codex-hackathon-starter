import assert from "node:assert/strict";
import test from "node:test";

import {
  IDS_PER_QUERY, chunk, createSparqlClient, singleMatches, valuesClause,
} from "../app/lib/wikidata-sparql.mjs";
import { backfillQuery } from "../scripts/backfill-wikidata-ids.mjs";

const entity = (qid) => ({ value: `http://www.wikidata.org/entity/${qid}` });
const row = (imdb, qid) => ({ imdb: { value: imdb }, item: entity(qid) });

test("an id matching several items is refused, never resolved to the first", () => {
  // Measured over 400 of our IMDb ids: 393 matched and 2 of those matched two items each —
  // The X-Files and Torchwood, where the id names both a series and something beside it.
  // Taking the first would write a plausible id about a different thing, and nothing
  // downstream could ever tell.
  const { single, ambiguous } = singleMatches([
    row("tt0080455", "Q109767"),
    row("tt0106179", "Q2744"),
    row("tt0106179", "Q19675862"),
  ]);
  assert.deepEqual([...single], [["tt0080455", "Q109767"]]);
  assert.deepEqual(ambiguous, [{ id: "tt0106179", qids: ["Q2744", "Q19675862"] }]);
});

test("the same item listed twice for one id is one answer, not a conflict", () => {
  // Wikidata returns a row per matching statement, and an entity can carry the id twice.
  const { single, ambiguous } = singleMatches([row("tt1", "Q5"), row("tt1", "Q5")]);
  assert.deepEqual([...single], [["tt1", "Q5"]]);
  assert.equal(ambiguous.length, 0);
});

test("anything that is not a Q-id is not an answer", () => {
  const { single } = singleMatches([
    { imdb: { value: "tt1" }, item: { value: "http://www.wikidata.org/entity/P345" } },
    { imdb: { value: "tt2" }, item: { value: "not a uri" } },
    { imdb: { value: "tt3" } },
  ]);
  assert.equal(single.size, 0);
});

test("only real IMDb ids reach the endpoint", () => {
  // A malformed id in a VALUES clause is a syntax error that costs the whole chunk — 400
  // works, not one.
  assert.equal(valuesClause(["tt0080455", "nonsense", "", null, "tt1"]), '"tt0080455" "tt1"');
  assert.match(backfillQuery(["tt0080455"]), /VALUES \?imdb \{ "tt0080455" \}/);
  assert.match(backfillQuery(["tt0080455"]), /wdt:P345/);
  // No OFFSET: paging the whole property is what answered 502 on page two.
  assert.ok(!backfillQuery(["tt1"]).includes("OFFSET"));
});

test("ids are chunked, because one query for six thousand is the query that fails", () => {
  const ids = Array.from({ length: 950 }, (_, index) => `tt${index}`);
  assert.deepEqual(chunk(ids, 400).map((batch) => batch.length), [400, 400, 150]);
  assert.equal(IDS_PER_QUERY, 400);
});

test("a 5xx is retried and a 4xx is not", async () => {
  // A server-side refusal is worth waiting out; a malformed query will fail identically
  // however many times it is asked, and retrying it only delays the real error.
  let calls = 0;
  const flaky = createSparqlClient({
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 502 };
      return { ok: true, json: async () => ({ results: { bindings: [row("tt1", "Q5")] } }) };
    },
  });
  assert.equal((await flaky("SELECT")).length, 1);
  assert.equal(calls, 3);

  let badCalls = 0;
  const bad = createSparqlClient({
    sleep: async () => {},
    fetchImpl: async () => { badCalls += 1; return { ok: false, status: 400 }; },
  });
  await assert.rejects(() => bad("SELECT"), /http 400/);
  assert.equal(badCalls, 1, "a 4xx must not be retried");
});

test("a chunk that never answers throws rather than returning nothing", async () => {
  // Returning an empty result would read as "Wikidata knows none of these", which is a
  // different and wrong claim.
  const dead = createSparqlClient({
    sleep: async () => {},
    fetchImpl: async () => { throw new Error("socket hang up"); },
  });
  await assert.rejects(() => dead("SELECT"), /socket hang up/);
});
