import assert from "node:assert/strict";
import test from "node:test";

import { createAccessHandler } from "../app/api/access/route.js";
import { ACCESS, MAX_PLACES_PER_QUERY } from "../app/lib/place-access.mjs";

const GREYFRIARS = { id: "Q2876448", name: "Greyfriars Kirkyard", lat: 55.947, lng: -3.19272 };
const ELEPHANT_HOUSE = { id: "Q5354274", name: "The Elephant House", lat: 55.9478, lng: -3.1912 };

// Elements in the shape Overpass returns them, with the tags it actually carries for
// these two places — the café has hours, the graveyard has nothing but a name.
const ELEMENTS = [
  {
    type: "way", id: 1, center: { lat: 55.94666, lon: -3.19222 },
    tags: { name: "Greyfriars Kirkyard", historic: "cemetery" },
  },
  {
    type: "node", id: 2, lat: 55.94781, lon: -3.19123,
    tags: {
      name: "The Elephant House", amenity: "cafe",
      opening_hours: "Mo-Th 08:00-22:00; Fr 08:00-23:00",
    },
  },
];

function request(body) {
  return { json: async () => body };
}

function handlerWith(reply) {
  const calls = [];
  const handler = createAccessHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url, query: new URLSearchParams(options.body).get("data") });
      if (reply instanceof Error) throw reply;
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        text: async () => reply.body,
      };
    },
    logError: () => {},
  });
  return { handler, calls };
}

test("a place OSM has tagged comes back with its hours, and one it has not comes back unknown", async () => {
  const { handler } = handlerWith({ body: JSON.stringify({ elements: ELEMENTS }) });
  const response = await handler(request({ places: [GREYFRIARS, ELEPHANT_HOUSE] }));
  const { places } = await response.json();

  assert.equal(places[0].access, ACCESS.unknown, "the graveyard's way carries no access tag");
  assert.equal(places[1].access, ACCESS.open);
  assert.match(places[1].openingHours, /Mo-Th 08:00-22:00/);
});

test("the tags of a neighbour are never read as this place's", async () => {
  // The failure this whole path was rewritten around. One union means one result set,
  // so the café fetched for its own row is still in the list when the graveyard is
  // matched — and 87 m away it would have reported a café's opening hours as a
  // graveyard's. Measured live before the name test was made mandatory.
  const { handler } = handlerWith({
    body: JSON.stringify({ elements: [ELEMENTS[1]] }),
  });
  const response = await handler(request({ places: [GREYFRIARS] }));
  const { places } = await response.json();

  assert.equal(places[0].access, ACCESS.unknown);
  assert.equal(places[0].openingHours, undefined);
});

test("Overpass reporting failure inside HTTP 200 degrades to unknown, not to open", async () => {
  // "runtime error: … The server is probably too busy" arrives as an HTML page with a
  // 200. Parsing it as JSON throws far from the cause; treating it as an empty result
  // set would silently mark every stop unknown for a reason nobody could see.
  const { handler } = handlerWith({
    body: "<html><body>runtime error: Dispatcher_Client::request_read_and_idx::timeout. "
      + "The server is probably too busy to handle your request.</body></html>",
  });
  const response = await handler(request({ places: [ELEPHANT_HOUSE] }));
  const payload = await response.json();

  assert.equal(response.status, 200, "a busy Overpass is not the caller's error");
  assert.equal(payload.degraded, true);
  assert.equal(payload.places[0].access, ACCESS.unknown);
});

test("a network failure costs the labels and never the tour", async () => {
  const { handler } = handlerWith(new Error("connect ETIMEDOUT"));
  const payload = await (await handler(request({ places: [ELEPHANT_HOUSE] }))).json();

  assert.equal(payload.degraded, true);
  assert.equal(payload.places[0].access, ACCESS.unknown);
  assert.equal(payload.places[0].name, "The Elephant House");
});

test("the batch is bounded, because Overpass runs on donated hardware", async () => {
  const many = Array.from({ length: MAX_PLACES_PER_QUERY + 6 }, (_, index) => ({
    id: `Q${index + 1}`, name: `Place Number ${index}`, lat: 55.9 + index / 1000, lng: -3.19,
  }));
  const { handler, calls } = handlerWith({ body: JSON.stringify({ elements: [] }) });
  const payload = await (await handler(request({ places: many }))).json();

  assert.equal(calls.length, 1, "one request for the whole batch");
  assert.equal(payload.places.length, MAX_PLACES_PER_QUERY);
  assert.equal((calls[0].query.match(/around:/g) ?? []).length, MAX_PLACES_PER_QUERY);
});

test("a place without a usable coordinate is dropped rather than asked about", async () => {
  // Number("") is 0 and 0 is finite — the coercion that has put places at Null Island
  // four times in this codebase. Here it would ask Overpass about the Gulf of Guinea
  // and report its silence as this place's access.
  const { handler } = handlerWith({ body: JSON.stringify({ elements: [] }) });
  const response = await handler(request({
    places: [{ id: "Q1", name: "Nowhere", lat: "", lng: "" }],
  }));

  assert.equal(response.status, 400);
});

test("an empty request is refused before Overpass is troubled", async () => {
  const { handler, calls } = handlerWith({ body: "{}" });
  assert.equal((await handler(request({ places: [] }))).status, 400);
  assert.equal((await handler(request({}))).status, 400);
  assert.equal(calls.length, 0);
});

test("the name goes inside the query, so the answer is about this place", async () => {
  // Asking for every named feature around twelve points returned 200 elements against a
  // shared output cap and half the places got no answer at all. The nearest named thing
  // to Greyfriars is a gravestone; to Alnwick Castle, the Diana Gift Shop.
  const { handler, calls } = handlerWith({ body: JSON.stringify({ elements: [] }) });
  await handler(request({ places: [GREYFRIARS] }));

  assert.match(calls[0].query, /\["name"~"Greyfriars Kirkyard",i\]/);
  assert.match(calls[0].query, /out tags center/);
});

test("a shop inside a district does not become the district's access", async () => {
  // Seen live in the browser: a 60-minute London walk reported Notting Hill as "Free to
  // visit · Mo-We 10:00-20:00" because "Notting Hill Bookshop" is one word away from
  // "Notting Hill" under the merge rule. A district has no door, and printing a shop's
  // hours as its access is the invented promise in its quietest form.
  const { handler } = handlerWith({
    body: JSON.stringify({ elements: [{
      type: "node", id: 3, lat: 51.5090, lon: -0.1960,
      tags: { name: "Notting Hill Bookshop", shop: "books", opening_hours: "Mo-We 10:00-20:00" },
    }] }),
  });
  const { places } = await (await handler(request({
    places: [{ id: "Q1", name: "Notting Hill", lat: 51.5090, lng: -0.1960 }],
  }))).json();

  assert.equal(places[0].access, ACCESS.unknown);
});
