import assert from "node:assert/strict";
import test from "node:test";

import { createMapPointsHandler } from "../app/api/map/points/route.js";
import {
  buildMapResponse,
  CLUSTER_BELOW_ZOOM,
  MAX_MAP_POINTS,
  parseMapQuery,
  pointBadge,
} from "../app/lib/map-points.mjs";

const params = (object) => new URLSearchParams(object);
const LONDON = { west: "-0.35", south: "51.35", east: "0.05", north: "51.65" };

function placeRow(overrides = {}) {
  return {
    point_kind: "place",
    place_id: "11111111-1111-1111-1111-111111111111",
    wikidata_id: "Q129143",
    name: "Trafalgar Square",
    lat: 51.508,
    lng: -0.128,
    place_class: "real_exterior",
    geocode_precision: "point",
    shot_on_set: false,
    confidence: 0.9,
    confidence_band: "verified",
    work_count: 3,
    evidence_count: 1,
    cluster_count: 1,
    ...overrides,
  };
}

// --- query parsing -----------------------------------------------------------

test("parseMapQuery rejects a missing or out-of-range bbox", () => {
  assert.match(parseMapQuery(params({})).error, /bbox/);
  assert.match(parseMapQuery(params({ ...LONDON, north: "999" })).error, /bbox/);
  assert.match(parseMapQuery(params({ ...LONDON, west: "abc" })).error, /bbox/);
});

test("parseMapQuery names the zoom as the problem, not the bbox", () => {
  assert.match(parseMapQuery(params({ ...LONDON, z: "99" })).error, /Zoom/);
});

test("parseMapQuery preserves an antimeridian-crossing viewport", () => {
  // west > east is a real window across the date line. Sorting the pair would turn
  // the strip in front of the user into its own complement — the rest of the world.
  const query = parseMapQuery(params({ west: "170", south: "-60", east: "-170", north: "75", z: "13" }));
  assert.equal(query.west, 170);
  assert.equal(query.east, -170);
});

test("parseMapQuery refuses a filter it cannot honour instead of widening silently", () => {
  // Quietly dropping a bad workId would answer "this film's places" with the whole
  // graph — a wrong answer dressed as a successful one.
  assert.match(parseMapQuery(params({ ...LONDON, workId: "not-a-uuid" })).error, /workId/);
  assert.match(parseMapQuery(params({ ...LONDON, kinds: "film,nonsense" })).error, /kinds/);
  assert.match(parseMapQuery(params({ ...LONDON, kinds: "" })).error, /kinds/);
});

test("parseMapQuery normalizes flipped latitudes and rounds the zoom", () => {
  const query = parseMapQuery(params({ west: "-0.35", east: "0.05", south: "51.65", north: "51.35", z: "13.4" }));
  assert.equal(query.south, 51.35);
  assert.equal(query.north, 51.65);
  assert.equal(query.zoom, 13);
});

test("parseMapQuery switches to clustering below the zoom threshold", () => {
  assert.equal(parseMapQuery(params({ ...LONDON, z: String(CLUSTER_BELOW_ZOOM - 1) })).clustered, true);
  assert.equal(parseMapQuery(params({ ...LONDON, z: String(CLUSTER_BELOW_ZOOM) })).clustered, false);
});

test("parseMapQuery accepts a real uuid work id and known kinds", () => {
  const uuid = "22222222-2222-2222-2222-222222222222";
  assert.equal(parseMapQuery(params({ ...LONDON, workId: uuid })).workId, uuid);
  assert.deepEqual(parseMapQuery(params({ ...LONDON, kinds: "film,book" })).kinds, ["film", "book"]);
  assert.equal(parseMapQuery(params({ ...LONDON })).kinds, null);
});

// --- badges & shaping --------------------------------------------------------

test("pointBadge tells a studio from a street from an approximate centroid", () => {
  assert.equal(pointBadge(placeRow({ shot_on_set: true, place_class: "studio_interior" })), "studio");
  assert.equal(pointBadge(placeRow({ place_class: "narrative_real" })), "narrative");
  assert.equal(pointBadge(placeRow({ geocode_precision: "city" })), "approximate");
  assert.equal(pointBadge(placeRow({ geocode_precision: "country" })), "approximate");
  assert.equal(pointBadge(placeRow()), "exact");
});

test("buildMapResponse emits GeoJSON with the grounding fields inline", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [placeRow()], []);

  assert.equal(body.type, "FeatureCollection");
  assert.equal(body.clustered, false);
  assert.deepEqual(body.features[0].geometry.coordinates, [-0.128, 51.508]); // lng, lat
  const props = body.features[0].properties;
  assert.equal(props.name, "Trafalgar Square");
  assert.equal(props.place_class, "real_exterior");
  assert.equal(props.confidence, 0.9);
  assert.equal(props.badge, "exact");
  assert.equal(props.work_count, 3);
  assert.equal(props.source_url, "https://www.wikidata.org/wiki/Q129143");
});

