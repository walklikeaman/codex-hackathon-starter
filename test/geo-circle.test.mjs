import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_STEPS, circleFeature, circlePolygon } from "../app/lib/geo-circle.mjs";

// Metres between two coordinates, so the tests can check a RADIUS rather than a shape.
function metresBetween([lngA, latA], [lngB, latB]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

test("every point of the ring sits at the radius asked for", () => {
  const centre = [-118.3269, 34.1016];
  const radius = 1200;
  const ring = circlePolygon(centre, radius).coordinates[0];

  for (const point of ring) {
    const distance = metresBetween(centre, point);
    // Within 1%: the ring is an order-of-magnitude claim, not a survey.
    assert.ok(Math.abs(distance - radius) / radius < 0.01, `${distance}m is not ${radius}m`);
  }
});

// Longitude converges towards the poles. Without dividing by the cosine of the latitude a
// ring over a northern city is drawn as an ellipse — wider than it is tall.
test("a ring far north is still a circle on the ground, not an ellipse", () => {
  const reykjavik = [-21.9426, 64.1466];
  const ring = circlePolygon(reykjavik, 5000).coordinates[0];
  const distances = ring.map((point) => metresBetween(reykjavik, point));

  const widest = Math.max(...distances);
  const narrowest = Math.min(...distances);
  assert.ok((widest - narrowest) / widest < 0.02, `ring is ${narrowest}..${widest}m across`);
});

test("the ring is closed, because GeoJSON requires it", () => {
  const ring = circlePolygon([0, 0], 500).coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.equal(ring.length, DEFAULT_STEPS + 1);
});

test("a centre given as an object works the same as a pair", () => {
  const fromPair = circlePolygon([10, 20], 800);
  const fromObject = circlePolygon({ lng: 10, lat: 20 }, 800);
  assert.deepEqual(fromObject, fromPair);
});

// A null ring draws nothing. A NaN ring draws nothing too — and says why to nobody.
test("nonsense in gives nothing out rather than a NaN polygon", () => {
  assert.equal(circlePolygon(null, 500), null);
  assert.equal(circlePolygon([NaN, 10], 500), null);
  assert.equal(circlePolygon([10, 20], 0), null);
  assert.equal(circlePolygon([10, 20], -5), null);
  assert.equal(circleFeature(null, 500), null);
});

// Nothing this app maps is at a pole, but a NaN ring would be drawn as nothing with no
// explanation, and that is the kind of silence this project keeps finding the hard way.
test("a ring at the pole is finite rather than NaN", () => {
  const ring = circlePolygon([0, 90], 1000).coordinates[0];
  for (const [lng, lat] of ring) {
    assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
  }
});

test("the feature carries its properties, so a layer can style it", () => {
  const feature = circleFeature([1, 2], 300, { precision: "settlement" });
  assert.equal(feature.type, "Feature");
  assert.equal(feature.properties.precision, "settlement");
  assert.equal(feature.geometry.type, "Polygon");
});
