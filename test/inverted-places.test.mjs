import assert from "node:assert/strict";
import test from "node:test";

import {
  findInvertedPlaces,
  isAlreadyKnown,
  SAME_PLACE_RADIUS_M,
  toLocationRecords,
} from "../app/lib/inverted-places.mjs";

const EDINBURGH = { lat: 55.9533, lng: -3.1883 };
const WORK = { id: "Q8337", title: "Harry Potter", year: 1997 };

// The two live payload shapes, copied from real responses.
const fanoutPayload = (rows) => ({ results: { bindings: rows } });
const character = (name) => ({
  nameLabel: { value: name },
  article: { value: name },
  human: { value: "false" },
  p: { value: "http://www.wikidata.org/prop/direct/P674" },
});

const searchPayload = (pages) => ({ query: { pages } });
const page = (pageid, title, lat, lon) => ({
  pageid, title, coordinates: [{ lat, lon }],
});

function stubFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(String(url));
      const reply = responses.shift();
      if (reply instanceof Error) throw reply;
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        json: async () => reply.body,
      };
    },
  };
}

test("a place found by reading its own article never claims to be a filming location", async () => {
  // The whole risk of this path. A P915 statement says "shot here"; an inverted hit
  // says only that the place's article mentions the work — Thomas Riddell's grave is
  // neither a filming location nor where the story is set. Presenting the two alike
  // would be the map asserting something nobody wrote down.
  const { fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: searchPayload([page(1, "Greyfriars Kirkyard", 55.9469, -3.1925)]) },
  ]);

  const [record] = await findInvertedPlaces({
    work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl,
  });

  assert.equal(record.relation_kind, "candidate");
  assert.equal(record.relation_label, "Possible connection");
  assert.equal(record.evidence_source, "wikipedia_mention");
  assert.match(record.relation_description, /unverified/i);
  assert.doesNotMatch(record.relation_description, /filming location/i);
});

test("a candidate carries no Wikidata id, and still gets a distinct one", async () => {
  // It came from a Wikipedia page. Writing a fake q-id would poison the field the rest
  // of the app treats as canonical — and leaving the id empty gave every candidate the
  // same key, which collapses them into one pin on the map.
  const { fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: searchPayload([
      page(1, "Greyfriars Kirkyard", 55.9469, -3.1925),
      page(2, "Marchmont", 55.9365, -3.1944),
    ]) },
  ]);

  const records = await findInvertedPlaces({
    work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl,
  });

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.loc_wikidata_id), [null, null]);
  assert.equal(new Set(records.map((record) => record.loc_source_id)).size, 2);
  assert.match(records[0].source_url, /en\.wikipedia\.org/);
});

test("a place already found by the statement search is not shown twice", async () => {
  // Both paths reach Greyfriars, and the coordinates differ: Wikidata's item and
  // Wikipedia's article are 48 m apart for the same graveyard. Two pins for one place,
  // one labelled verified and one not, is the map contradicting itself.
  const { fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: searchPayload([page(1, "Greyfriars Kirkyard", 55.94666, -3.19222)]) },
  ]);

  const records = await findInvertedPlaces({
    work: WORK,
    center: EDINBURGH,
    radiusKm: 15,
    exclude: [{ loc_name: "Greyfriars Kirkyard", lat: 55.947, lng: -3.19272 }],
    fetchImpl,
  });

  assert.deepEqual(records, []);
});

test("same name far apart, or the same spot under another name, both survive", () => {
  // The name test does the work; the radius only stops two same-named places in one
  // city from merging. Loosening either half would start deleting real places.
  const candidate = { title: "St Mary's Church", lat: 54.4886, lng: -0.6079 };
  assert.equal(isAlreadyKnown(candidate, [
    { loc_name: "St Mary's Church", lat: 54.5, lng: -0.7 },
  ]), false);
  assert.equal(isAlreadyKnown(candidate, [
    { loc_name: "Whitby Abbey", lat: 54.4886, lng: -0.6079 },
  ]), false);
  assert.equal(isAlreadyKnown(candidate, [
    { loc_name: "St Marys Church", lat: 54.4886, lng: -0.6079 },
  ]), true);
  assert.ok(SAME_PLACE_RADIUS_M > 48, "the two sources' points for one place are 48 m apart");
});

