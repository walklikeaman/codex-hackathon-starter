import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseBuilding,
  clampSearchRadius,
  DEFAULT_SEARCH_RADIUS_M,
  entranceFor,
  fetchBuildings,
  isVaguePrecision,
  MAX_SEARCH_RADIUS_M,
  MAX_SNAP_DISTANCE_M,
  metresToRing,
  OSM_ATTRIBUTION,
  overpassQuery,
  parseBuildings,
  parseEntrances,
  pointInRing,
  resolveBuildingSnap,
  ringCentroid,
  snapPosition,
  snapToBuilding,
  USER_AGENT,
} from "../app/lib/building-snap.mjs";

// A ~40 m square building, and a point on the street just outside it.
const BASE_LAT = 51.5;
const BASE_LNG = -0.12;
const d = 0.00018; // ≈ 20 m

const square = (offsetLat = 0, offsetLng = 0) => [
  { lat: BASE_LAT - d + offsetLat, lng: BASE_LNG - d + offsetLng },
  { lat: BASE_LAT - d + offsetLat, lng: BASE_LNG + d + offsetLng },
  { lat: BASE_LAT + d + offsetLat, lng: BASE_LNG + d + offsetLng },
  { lat: BASE_LAT + d + offsetLat, lng: BASE_LNG - d + offsetLng },
];

const building = (overrides = {}) => ({
  osm_id: "way/1", name: "Bradbury Building", tags: { building: "yes" }, ring: square(), ...overrides,
});

const INSIDE = { lat: BASE_LAT, lng: BASE_LNG };
const OUTSIDE = { lat: BASE_LAT + 0.0004, lng: BASE_LNG }; // ~44 m north of centre

// --- geometry ----------------------------------------------------------------

test("a point inside a footprint is recognised as inside", () => {
  assert.equal(pointInRing(INSIDE, square()), true);
  assert.equal(pointInRing(OUTSIDE, square()), false);
});

test("distance is measured to the WALL, not to the nearest corner", () => {
  // Standing against the middle of a long wall, the nearest corner can be far away.
  const longBuilding = [
    { lat: BASE_LAT, lng: BASE_LNG - 0.005 },
    { lat: BASE_LAT, lng: BASE_LNG + 0.005 },
    { lat: BASE_LAT + d, lng: BASE_LNG + 0.005 },
    { lat: BASE_LAT + d, lng: BASE_LNG - 0.005 },
  ];
  const againstTheWall = { lat: BASE_LAT - 0.00009, lng: BASE_LNG }; // ~10 m from the wall
  assert.ok(metresToRing(againstTheWall, longBuilding) < 15);
});

test("the centroid of a plain footprint is its middle", () => {
  const centroid = ringCentroid(square());
  assert.ok(Math.abs(centroid.lat - BASE_LAT) < 1e-9);
  assert.ok(Math.abs(centroid.lng - BASE_LNG) < 1e-9);
});

test("a ring with no area has no centroid", () => {
  const collinear = [
    { lat: BASE_LAT, lng: BASE_LNG },
    { lat: BASE_LAT, lng: BASE_LNG + d },
    { lat: BASE_LAT, lng: BASE_LNG + 2 * d },
  ];
  assert.equal(ringCentroid(collinear), null);
  assert.equal(ringCentroid([]), null);
  assert.equal(ringCentroid(null), null);
});

// --- choosing ----------------------------------------------------------------

test("a point inside a footprint identifies that building even in a dense street", () => {
  // Proximity alone fails here: all three neighbours are within metres. Containment
  // is what makes this work in a city.
  const chosen = chooseBuilding(INSIDE, [
    building({ osm_id: "way/1" }),
    building({ osm_id: "way/2", ring: square(0, 0.0005) }),
    building({ osm_id: "way/3", ring: square(0, -0.0005) }),
  ]);
  assert.equal(chosen.building.osm_id, "way/1");
  assert.equal(chosen.reason, "inside_footprint");
});

