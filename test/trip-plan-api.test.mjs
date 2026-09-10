import assert from "node:assert/strict";
import test from "node:test";

import { createTripPlanHandler, parseTripBody } from "../app/api/trip/plan/route.js";

const HOLLYWOOD_BBOX = { west: -118.36, south: 34.085, east: -118.30, north: 34.115 };

// The rows in the shape `map_candidate_points_in_view` returns them.
const CANDIDATES = [
  { submission_id: "s1", work_id: "w1", work_title: "Forrest Gump", name: "Grauman's Chinese Theatre",
    lat: 34.10204, lng: -118.34093, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/1", area_hint: "6925 Hollywood Boulevard" },
  { submission_id: "s2", work_id: "w2", work_title: "Hacks", name: "Madame Tussauds Hollywood",
    lat: 34.10178, lng: -118.34145, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/2", area_hint: "6933 Hollywood Blvd" },
  { submission_id: "s3", work_id: "w3", work_title: "The Muppets", name: "El Capitan Theatre",
    lat: 34.10132, lng: -118.33993, status: "pending", source_kind: "moviemaps",
    source_url: "https://moviemaps.org/3", area_hint: "6838 Hollywood Blvd" },
];

const OSRM_OK = {
  code: "Ok",
  routes: [{
    distance: 420, duration: 380,
    geometry: { type: "LineString", coordinates: [[-118.34093, 34.10204], [-118.33993, 34.10132]] },
  }],
};

function request(body) {
  return { json: async () => body, url: "https://glorymap.test/api/trip/plan" };
}

function handlerWith({ candidates = CANDIDATES, places = [], router = OSRM_OK, readerError = null } = {}) {
  const calls = { rpc: [], router: [] };
  const handler = createTripPlanHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
    createReader: () => ({
      points: async (params) => { calls.rpc.push(["points", params]); if (readerError) throw readerError; return places; },
      candidatePoints: async (params) => { calls.rpc.push(["candidates", params]); if (readerError) throw readerError; return candidates; },
    }),
    fetchImpl: async (url) => {
      calls.router.push(String(url));
      if (router instanceof Error) throw router;
      return { ok: true, status: 200, json: async () => router };
    },
    logError: () => {},
  });
  return { handler, calls };
}

test("a Hollywood viewport comes back as an ordered walk with a line on the map", async () => {
  const { handler, calls } = handlerWith();
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX, budgetMinutes: 120 }));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.stops.length, 3);
  assert.deepEqual(body.stops.map((stop) => stop.order), [1, 2, 3]);
  assert.equal(body.walk.distanceKm, 0.4);
  assert.equal(body.walk.source, "openstreetmap-foot");
  assert.equal(calls.router.length, 1, "one router call for the whole walk");
});

test("every stop states which store it came from and who said it", async () => {
  const { handler } = handlerWith();
  const { stops } = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  for (const stop of stops) {
    assert.equal(stop.grounding.verified, false);
    assert.equal(stop.grounding.store, "queue");
    assert.ok(stop.grounding.source_url);
  }
});

test("the honesty line and the caveat travel with the payload, not in a doc somewhere", async () => {
  const { handler } = handlerWith();
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  assert.match(body.honesty, /None of these 3 stops is verified/);
  assert.match(body.caveat, /never means open/);
  assert.equal(body.min_stops, 3);
});

test("coverage says whether we looked at everything or only the first thousand rows", async () => {
  const many = Array.from({ length: 1000 }, (unused, index) => ({
    submission_id: `m${index}`, work_id: `w${index}`, work_title: `Film ${index}`,
    name: `Place ${index}`, lat: 34.10 + index / 100000, lng: -118.34, status: "pending",
    source_kind: "moviemaps", source_url: `https://moviemaps.org/${index}`,
  }));
  const { handler } = handlerWith({ candidates: many });
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX }))).json();
  assert.equal(body.coverage.candidates_in_view, 1000);
  assert.equal(body.coverage.truncated, true, "Los Angeles holds 4,665 rows and the cap is 1,000");
});

// --- the library never leaves the browser ---------------------------------------------

