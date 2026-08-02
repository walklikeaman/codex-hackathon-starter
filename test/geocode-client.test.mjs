import test from "node:test";
import assert from "node:assert/strict";

import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { MAX_NAMES_PER_QUERY, QUERY_GAP_MS, retryPlan } from "../app/lib/geocode-wikidata.mjs";
import { USER_AGENT } from "../app/lib/wikipedia-source.mjs";

function binding(name, qid, lat, lng) {
  return {
    name: { value: name },
    place: { value: `http://www.wikidata.org/entity/${qid}` },
    placeLabel: { value: name },
    lat: { value: String(lat) },
    lng: { value: String(lng) },
  };
}

function stubFetch(bindingsPerCall) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, query: options.body.get("query") });
    const bindings = bindingsPerCall[calls.length - 1] ?? [];
    return { ok: true, json: async () => ({ results: { bindings } }) };
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

test("a name resolves to the coordinate Wikidata gave for it", async () => {
  const { fetchImpl } = stubFetch([[binding("Hashima Island", "Q285468", 32.6277, 129.7383)]]);
  const geocode = createGeocoder({ fetchImpl, sleep: noSleep });

  const resolved = await geocode(["Hashima Island"]);
  assert.equal(resolved.get("Hashima Island").place.wikidata_id, "Q285468");
  assert.equal(resolved.get("Hashima Island").place.lat, 32.6277);
});

test("every request identifies itself — WDQS blocks anonymous clients", async () => {
  const { fetchImpl, calls } = stubFetch([[]]);
  await createGeocoder({ fetchImpl, sleep: noSleep })(["Hankley Common"]);

  assert.equal(calls[0].options.headers["User-Agent"], USER_AGENT);
  assert.match(USER_AGENT, /@/); // a real contact, not a placeholder domain
});

test("the enclosing city breaks a homonym tie; nothing else may", async () => {
  // Two Cambridges. The hint comes from the request — the city the user is looking at —
  // and never from the model that produced the name.
  const rivals = [
    binding("Cambridge", "Q350", 52.2053, 0.1218),
    binding("Cambridge", "Q49111", 42.3736, -71.1097),
  ];
  const answering = () => createGeocoder({ fetchImpl: stubFetch([rivals]).fetchImpl, sleep: noSleep });

  const withHint = await answering()(["Cambridge"], { near: { lat: 51.5072, lng: -0.1276 } });
  assert.equal(withHint.get("Cambridge").place.wikidata_id, "Q350");

  const without = await answering()(["Cambridge"]);
  assert.equal(without.get("Cambridge").place, null);
  assert.equal(without.get("Cambridge").reason, "ambiguous_homonyms");
});

test("a single batch is not paced — that is what makes it usable in a request", async () => {
  // The gap belongs BETWEEN queries. Charging it for the only query would add five
  // seconds to a page that is waiting on it.
  const waits = [];
  const { fetchImpl } = stubFetch([[]]);
  await createGeocoder({ fetchImpl, sleep: async (ms) => { waits.push(ms); } })(["Hankley Common"]);

  assert.deepEqual(waits, []);
});

test("several batches are paced between queries", async () => {
  const waits = [];
  const names = Array.from({ length: MAX_NAMES_PER_QUERY + 1 }, (_, i) => `Place Number ${i}`);
  const { fetchImpl, calls } = stubFetch([[], []]);
  await createGeocoder({ fetchImpl, sleep: async (ms) => { waits.push(ms); } })(names);

  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [QUERY_GAP_MS]);
});

test("a geocoder failure leaves names unplaced rather than failing the request", async () => {
  // The discovery route calls this while a user waits. WDQS being down means fewer
  // places on the map, not a broken search.
  const geocode = createGeocoder({
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    sleep: noSleep,
  });

  const resolved = await geocode(["Hankley Common"]);
  assert.equal(resolved.size, 0);
});

test("a service that never recovers ends with the names unplaced, and says so", async () => {
  // Retrying is bounded. What matters is that the give-up is reported in terms of the
  // consequence — names without coordinates — rather than as a bare status code.
  const notes = [];
  const geocode = createGeocoder({
    fetchImpl: async () => ({ ok: false, status: 429 }),
    sleep: noSleep,
    onNote: (note) => notes.push(note),
  });

  assert.equal((await geocode(["Hankley Common"])).size, 0);
  assert.match(notes[0], /429 → waiting/);
  assert.match(notes.at(-1), /left unplaced/);
});

test("a name too generic to look up is never sent", async () => {
  const { fetchImpl, calls } = stubFetch([[]]);
  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(["various locations"]);

  assert.equal(calls.length, 0);
  assert.equal(resolved.size, 0);
});

// --- acting on what the failure means --------------------------------------------------

test("a query that was too heavy is split, not skipped", async () => {
  // The plan said "shrink_batch" and the caller skipped the batch anyway. Sixteen
  // names lost every coordinate to that gap between naming an action and taking it.
  const calls = [];
  const fetchImpl = async (url, options) => {
    const names = [...options.body.get("query").matchAll(/"([^"]+)"@en/g)].map((m) => m[1]);
    calls.push(names);
    if (names.length > 1) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ results: { bindings: [
      binding(names[0], "Q1", 1, 2)] } }) };
  };

  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(["Alpha Place", "Beta Place"]);
  assert.deepEqual(calls[0], ["Alpha Place", "Beta Place"]);
  assert.equal(resolved.get("Alpha Place").place.lat, 1);
  assert.equal(resolved.get("Beta Place").place.lat, 1);
});

test("502 is a heavy query too, not a permanent failure", async () => {
  // Seen live in one run: a batch of eight returned 504 and the next returned 502.
  assert.equal(retryPlan(502).action, "shrink_batch");
});

test("splitting stops rather than recursing forever", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; return { ok: false, status: 504 }; };
  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(
    ["Alpha Place", "Beta Place", "Gamma Place", "Delta Place"]);

  assert.equal(resolved.size, 0);
  assert.ok(attempts < 20, `gave up after ${attempts} attempts`);
});

test("a rate limit waits and asks again, rather than dropping the names", async () => {
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 429 };
    const names = [...options.body.get("query").matchAll(/"([^"]+)"@en/g)].map((m) => m[1]);
    return { ok: true, json: async () => ({ results: { bindings: [binding(names[0], "Q7", 3, 4)] } }) };
  };

  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(["Hankley Common"]);
  assert.equal(attempts, 2);
  assert.equal(resolved.get("Hankley Common").place.wikidata_id, "Q7");
});

test("waiting out a rate limit does not spend the budget for splitting", async () => {
  // Seen live: 8 names went 8 → 4 → wait → 4 → 2 and then gave up with splits still
  // available, because one counter served two unrelated purposes.
  const seen = [];
  let ratelimited = false;
  const fetchImpl = async (url, options) => {
    const names = [...options.body.get("query").matchAll(/"([^"]+)"@en/g)].map((m) => m[1]);
    seen.push(names.length);
    if (names.length === 4 && !ratelimited) { ratelimited = true; return { ok: false, status: 429 }; }
    if (names.length > 1) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ results: { bindings: [binding(names[0], "Q9", 5, 6)] } }) };
  };

  const names = Array.from({ length: 8 }, (_, i) => `Place Number ${i}`);
  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(names);

  // Every name reached a single-name query and was answered.
  assert.equal(resolved.size, 8);
  assert.ok(seen.includes(1), "never got down to one name per query");
});
