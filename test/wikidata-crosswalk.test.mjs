import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrosswalkSparql,
  crosswalkCandidates,
  crosswalkWikidataIds,
  parseCrosswalkResults,
  resolveWorkQids,
} from "../app/lib/connectors/wikidata-crosswalk.mjs";

// A SPARQL results payload echoing (?prop ?val) → ?item, as the live endpoint returns.
function sparqlPayload(rows) {
  return {
    results: {
      bindings: rows.map(([property, value, qid]) => ({
        prop: { value: `http://www.wikidata.org/prop/direct/${property}` },
        val: { value },
        item: { value: `http://www.wikidata.org/entity/${qid}` },
      })),
    },
  };
}

test("crosswalkCandidates routes each kind to its verified property", () => {
  const candidates = crosswalkCandidates([
    { id: "w1", kind: "film", tmdb_id: "509", imdb_id: "tt0125439" },
    { id: "w2", kind: "series", tmdb_id: "1399" },
    { id: "w3", kind: "book", isbn: "978-85-94066-06-0" },
    { id: "w4", kind: "book", isbn: "0306406152" },
    { id: "w5", kind: "album", mbid: "c2ffb934-6bfe-47ae-90a6-e5af87b1cedc" },
    { id: "w6", kind: "track", mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" },
  ]);
  assert.deepEqual(candidates, [
    { workKey: "w1", idType: "tmdb", property: "P4947", value: "509" },
    { workKey: "w1", idType: "imdb", property: "P345", value: "tt0125439" },
    { workKey: "w2", idType: "tmdb", property: "P4983", value: "1399" },
    { workKey: "w3", idType: "isbn", property: "P212", value: "978-85-94066-06-0" },
    { workKey: "w4", idType: "isbn", property: "P957", value: "0306406152" },
    { workKey: "w5", idType: "mbid", property: "P436", value: "c2ffb934-6bfe-47ae-90a6-e5af87b1cedc" },
    { workKey: "w6", idType: "mbid", property: "P4404", value: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" },
  ]);
});

test("crosswalkCandidates drops malformed, non-title, and absent ids", () => {
  const candidates = crosswalkCandidates([
    { id: "bad-tmdb", kind: "film", tmdb_id: "509; DROP" },
    { id: "person-imdb", kind: "film", imdb_id: "nm0000151" }, // person, not a title
    { id: "bad-mbid", kind: "album", mbid: "not-a-uuid" },
    { id: "empty", kind: "film" },
    { id: "unknown-kind", kind: "podcast", tmdb_id: "5" },
  ]);
  assert.deepEqual(candidates, []);
});

test("crosswalkCandidates rejects an injection attempt at the quote boundary", () => {
  // Even if a value slipped past a format check, the safety gate refuses quotes.
  const candidates = crosswalkCandidates([
    { id: "x", kind: "book", isbn: '9780306406152" } UNION { ?item wdt:P31 ?x' },
  ]);
  assert.deepEqual(candidates, []);
});

test("crosswalkCandidates uses the id-fallback key when a work has no explicit id", () => {
  assert.deepEqual(crosswalkCandidates([{ kind: "film", tmdb_id: "509" }]), [
    { workKey: "tmdb:509", idType: "tmdb", property: "P4947", value: "509" },
  ]);
  assert.deepEqual(crosswalkCandidates([{ kind: "series", imdb_id: "tt0903747" }]), [
    { workKey: "imdb:tt0903747", idType: "imdb", property: "P345", value: "tt0903747" },
  ]);
  assert.deepEqual(crosswalkCandidates([{ kind: "album", mbid: "c2ffb934-6bfe-47ae-90a6-e5af87b1cedc" }]), [
    { workKey: "mbid:c2ffb934-6bfe-47ae-90a6-e5af87b1cedc", idType: "mbid", property: "P436", value: "c2ffb934-6bfe-47ae-90a6-e5af87b1cedc" },
  ]);
  // No id at all → no key → no candidates (terminal null branch of workKeyOf).
  assert.deepEqual(crosswalkCandidates([{ kind: "series" }]), []);
});

test("crosswalkCandidates accepts an ISBN-10 with a trailing X check digit", () => {
  assert.deepEqual(crosswalkCandidates([{ id: "w7", kind: "book", isbn: "097522980X" }]), [
    { workKey: "w7", idType: "isbn", property: "P957", value: "097522980X" },
  ]);
});

test("buildCrosswalkSparql emits one VALUES row per candidate with the wdt property", () => {
  const sparql = buildCrosswalkSparql([
    { workKey: "w1", idType: "tmdb", property: "P4947", value: "509" },
    { workKey: "w1", idType: "imdb", property: "P345", value: "tt0125439" },
  ]);
  assert.match(sparql, /VALUES \(\?prop \?val\)/);
  assert.match(sparql, /\(wdt:P4947 "509"\)/);
  assert.match(sparql, /\(wdt:P345 "tt0125439"\)/);
  assert.match(sparql, /\?item \?prop \?val \./);
});

test("buildCrosswalkSparql throws on an empty batch and a non-allow-listed property", () => {
  assert.throws(() => buildCrosswalkSparql([]), /at least one candidate/);
  assert.throws(
    () => buildCrosswalkSparql([{ property: "P31", value: "5" }]),
    /not allow-listed/,
  );
});

test("buildCrosswalkSparql throws on a value that isn't a safe literal", () => {
  assert.throws(
    () => buildCrosswalkSparql([{ property: "P4947", value: '5" }' }]),
    /not a safe SPARQL literal/,
  );
});

test("buildCrosswalkSparql rejects backslash and control-char values (defense in depth)", () => {
  // A backslash could escape the closing quote; a newline could break the literal.
  // These are the injection vectors that carry no literal double-quote.
  assert.throws(
    () => buildCrosswalkSparql([{ property: "P4947", value: "509\\" }]),
    /not a safe SPARQL literal/,
  );
  assert.throws(
    () => buildCrosswalkSparql([{ property: "P4947", value: "509\n" }]),
    /not a safe SPARQL literal/,
  );
});

test("buildCrosswalkSparql caps the batch at 400 rows and passes at the boundary", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    workKey: `w${i}`, idType: "tmdb", property: "P4947", value: String(i + 1),
  }));
  assert.doesNotThrow(() => buildCrosswalkSparql(mk(400))); // boundary passes
  assert.throws(() => buildCrosswalkSparql(mk(401)), /exceeds 400 rows/);
});

