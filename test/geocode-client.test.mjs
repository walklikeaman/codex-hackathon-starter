import test from "node:test";
import assert from "node:assert/strict";

import { createGeocoder } from "../app/lib/geocode-client.mjs";
import { MAX_NAMES_PER_QUERY, QUERY_GAP_MS } from "../app/lib/geocode-wikidata.mjs";
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

test("an HTTP error is handled by what it means, not by retrying blindly", async () => {
  const notes = [];
  const geocode = createGeocoder({
    fetchImpl: async () => ({ ok: false, status: 429 }),
    sleep: noSleep,
    onNote: (note) => notes.push(note),
  });

  assert.equal((await geocode(["Hankley Common"])).size, 0);
  assert.match(notes[0], /429 → back_off/);
});

test("a name too generic to look up is never sent", async () => {
  const { fetchImpl, calls } = stubFetch([[]]);
  const resolved = await createGeocoder({ fetchImpl, sleep: noSleep })(["various locations"]);

  assert.equal(calls.length, 0);
  assert.equal(resolved.size, 0);
});