test("a plan filtered by somebody's films is never cached at the edge", async () => {
  const { handler } = handlerWith();
  const withLibrary = await handler(request({
    bbox: HOLLYWOOD_BBOX, library: [{ title: "Forrest Gump", year: 1994 }],
  }));
  assert.equal(withLibrary.headers.get("Cache-Control"), "private, no-store");

  const without = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.match(without.headers.get("Cache-Control"), /public, s-maxage=3600/);
});

test("the library filters the stops and is not echoed back", async () => {
  const { handler } = handlerWith();
  const body = await (await handler(request({
    bbox: HOLLYWOOD_BBOX, library: [{ title: "Forrest Gump", year: 1994 }],
  }))).json();
  assert.ok(!("library" in body), "nothing sent in is written down or handed back");
  assert.ok(body.excluded.some((row) => row.reason === "not_in_library"));
});

test("an oversized library is refused rather than parsed", async () => {
  const { handler } = handlerWith();
  const response = await handler(request({
    bbox: HOLLYWOOD_BBOX,
    library: Array.from({ length: 20_001 }, () => ({ title: "x", year: 2000 })),
  }));
  assert.equal(response.status, 400);
});

// --- validation -----------------------------------------------------------------------

test("a bbox is required and a bad one is a 400, never an empty plan", async () => {
  const { handler } = handlerWith();
  assert.equal((await handler(request({}))).status, 400);
  assert.equal((await handler(request({ bbox: { west: -118 } }))).status, 400);
  assert.equal((await handler(request({ bbox: { ...HOLLYWOOD_BBOX, north: 200 } }))).status, 400);
});

test("a budget the planner does not offer is a 400 and not a silent rounding", async () => {
  const { handler } = handlerWith();
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX, budgetMinutes: 45 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /budgetMinutes must be one of 30, 60, 120/);
});

test("parseTripBody normalises a flipped bbox instead of returning its complement", () => {
  const parsed = parseTripBody({ bbox: { west: -118.36, east: -118.30, south: 34.115, north: 34.085 } });
  assert.equal(parsed.south, undefined);
  assert.equal(parsed.bbox.south, 34.085);
  assert.equal(parsed.bbox.north, 34.115);
});

test("a body that is not JSON is a 400", async () => {
  const { handler } = handlerWith();
  const response = await handler({ json: async () => { throw new Error("nope"); }, url: "https://x/y" });
  assert.equal(response.status, 400);
});

// --- failure modes --------------------------------------------------------------------

test("a dead router loses the line and never the plan", async () => {
  const { handler } = handlerWith({ router: new Error("OSRM down") });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 200, "five addresses in walking order is still an afternoon");

  const body = await response.json();
  assert.equal(body.walk, null);
  assert.equal(body.stops.length, 3);
});

test("a graph that cannot be read is a 502 and says so", async () => {
  const { handler } = handlerWith({ readerError: new Error("connection refused") });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Could not read places/);
});

test("no credentials is a 503, which is a different problem from an empty viewport", async () => {
  const handler = createTripPlanHandler({ env: {}, logError: () => {} });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 503);
});

test("an empty viewport is an honest empty plan, not an error", async () => {
  const { handler } = handlerWith({ candidates: [] });
  const response = await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.stops.length, 0);
  assert.equal(body.enough, false);
  assert.equal(body.walk, null, "the router is never called for a plan with nothing in it");
});

test("the map's own readers are used, at the zoom that returns places and not grid cells", async () => {
  const { handler, calls } = handlerWith();
  await handler(request({ bbox: HOLLYWOOD_BBOX }));
  assert.deepEqual(calls.rpc.map(([name]) => name).sort(), ["candidates", "points"]);
  for (const [, params] of calls.rpc) {
    assert.equal(params.p_zoom, 15);
    assert.equal(params.p_cluster_below_zoom, 0, "a cluster is not a place and cannot be walked to");
  }
});

test("candidates can be turned off, and then the graph is all there is", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(request({ bbox: HOLLYWOOD_BBOX, includeCandidates: false }))).json();
  assert.equal(body.stops.length, 0, "the LA graph holds one place: a plan from it alone is empty");
  assert.ok(!calls.rpc.some(([name]) => name === "candidates"));
});