test("parseCrosswalkResults extracts P-id, value, and bare QID; drops non-QIDs", () => {
  const parsed = parseCrosswalkResults(sparqlPayload([
    ["P4947", "509", "Q200672"],
    ["P345", "tt0125439", "Q200672"],
  ]));
  assert.deepEqual(parsed, [
    { property: "P4947", value: "509", wikidataId: "Q200672" },
    { property: "P345", value: "tt0125439", wikidataId: "Q200672" },
  ]);
  assert.deepEqual(parseCrosswalkResults({}), []);
  assert.deepEqual(
    parseCrosswalkResults(sparqlPayload([["P4947", "509", "P123"]])),
    [],
  );
});

test("resolveWorkQids joins hits back to their work and flags disagreement", () => {
  const candidates = [
    { workKey: "w1", property: "P4947", value: "509" },
    { workKey: "w1", property: "P345", value: "tt0125439" },
    { workKey: "w2", property: "P4947", value: "603" },
    { workKey: "w3", property: "P4947", value: "999999" }, // resolves to nothing
  ];
  const resolved = resolveWorkQids(candidates, [
    { property: "P4947", value: "509", wikidataId: "Q200672" },
    { property: "P345", value: "tt0125439", wikidataId: "Q200672" }, // agrees → no conflict
    { property: "P4947", value: "603", wikidataId: "Q83495" },
  ]);
  assert.equal(resolved.size, 2);
  assert.deepEqual(resolved.get("w1"), { wikidataId: "Q200672", conflict: false });
  assert.deepEqual(resolved.get("w2"), { wikidataId: "Q83495", conflict: false });
  assert.equal(resolved.has("w3"), false);
});