test("two neighbours in range and none containing is ambiguous, so nothing is snapped", () => {
  const chosen = chooseBuilding(OUTSIDE, [
    building({ osm_id: "way/1" }),
    building({ osm_id: "way/2", ring: square(0.0008, 0) }),
  ]);
  assert.equal(chosen.building, null);
  assert.equal(chosen.reason, "ambiguous_neighbours");
});

test("overlapping footprints are ambiguous rather than a coin toss", () => {
  const chosen = chooseBuilding(INSIDE, [
    building({ osm_id: "way/1" }),
    building({ osm_id: "way/2", ring: square() }),
  ]);
  assert.equal(chosen.building, null);
  assert.equal(chosen.reason, "ambiguous_overlap");
});

test("a lone building nearby is accepted", () => {
  const chosen = chooseBuilding(OUTSIDE, [building()]);
  assert.equal(chosen.reason, "only_building_nearby");
});

test("nothing in range is not a snap", () => {
  const faraway = { lat: BASE_LAT + 0.01, lng: BASE_LNG };
  assert.equal(chooseBuilding(faraway, [building()]).reason, "no_buildings");
  assert.equal(chooseBuilding(INSIDE, []).reason, "no_buildings");
});

// --- positioning -------------------------------------------------------------

test("a mapped entrance is preferred over the middle of the building", () => {
  // You walk to the door, not to the geometric centre.
  const entrances = [
    { osm_id: "node/9", kind: "yes", position: square()[1] },
    { osm_id: "node/7", kind: "main", position: square()[0] },
  ];
  const snap = snapPosition(INSIDE, building(), entrances);
  assert.equal(snap.via, "entrance");
  assert.equal(snap.entrance_id, "node/7"); // main beats a side door
});

test("an entrance belonging to a DIFFERENT building is not used", () => {
  const stranger = [{ osm_id: "node/9", kind: "main", position: { lat: BASE_LAT + 0.01, lng: BASE_LNG } }];
  assert.equal(entranceFor(building(), stranger), null);
  assert.equal(snapPosition(INSIDE, building(), stranger).via, "centroid");
});

test("a centroid that escapes a concave building is not used as the pin", () => {
  // A U-shaped building's area centroid lands in the courtyard — outside the walls.
  const uShape = [
    { lat: BASE_LAT - d, lng: BASE_LNG - d },
    { lat: BASE_LAT - d, lng: BASE_LNG + d },
    { lat: BASE_LAT + d, lng: BASE_LNG + d },
    { lat: BASE_LAT + d, lng: BASE_LNG + d / 2 },
    { lat: BASE_LAT - d / 2, lng: BASE_LNG + d / 2 },
    { lat: BASE_LAT - d / 2, lng: BASE_LNG - d / 2 },
    { lat: BASE_LAT + d, lng: BASE_LNG - d / 2 },
    { lat: BASE_LAT + d, lng: BASE_LNG - d },
  ];
  const insideAnArm = { lat: BASE_LAT - 0.8 * d, lng: BASE_LNG };
  assert.equal(pointInRing(insideAnArm, uShape), true);

  const snap = snapPosition(insideAnArm, building({ ring: uShape }), []);
  assert.equal(snap.via, "original_inside");
  assert.deepEqual(snap.position, insideAnArm);
});

// --- the whole decision ------------------------------------------------------

test("a street-centroid pin moves onto the building and earns the badge", () => {
  const result = snapToBuilding({ lat: OUTSIDE.lat, lng: OUTSIDE.lng, precision: "street", buildings: [building()] });
  assert.equal(result.snapped, true);
  assert.equal(result.geocode_precision, "building");
  assert.equal(result.osm_building_id, "way/1");
  assert.ok(result.moved_m > 0);
  assert.deepEqual(result.attribution, OSM_ATTRIBUTION);
});

test("an ambiguous case keeps the original point AND the original precision", () => {
  // The fail-safe the issue asks for: no confident match means no change at all.
  const result = snapToBuilding({
    lat: OUTSIDE.lat, lng: OUTSIDE.lng,
    buildings: [building({ osm_id: "way/1" }), building({ osm_id: "way/2", ring: square(0.0008, 0) })],
  });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "ambiguous_neighbours");
  assert.equal(result.lat, OUTSIDE.lat);
  assert.equal(result.lng, OUTSIDE.lng);
  assert.equal(result.geocode_precision, null); // NOT upgraded
});

