import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFootRouteUrl,
  parseFootRoute,
  validateRouteStops,
} from "../app/lib/walking-route.mjs";

test("buildFootRouteUrl sends longitude before latitude and requests GeoJSON", () => {
  const url = buildFootRouteUrl(
    [
      [51.5156, -0.2057],
      [51.4874, -0.1247],
    ],
    "https://routing.example.test/foot/",
  );

  assert.equal(
    url.toString(),
    "https://routing.example.test/foot/-0.2057,51.5156;-0.1247,51.4874?overview=full&geometries=geojson&steps=false",
  );
});

test("validateRouteStops rejects malformed and out-of-range points", () => {
  assert.throws(() => validateRouteStops([[51.5, -0.1]]));
  assert.throws(() => validateRouteStops([[91, 0], [51.5, -0.1]]));
  assert.throws(() => validateRouteStops([[51.5, -0.1], ["north", -0.2]]));
  assert.throws(() => validateRouteStops([[51.5, -0.1], [null, null]]));
});

test("parseFootRoute converts GeoJSON coordinates and route metrics", () => {
  const route = parseFootRoute({
    code: "Ok",
    routes: [
      {
        distance: 4_245,
        duration: 3_305,
        geometry: {
          type: "LineString",
          coordinates: [
            [-0.2057, 51.5156],
            [-0.1247, 51.4874],
          ],
        },
      },
    ],
  });

  assert.deepEqual(route, {
    positions: [
      [51.5156, -0.2057],
      [51.4874, -0.1247],
    ],
    distanceKm: 4.2,
    durationMinutes: 55,
  });
});

test("parseFootRoute rejects unsuccessful or incomplete responses", () => {
  assert.throws(() => parseFootRoute({ code: "NoRoute", routes: [] }));
  assert.throws(() =>
    parseFootRoute({
      code: "Ok",
      routes: [{ distance: 10, duration: 5, geometry: { type: "LineString" } }],
    }),
  );
});