test("resolveWorkQids marks a conflict when a work's ids disagree", () => {
  const resolved = resolveWorkQids(
    [
      { workKey: "w1", property: "P4947", value: "509" },
      { workKey: "w1", property: "P345", value: "tt0125439" },
    ],
    [
      { property: "P4947", value: "509", wikidataId: "Q200672" },
      { property: "P345", value: "tt0125439", wikidataId: "Q999999" },
    ],
  );
  assert.equal(resolved.get("w1").conflict, true);
  assert.equal(resolved.get("w1").wikidataId, "Q200672"); // deterministic: smallest QID
});

test("resolveWorkQids flags a single id matching multiple entities, deterministically", () => {
  // One ISBN routinely appears on several edition items → several QIDs for one pair.
  const candidates = [{ workKey: "b1", property: "P212", value: "978-0-306-40615-2" }];
  const parsed = [
    { property: "P212", value: "978-0-306-40615-2", wikidataId: "Q900" },
    { property: "P212", value: "978-0-306-40615-2", wikidataId: "Q100" },
  ];
  // Same result regardless of binding order — smallest QID, conflict flagged.
  for (const order of [parsed, [...parsed].reverse()]) {
    const resolved = resolveWorkQids(candidates, order);
    assert.deepEqual(resolved.get("b1"), { wikidataId: "Q100", conflict: true });
  }
});

test("crosswalkWikidataIds throws after exhausting retries on repeated 503", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("busy", { status: 503 }); };
  await assert.rejects(
    crosswalkWikidataIds([{ id: "w1", kind: "film", tmdb_id: "509" }], { fetchImpl }),
    /responded with 503/,
  );
  assert.equal(calls, 2); // one retry, then give up — never silently returns an empty Map
});

test("crosswalkWikidataIds throws immediately on a non-retryable status without retrying", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("err", { status: 500 }); };
  await assert.rejects(
    crosswalkWikidataIds([{ id: "w1", kind: "film", tmdb_id: "509" }], { fetchImpl }),
    /responded with 500/,
  );
  assert.equal(calls, 1); // 500 is not retryable — pins the 429/503-only guard
});

test("crosswalkWikidataIds posts one batched query and returns resolved QIDs", async () => {
  let captured = null;
  const fetchImpl = async (endpoint, init) => {
    captured = { endpoint, init };
    return new Response(
      JSON.stringify(sparqlPayload([["P4947", "509", "Q200672"]])),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const resolved = await crosswalkWikidataIds(
    [{ id: "w1", kind: "film", tmdb_id: "509" }],
    { fetchImpl },
  );
  assert.deepEqual(resolved.get("w1"), { wikidataId: "Q200672", conflict: false });
  assert.equal(captured.init.method, "POST");
  assert.match(captured.init.headers["User-Agent"], /GloryMap/);
  assert.equal(captured.endpoint, "https://query.wikidata.org/sparql");
});

test("crosswalkWikidataIds short-circuits with no network when nothing is resolvable", async () => {
  let called = false;
  const resolved = await crosswalkWikidataIds(
    [{ id: "w1", kind: "film" }],
    { fetchImpl: async () => { called = true; return new Response("{}"); } },
  );
  assert.equal(resolved.size, 0);
  assert.equal(called, false);
});

test("crosswalkWikidataIds retries once on 503 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 503 });
    return new Response(
      JSON.stringify(sparqlPayload([["P4947", "509", "Q200672"]])),
      { status: 200 },
    );
  };
  const resolved = await crosswalkWikidataIds(
    [{ id: "w1", kind: "film", tmdb_id: "509" }],
    { fetchImpl },
  );
  assert.equal(calls, 2);
  assert.equal(resolved.get("w1").wikidataId, "Q200672");
});