test("a footprint covering a whole complex confirms the building but does not drag the pin", () => {
  // An airport terminal's centroid can be hundreds of metres from where the geocoder
  // put you. Being inside it is real evidence; moving the pin there is not a fix.
  const huge = [
    { lat: BASE_LAT - 0.01, lng: BASE_LNG - 0.01 },
    { lat: BASE_LAT - 0.01, lng: BASE_LNG + 0.01 },
    { lat: BASE_LAT + 0.01, lng: BASE_LNG + 0.01 },
    { lat: BASE_LAT + 0.01, lng: BASE_LNG - 0.01 },
  ];
  const nearACorner = { lat: BASE_LAT - 0.009, lng: BASE_LNG - 0.009 };
  const result = snapToBuilding({
    lat: nearACorner.lat, lng: nearACorner.lng, precision: "point",
    buildings: [building({ osm_id: "way/big", ring: huge })],
  });

  assert.equal(result.snapped, true);
  assert.equal(result.geocode_precision, "building");
  assert.equal(result.lat, nearACorner.lat); // pin did not move
  assert.equal(result.moved_m, 0);
  assert.ok(result.footprint.length > 0);
});

test("a far snap on a building we are NOT inside is refused outright", () => {
  // Its near wall is ~55 m away, so it is a legitimate candidate — but its centre is
  // a kilometre off, and that is where the pin would land.
  const huge = [
    { lat: BASE_LAT + 0.0005, lng: BASE_LNG - 0.01 },
    { lat: BASE_LAT + 0.0005, lng: BASE_LNG + 0.01 },
    { lat: BASE_LAT + 0.02, lng: BASE_LNG + 0.01 },
    { lat: BASE_LAT + 0.02, lng: BASE_LNG - 0.01 },
  ];
  const result = snapToBuilding({
    lat: BASE_LAT, lng: BASE_LNG, precision: "point",
    buildings: [building({ ring: huge })], radiusM: MAX_SEARCH_RADIUS_M,
  });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "snap_too_far");
  assert.ok(MAX_SNAP_DISTANCE_M > 0);
});

test("a CITY is not snapped to a building it happens to sit on top of", () => {
  // Production did exactly this: Shanghai's centroid fell inside a tower and moved
  // 16 m, turning "set in Shanghai" into "set at this address".
  const result = snapToBuilding({
    lat: INSIDE.lat, lng: INSIDE.lng, name: "Shanghai", precision: "city",
    buildings: [building({ osm_id: "way/178801539", name: "Some Tower" })],
  });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "area_not_a_building");
  assert.equal(result.geocode_precision, null);
});

test("a vague place IS snapped when the building confirms it by name", () => {
  // Gloucester Cathedral is stored at 'city' precision but is plainly a building, and
  // OSM calls its footprint by the same name.
  const result = snapToBuilding({
    lat: INSIDE.lat, lng: INSIDE.lng, name: "Gloucester Cathedral", precision: "city",
    buildings: [building({ name: "Gloucester Cathedral" })],
  });
  assert.equal(result.snapped, true);
  assert.equal(result.geocode_precision, "building");
});

test("a country is never a building", () => {
  const result = snapToBuilding({
    lat: INSIDE.lat, lng: INSIDE.lng, name: "Japan", precision: "country",
    buildings: [building({ name: "Japan Post Office" })],
  });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "area_not_a_building");
});

test("a place already known to a point does not need the name to agree", () => {
  // A street-level geocode is already a claim about a spot; the building is a
  // refinement of it, and buildings are often unnamed in OSM.
  const result = snapToBuilding({
    lat: INSIDE.lat, lng: INSIDE.lng, name: "Somewhere", precision: "point",
    buildings: [building({ name: null })],
  });
  assert.equal(result.snapped, true);
});

test("isVaguePrecision knows an area from a spot", () => {
  assert.equal(isVaguePrecision("city"), true);
  assert.equal(isVaguePrecision("Country"), true);
  assert.equal(isVaguePrecision(null), true); // unknown precision is treated as vague
  assert.equal(isVaguePrecision("point"), false);
  assert.equal(isVaguePrecision("building"), false);
});

