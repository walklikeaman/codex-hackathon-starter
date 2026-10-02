import assert from "node:assert/strict";
import test from "node:test";

import { createSnapHandler, DEFAULT_BATCH, MAX_BATCH, MAX_PAUSE_MS } from "../app/api/snap/route.js";

const PLACE = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Selfridges",
  lat: 51.514344,
  lng: -0.152704,
  geocode_precision: "street",
};

const SNAPPED = {
  snapped: true, reason: "inside_footprint", via: "centroid",
  lat: 51.5145, lng: -0.1528, geocode_precision: "building",
  osm_building_id: "way/39814415", building_name: "Selfridges",
  moved_m: 34, footprint: [{ lat: 51.5145, lng: -0.1528 }],
};

function handlerWith(overrides = {}) {
  const calls = { resolved: [], saved: [], waited: [], streets: [], streetSaved: [] };
  const handler = createSnapHandler({
    env: { ENRICH_TOKEN: "test-token", NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" },
    createStore: overrides.createStore ?? (() => ({
      unsnapped: async (limit) => { calls.limit = limit; return overrides.places ?? [PLACE]; },
      loadPlace: async (id) => ("place" in overrides ? overrides.place : { ...PLACE, id }),
      saveSnap: async (place, snap) => {
        if (overrides.saveThrows) throw new Error("db down");
        calls.saved.push({ place, snap });
      },
      saveStreet: async (place, street) => { calls.streetSaved.push({ place, street }); },
    })),
    confirmStreet: async (args) => {
      calls.streets.push(args);
      return overrides.street ?? { confirmed: false, reason: "no_such_street_here" };
    },
    resolveSnap: overrides.resolveSnap ?? (async (args) => {
      calls.resolved.push(args);
      return overrides.snap ?? SNAPPED;
    }),
    wait: async (ms) => { calls.waited.push(ms); },
    logError: () => {},
  });
  return { handler, calls };
}

const snapRequest = (body) =>
  new Request("http://localhost/api/snap", {
    method: "POST", headers: { "Content-Type": "application/json", "x-enrich-token": "test-token" }, body: JSON.stringify(body),
  });

test("a snapped place keeps the coordinate it came from", async () => {
  // The move must stay reversible and provable; overwriting lat/lng without keeping
  // the original would make the pin an unsourced claim.
  const { handler, calls } = handlerWith();
  const body = await (await handler(snapRequest({}))).json();

  assert.equal(body.snapped, 1);
  const [{ place, snap }] = calls.saved;
  assert.equal(place.lat, PLACE.lat);   // handed to the store for pre_snap_*
  assert.equal(snap.lat, SNAPPED.lat);
  assert.equal(body.results[0].was, "street");
  assert.equal(body.results[0].now, "building");
});

test("an unresolved place writes NOTHING and stays in the queue", async () => {
  // Overpass being busy is not a verdict about the place.
  const { handler, calls } = handlerWith({
    snap: { snapped: false, reason: "overpass_unavailable", lat: PLACE.lat, lng: PLACE.lng },
  });
  const body = await (await handler(snapRequest({}))).json();

  assert.equal(body.snapped, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "overpass_unavailable");
});

test("an ambiguous place is reported, not forced", async () => {
  const { handler, calls } = handlerWith({ snap: { snapped: false, reason: "ambiguous_neighbours" } });
  const body = await (await handler(snapRequest({}))).json();
  assert.equal(calls.saved.length, 0);
  assert.equal(body.results[0].reason, "ambiguous_neighbours");
});

test("Overpass is called one place at a time, with a pause between", async () => {
  // Parallel calls are what gets a client blocked, and live testing showed Overpass
  // 429s the request right after a successful one.
  const places = [PLACE, { ...PLACE, id: "b" }, { ...PLACE, id: "c" }];
  const { handler, calls } = handlerWith({ places });
  await handler(snapRequest({}));

  assert.equal(calls.resolved.length, 3);
  assert.equal(calls.waited.length, 2); // a pause between each pair, not before the first
  assert.ok(calls.waited.every((ms) => ms > 0));
});

test("being throttled slows the rest of the run down", async () => {
  // Production rate-limited 3 of 6 places at a fixed pace. A 429 is the only signal
  // Overpass gives us about our own rate, so it has to change behaviour.
  const places = [PLACE, { ...PLACE, id: "b" }, { ...PLACE, id: "c" }];
  const { handler, calls } = handlerWith({
    places,
    snap: { snapped: false, reason: "overpass_unavailable", rate_limited: true },
  });
  await handler(snapRequest({}));

  assert.equal(calls.waited.length, 2);
  assert.ok(calls.waited[1] > calls.waited[0]); // backs off rather than keeping pace
});

test("the backoff is capped so a batch cannot stall forever", async () => {
  const places = Array.from({ length: 12 }, (_, i) => ({ ...PLACE, id: `p${i}` }));
  const { handler, calls } = handlerWith({
    places,
    snap: { snapped: false, reason: "overpass_unavailable", rate_limited: true },
  });
  await handler(snapRequest({ limit: 12 }));
  assert.ok(calls.waited.every((ms) => ms <= MAX_PAUSE_MS));
  assert.equal(calls.waited.at(-1), MAX_PAUSE_MS);
});

test("an ordinary refusal does not slow the run down", async () => {
  // "This is a square, not a building" says nothing about our request rate.
  const places = [PLACE, { ...PLACE, id: "b" }, { ...PLACE, id: "c" }];
  const { handler, calls } = handlerWith({ places, snap: { snapped: false, reason: "ambiguous_neighbours" } });
  await handler(snapRequest({}));
  assert.equal(calls.waited[0], calls.waited[1]);
});

test("one failing place does not abandon the rest of the batch", async () => {
  const places = [PLACE, { ...PLACE, id: "b" }];
  let first = true;
  const { handler, calls } = handlerWith({
    places,
    resolveSnap: async () => {
      if (first) { first = false; throw new Error("network"); }
      return SNAPPED;
    },
  });
  const body = await (await handler(snapRequest({}))).json();

  assert.equal(body.checked, 2);
  assert.equal(body.snapped, 1);
  assert.equal(body.results[0].reason, "overpass_failed");
  assert.equal(calls.saved.length, 1);
});

test("a database failure is reported as a failed snap, not a successful one", async () => {
  const { handler } = handlerWith({ saveThrows: true });
  const body = await (await handler(snapRequest({}))).json();
  assert.equal(body.snapped, 0);
  assert.equal(body.results[0].reason, "save_failed");
});

test("the batch is bounded so one call cannot hammer Overpass", async () => {
  const { handler, calls } = handlerWith();
  await handler(snapRequest({ limit: 9999 }));
  assert.equal(calls.limit, MAX_BATCH);

  await handler(snapRequest({}));
  assert.equal(calls.limit, DEFAULT_BATCH);

  await handler(snapRequest({ limit: 0 }));
  assert.equal(calls.limit, DEFAULT_BATCH);
});

test("a single place can be re-snapped by id", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(snapRequest({ place_id: PLACE.id }))).json();
  assert.equal(body.checked, 1);
  assert.equal(calls.resolved.length, 1);
});