test("buildMapResponse shapes clusters when zoomed out", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "5" }));
  const body = buildMapResponse(query, [
    { lat: 51.5, lng: -0.12, cluster_count: 17, sample_name: "London", has_studio: true },
  ], []);
  assert.equal(body.clustered, true);
  assert.deepEqual(body.features[0].properties, {
    cluster: true, point_count: 17, sample_name: "London", has_studio: true,
  });
});

test("buildMapResponse never emits a feature it cannot honestly place", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [
    placeRow({ lat: null, lng: null }),
    placeRow({ lat: 91, lng: 0 }), // out of range
    placeRow(),
  ], []);
  assert.equal(body.features.length, 1);
});

test("buildMapResponse carries fiction as a strip, never as a pin", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const body = buildMapResponse(query, [placeRow()], [
    { place_id: "f1", wikidata_id: "Q79734", name: "Middle-earth", work_count: 1 },
  ]);
  assert.equal(body.features.length, 1); // fiction is not among the features
  assert.deepEqual(body.fictional, [
    { place_id: "f1", wikidata_id: "Q79734", name: "Middle-earth", work_count: 1 },
  ]);
});

test("buildMapResponse flags a truncated result", () => {
  const query = parseMapQuery(params({ ...LONDON, z: "13" }));
  const many = Array.from({ length: MAX_MAP_POINTS }, () => placeRow());
  assert.equal(buildMapResponse(query, many, []).truncated, true);
  assert.equal(buildMapResponse(query, [placeRow()], []).truncated, false);
});

// --- route -------------------------------------------------------------------

function mapRequest(query) {
  return new Request(`http://localhost/api/map/points?${new URLSearchParams(query)}`);
}

function handlerWith(overrides = {}) {
  return createMapPointsHandler({
    env: {},
    createReader: overrides.createReader ?? (() => overrides.reader ?? {
      points: async () => [placeRow()],
      clusters: async () => [{ lat: 51.5, lng: -0.12, cluster_count: 9, sample_name: "London", has_studio: false }],
      fictional: async () => [],
    }),
    logError: () => {},
  });
}

test("map points route rejects a bad bbox", async () => {
  assert.equal((await handlerWith()(mapRequest({ z: "13" }))).status, 400);
});

test("map points route returns 503 when the graph is not configured", async () => {
  const handler = handlerWith({ createReader: () => null });
  assert.equal((await handler(mapRequest({ ...LONDON, z: "13" }))).status, 503);
});

test("map points route serves places when zoomed in and clusters when zoomed out", async () => {
  const calls = [];
  const reader = {
    points: async (p) => { calls.push(["points", p.p_zoom]); return [placeRow()]; },
    clusters: async (p) => { calls.push(["clusters", p.p_zoom]); return [{ lat: 51.5, lng: -0.12, cluster_count: 9 }]; },
    fictional: async () => [],
  };
  const handler = handlerWith({ reader });

  const zoomedIn = await (await handler(mapRequest({ ...LONDON, z: "13" }))).json();
  assert.equal(zoomedIn.clustered, false);
  assert.equal(zoomedIn.features[0].properties.name, "Trafalgar Square");

  const zoomedOut = await (await handler(mapRequest({ ...LONDON, z: "5" }))).json();
  assert.equal(zoomedOut.clustered, true);
  assert.equal(zoomedOut.features[0].properties.point_count, 9);

  assert.deepEqual(calls, [["points", 13], ["clusters", 5]]);
});

test("map points route passes the work and kind filters through to the graph", async () => {
  let seen = null;
  const uuid = "33333333-3333-3333-3333-333333333333";
  const handler = handlerWith({
    reader: {
      points: async (p) => { seen = p; return []; },
      clusters: async () => [],
      fictional: async () => [],
    },
  });
  await handler(mapRequest({ ...LONDON, z: "13", workId: uuid, kinds: "film,series" }));
  assert.equal(seen.p_work_id, uuid);
  assert.deepEqual(seen.p_kinds, ["film", "series"]);
});

test("the fictional strip is filtered by the same query as the map", async () => {
  // A strip describing a different query than the pins would misreport what the user
  // is looking at ("your film is set in Mordor" while showing another film's places).
  let fictionalArgs = null;
  const uuid = "44444444-4444-4444-4444-444444444444";
  const handler = handlerWith({
    reader: {
      points: async () => [],
      clusters: async () => [],
      fictional: async (args) => { fictionalArgs = args; return []; },
    },
  });
  await handler(mapRequest({ ...LONDON, z: "13", workId: uuid, kinds: "book" }));
  assert.deepEqual(fictionalArgs, { workId: uuid, kinds: ["book"] });
});

test("map points route maps a graph failure to 502", async () => {
  const handler = handlerWith({
    reader: {
      points: async () => { throw new Error("rpc down"); },
      clusters: async () => [],
      fictional: async () => [],
    },
  });
  assert.equal((await handler(mapRequest({ ...LONDON, z: "13" }))).status, 502);
});