test("an error in a 200 body is a failure, not an empty result set", async () => {
  // Wikimedia answers a missing page and a lagged replica with HTTP 200 and an error
  // object. Reading the body as a result reports "no candidates" for a search that
  // never ran, which is the shape of wrong that hides for weeks.
  const failures = [];
  const { fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: { error: { code: "maxlag", info: "Waiting for a replica" } } },
  ]);

  const records = await findInvertedPlaces({
    work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl,
    onError: (error) => failures.push(error.message),
  });

  assert.deepEqual(records, []);
  assert.deepEqual(failures, ["maxlag: Waiting for a replica"]);
});

test("a failed search costs the candidates and never the map", async () => {
  // This runs alongside a search that has already succeeded. A Wikimedia hiccup must
  // not turn a working title search into an error page.
  const { fetchImpl } = stubFetch([new Error("network down")]);
  assert.deepEqual(
    await findInvertedPlaces({ work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl }),
    [],
  );
});

test("no work, or a work with no searchable name, asks nothing", async () => {
  const { calls, fetchImpl } = stubFetch([{ body: fanoutPayload([]) }]);
  assert.deepEqual(await findInvertedPlaces({ work: null, fetchImpl }), []);
  assert.equal(calls.length, 0);

  // A one-word title with an empty fan-out has nothing near-unique to search for, and
  // asking anyway would return every article in the city containing that word.
  const short = stubFetch([{ body: fanoutPayload([]) }]);
  assert.deepEqual(
    await findInvertedPlaces({
      work: { id: "Q1", title: "Up" }, center: EDINBURGH, radiusKm: 15,
      fetchImpl: short.fetchImpl,
    }),
    [],
  );
  assert.equal(short.calls.length, 1, "the fan-out is asked; the search is not");
});

test("the work's own title leads the search, before its characters", async () => {
  const { calls, fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: searchPayload([]) },
  ]);

  await findInvertedPlaces({ work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl });
  // URLSearchParams writes a space as `+`, which is what CirrusSearch receives.
  const search = decodeURIComponent(calls[1]).replace(/\+/g, " ");
  assert.match(search, /insource:\/Harry Potter\|Lord Voldemort\//);
  assert.match(search, /nearcoord:15km/);
});

test("records keep the work they belong to, so the map can group them", () => {
  const [record] = toLocationRecords(
    [{ pageid: 7, title: "The Elephant House", lat: 55.9478, lng: -3.1912 }],
    { work: WORK, kind: "book" },
  );

  assert.equal(record.work_wikidata_id, "Q8337");
  assert.equal(record.work_title, "Harry Potter");
  assert.equal(record.kind, "book");
  assert.equal(record.lat, 55.9478);
});

test("a candidate carries what Wikipedia says it is, so it can be graded", async () => {
  // A Wikipedia page has no P31. Without the short description every candidate is
  // ungraded — and Edinburgh, a city of half a million, arrived on the live map as a
  // dot somebody could stand on.
  const { calls, fetchImpl } = stubFetch([
    { body: fanoutPayload([character("Lord Voldemort")]) },
    { body: { query: { pages: [
      { pageid: 9602, title: "Edinburgh", coordinates: [{ lat: 55.953, lon: -3.189 }],
        terms: { description: ["capital city of Scotland, UK"] } },
      { pageid: 1, title: "Greyfriars Kirkyard", coordinates: [{ lat: 55.9469, lon: -3.1925 }] },
    ] } } },
  ]);

  const records = await findInvertedPlaces({
    work: WORK, center: EDINBURGH, radiusKm: 15, fetchImpl,
  });

  assert.deepEqual(records[0].place_types, ["capital city of Scotland, UK"]);
  assert.deepEqual(records[1].place_types, [], "a page with no description is ungraded, not mis-graded");
  assert.match(decodeURIComponent(calls[1]), /pageterms/);
});