test("an unknown place id is an empty result, not a crash", async () => {
  const { handler } = handlerWith({ place: null });
  const body = await (await handler(snapRequest({ place_id: "nope" }))).json();
  assert.equal(body.checked, 0);
  assert.deepEqual(body.results, []);
});

test("the search radius cannot be widened past the module's ceiling", async () => {
  const { handler, calls } = handlerWith();
  await handler(snapRequest({ radius_m: 100000 }));
  assert.ok(calls.resolved[0].radiusM <= 150);
});

test("nothing left to snap is a clean answer", async () => {
  const { handler, calls } = handlerWith({ places: [] });
  const body = await (await handler(snapRequest({}))).json();
  assert.deepEqual(body, { snapped: 0, checked: 0, results: [] });
  assert.equal(calls.resolved.length, 0);
});

test("without the service role the route says so instead of half-working", async () => {
  const { handler } = handlerWith({ createStore: () => null });
  assert.equal((await handler(snapRequest({}))).status, 503);
});

test("a malformed body falls back to a default batch rather than failing", async () => {
  const { handler, calls } = handlerWith();
  const request = new Request("http://localhost/api/snap", {
    method: "POST", headers: { "x-enrich-token": "test-token" }, body: "not json",
  });
  assert.equal((await handler(request)).status, 200);
  assert.equal(calls.limit, DEFAULT_BATCH);
});

// --- a street, when no building confirms it ----------------------------------

const CABLE = { id: "22222222-2222-2222-2222-222222222222", name: "Cable Street, London E1", lat: 51.511, lng: -0.065, geocode_precision: "none" };
const ON_CABLE = { confirmed: true, reason: "on_named_street", geocode_precision: "street", osm_street_id: "way/4", street_name: "Cable Street", metres: 6 };

test("a vague street that no building confirms is confirmed by the street, and not moved", async () => {
  const { handler, calls } = handlerWith({ places: [CABLE], snap: { snapped: false, reason: "area_not_a_building" }, street: ON_CABLE });
  const body = await (await handler(snapRequest({}))).json();

  assert.equal(body.snapped, 1);
  assert.equal(calls.saved.length, 0, "no building snap is written");
  assert.equal(calls.streetSaved[0].street.osm_street_id, "way/4");
  assert.deepEqual(body.results[0], {
    place_id: CABLE.id, name: CABLE.name, snapped: true, reason: "on_named_street",
    osm_street_id: "way/4", street_name: "Cable Street", was: "none", now: "street",
  });
  // The street is a second Overpass call, and it is paced like the first.
  assert.equal(calls.waited.length, 1);
});

test("the street is not asked when Overpass is busy, or the name is not a street", async () => {
  for (const [place, snap] of [
    [CABLE, { snapped: false, reason: "overpass_unavailable", rate_limited: true }],
    [{ ...CABLE, name: "Drapers' Hall" }, { snapped: false, reason: "area_not_a_building" }],
    [{ ...CABLE, geocode_precision: "point" }, { snapped: false, reason: "ambiguous_neighbours" }],
  ]) {
    const { handler, calls } = handlerWith({ places: [place], snap, street: ON_CABLE });
    const body = await (await handler(snapRequest({}))).json();
    assert.equal(calls.streets.length, 0, place.name);
    assert.equal(body.snapped, 0);
  }
});

test("a street that is not confirmed writes nothing and reports the building's reason", async () => {
  const { handler, calls } = handlerWith({ places: [CABLE], snap: { snapped: false, reason: "area_not_a_building" } });
  const body = await (await handler(snapRequest({}))).json();
  assert.equal(calls.streets.length, 1);
  assert.equal(calls.streetSaved.length, 0);
  assert.equal(body.results[0].reason, "area_not_a_building");
});
