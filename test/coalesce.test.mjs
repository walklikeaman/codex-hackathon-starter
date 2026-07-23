import assert from "node:assert/strict";
import test from "node:test";

import { createCoalescingRunner } from "../app/lib/coalesce.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("createCoalescingRunner rejects a non-function", () => {
  assert.throws(() => createCoalescingRunner(null));
});

test("runs never overlap and the latest value wins on out-of-order submits", async () => {
  const calls = [];
  const gates = [deferred(), deferred()];
  let index = 0;
  let concurrent = 0;
  let maxConcurrent = 0;

  const runner = createCoalescingRunner(async (value) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    calls.push(value);
    await gates[index++].promise;
    concurrent -= 1;
  });

  // Submit A (starts running, awaiting gate 0), then B while A is in flight.
  // The first submit returns the shared drain promise, which resolves only once
  // the whole queue empties. resolve() is idempotent, so releasing both gates up
  // front lets B proceed when it reaches its await — no microtask-timing guesses.
  const drained = runner.submit("A");
  runner.submit("B");
  assert.equal(runner.isRunning(), true);
  assert.deepEqual(calls, ["A"]); // B is queued, not started

  gates[0].resolve();
  gates[1].resolve();
  await drained;

  assert.deepEqual(calls, ["A", "B"]); // last submitted ran last
  assert.equal(maxConcurrent, 1); // never concurrent
  assert.equal(runner.isRunning(), false);
});

test("rapid submits coalesce to the final value", async () => {
  const applied = [];
  const runner = createCoalescingRunner(async (value) => {
    await Promise.resolve();
    applied.push(value);
  });

  // Fire several submits synchronously; the first drains, the rest coalesce.
  const drained = runner.submit(1);
  runner.submit(2);
  runner.submit(3);
  await drained; // wait for the full drain, not a fixed number of ticks

  // The final value is guaranteed to be applied last (last-write-wins).
  assert.equal(applied[applied.length - 1], 3);
  assert.equal(runner.isRunning(), false);
});

test("a failing run does not wedge the runner", async () => {
  let attempts = 0;
  const runner = createCoalescingRunner(async (value) => {
    attempts += 1;
    if (value === "boom") throw new Error("fail");
  });

  await assert.rejects(runner.submit("boom"));
  await runner.submit("ok"); // still works after a rejection
  assert.equal(attempts, 2);
  assert.equal(runner.isRunning(), false);
});
