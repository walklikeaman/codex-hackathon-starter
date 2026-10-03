import assert from "node:assert/strict";
import test from "node:test";

import { modelFailed, notConfigured, readJsonBody } from "../app/lib/ai-route.mjs";

const post = (body) => new Request("http://localhost/api/x", { method: "POST", body });

test("a body that is not JSON reads as null, for the route's schema to refuse", async () => {
  assert.deepEqual(await readJsonBody(post('{"a":1}')), { a: 1 });
  assert.equal(await readJsonBody(post("")), null);
  assert.equal(await readJsonBody(post("{")), null);
});

test("an unconfigured capability is a 503 in the route's own words", async () => {
  const response = notConfigured("AI tours are not configured.");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AI tours are not configured." });
});

// The provider's message can carry the prompt or account details; the log keeps only what
// identifies the failure.
test("a model failure is a 502, and the log keeps the name and status but never the message", async () => {
  const logged = [];
  const error = Object.assign(new Error("Incorrect API key provided: sk-live-abc… for org-xyz"), { name: "AuthenticationError", status: 401 });
  const response = modelFailed({ error, label: "AI tour generation failed", message: "Could not build the AI tour. Try again.", log: (...args) => logged.push(args) });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Could not build the AI tour. Try again." });
  assert.deepEqual(logged, [["AI tour generation failed", { name: "AuthenticationError", status: 401 }]]);
  assert.equal(JSON.stringify(logged).includes("sk-live"), false);
});
