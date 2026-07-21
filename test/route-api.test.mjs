import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/route/route.js";

const coordinates = [
  [51.5, -0.1],
  [51.51, -0.11],
];

function routeRequest(body) {
  return new Request("http://localhost/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routerResponse() {
  return new Response(JSON.stringify({
    code: "Ok",
    routes: [
      {
        distance: 1_234,
        duration: 900,
        geometry: {
          type: "LineString",
          coordinates: [
            [-0.1, 51.5],
            [-0.11, 51.51],
          ],
        },
      },
    ],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("route API accepts the SceneMap stops contract and returns normalized metrics", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => routerResponse();

  const response = await POST(routeRequest({ stops: coordinates }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.distanceKm, 1.2);
  assert.equal(payload.durationMinutes, 15);
  assert.equal(payload.distanceMeters, 1_234);
  assert.equal(payload.durationSeconds, 900);
  assert.equal(payload.source, "openstreetmap-foot");
});

test("route API preserves the legacy coordinates contract", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => routerResponse();

  const response = await POST(routeRequest({ coordinates }));

  assert.equal(response.status, 200);
});

test("route API rejects malformed stops before calling the router", async () => {
  const response = await POST(routeRequest({ stops: [[51.5, -0.1]] }));

  assert.equal(response.status, 400);
});
