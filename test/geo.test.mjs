import assert from "node:assert/strict";
import test from "node:test";

import {
  EARTH_RADIUS_KM,
  EARTH_RADIUS_M,
  WALKING_SPEED_KMH,
  assertPosition,
  haversineKm,
  haversineMeters,
  isFinitePair,
  isLatLng,
} from "../app/lib/geo.mjs";

test("constants match the historical hand-rolled values", () => {
  assert.equal(EARTH_RADIUS_M, 6371000);
  assert.equal(EARTH_RADIUS_KM, 6371);
  assert.equal(WALKING_SPEED_KMH, 4.6);
});

test("isFinitePair accepts a finite pair, rejects the rest", () => {
  assert.ok(isFinitePair([51.5, -0.12]));
  assert.ok(isFinitePair([200, 999])); // no range check at this level
  assert.ok(!isFinitePair([51.5]));
  assert.ok(!isFinitePair([Number.NaN, 0]));
  assert.ok(!isFinitePair(null));
});

test("isLatLng also enforces Earth ranges", () => {
  assert.ok(isLatLng([51.5, -0.12]));
  assert.ok(!isLatLng([91, 0]));
  assert.ok(!isLatLng([0, -181]));
  assert.ok(!isLatLng([Number.NaN, 0]));
});

test("assertPosition throws on invalid, is silent on valid", () => {
  assert.doesNotThrow(() => assertPosition([51.5, -0.12], "x"));
  assert.throws(() => assertPosition([91, 0], "x"), /x must be a \[latitude, longitude\] pair/);
});

test("haversineMeters equals haversineKm * 1000 and known distances", () => {
  const kingsCross = [51.532, -0.1233];
  const southBank = [51.5066, -0.1162];
  assert.equal(haversineMeters(kingsCross, kingsCross), 0);
  assert.equal(haversineMeters(kingsCross, southBank), haversineKm(kingsCross, southBank) * 1000);
  // one degree of latitude ≈ 111.195 km on this sphere
  assert.ok(Math.abs(haversineMeters([51, 0], [52, 0]) - 111195) < 200);
});

test("haversineKm is symmetric", () => {
  const a = [40.7128, -74.006];
  const b = [34.0522, -118.2437];
  assert.equal(
    Math.round(haversineKm(a, b) * 1e6),
    Math.round(haversineKm(b, a) * 1e6),
  );
});