test("a missing coordinate never becomes 0,0", () => {
  const result = snapToBuilding({ lat: null, lng: null, buildings: [building()] });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "no_coordinate");
  assert.equal(result.lat, null);
});

// --- parsing Overpass --------------------------------------------------------

const overpassResponse = {
  elements: [
    { type: "way", id: 1, tags: { building: "yes", name: "Bradbury Building" },
      geometry: [...square().map((p) => ({ lat: p.lat, lon: p.lng })), { lat: square()[0].lat, lon: square()[0].lng }] },
    { type: "way", id: 2, tags: { building: "no" }, geometry: square().map((p) => ({ lat: p.lat, lon: p.lng })) },
    { type: "node", id: 7, lat: square()[0].lat, lon: square()[0].lng, tags: { entrance: "main" } },
    { type: "node", id: 8, lat: BASE_LAT, lon: BASE_LNG, tags: { entrance: "no" } },
    { type: "node", id: 9, lat: BASE_LAT, lon: BASE_LNG, tags: { amenity: "cafe" } },
  ],
};

test("building=no is not a building", () => {
  // It matches the ["building"] filter but means the opposite.
  const buildings = parseBuildings(overpassResponse);
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].osm_id, "way/1");
  assert.equal(buildings[0].name, "Bradbury Building");
});

test("a way closed by a repeated node does not gain a zero-length edge", () => {
  const [parsed] = parseBuildings(overpassResponse);
  assert.equal(parsed.ring.length, 4); // not 5
});

test("only real entrances are entrances", () => {
  const entrances = parseEntrances(overpassResponse);
  assert.deepEqual(entrances.map((e) => e.osm_id), ["node/7"]);
});

test("parsers survive a junk response", () => {
  assert.deepEqual(parseBuildings(null), []);
  assert.deepEqual(parseBuildings({ elements: "nope" }), []);
  assert.deepEqual(parseEntrances(undefined), []);
});

// --- fair use ----------------------------------------------------------------

test("the query bounds itself and asks only for what is needed", () => {
  const query = overpassQuery(BASE_LAT, BASE_LNG, 60);
  assert.match(query, /\[timeout:\d+\]/);
  assert.match(query, /around:60,51\.5,-0\.12/);
  assert.match(query, /way\["building"\]/);
  assert.match(query, /node\(around:[^)]+\)\["entrance"\]/);
  assert.equal(overpassQuery(null, null), null);
});

test("the search radius is bounded in both directions", () => {
  assert.equal(clampSearchRadius(60), 60);
  assert.equal(clampSearchRadius(99999), MAX_SEARCH_RADIUS_M);
  assert.equal(clampSearchRadius(0), DEFAULT_SEARCH_RADIUS_M);
  assert.equal(clampSearchRadius(null), DEFAULT_SEARCH_RADIUS_M);
});

test("every call identifies itself, as Overpass asks", async () => {
  let seen = null;
  await fetchBuildings({
    lat: BASE_LAT, lng: BASE_LNG,
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => overpassResponse }; },
  });
  assert.equal(seen.init.headers["User-Agent"], USER_AGENT);
  assert.match(seen.init.body, /^data=/);
});

test("an Overpass outage degrades to no snap, never to a failure", async () => {
  const result = await resolveBuildingSnap({
    lat: BASE_LAT, lng: BASE_LNG, fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  assert.equal(result.snapped, false);
  assert.equal(result.reason, "overpass_unavailable");
  assert.equal(result.lat, BASE_LAT); // the original coordinate survives
});

test("a live-shaped response resolves end to end", async () => {
  const result = await resolveBuildingSnap({
    lat: OUTSIDE.lat, lng: OUTSIDE.lng, precision: "point",
    fetchImpl: async () => ({ ok: true, json: async () => overpassResponse }),
  });
  assert.equal(result.snapped, true);
  assert.equal(result.via, "entrance");
  assert.equal(result.osm_building_id, "way/1");
});
