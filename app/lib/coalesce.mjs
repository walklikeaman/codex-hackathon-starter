// createCoalescingRunner — run an async side-effect so that (1) it never runs
// concurrently with itself, and (2) the LATEST submitted value is always applied
// last, even if an earlier run's promise settles out of order. Used for the
// debounced cloud-library save: without this, a slow save of a stale library
// could land in the store after a newer one and overwrite it (issue #83).
//
// Pure module: no React, no fetch. Covered by test/coalesce.test.mjs.
export function createCoalescingRunner(run) {
  if (typeof run !== "function") {
    throw new TypeError("createCoalescingRunner(run): run must be a function");
  }

  let running = false;
  let hasPending = false;
  let pending;

  async function drain() {
    if (running) return; // an active drain will pick up the newest pending value
    running = true;
    try {
      while (hasPending) {
        const value = pending;
        hasPending = false;
        pending = undefined;
        // Awaited serially: the next value only starts after this one resolves,
        // so completion order matches submission order and the last value wins.
        await run(value);
      }
    } finally {
      running = false;
    }
  }

  return {
    submit(value) {
      pending = value;
      hasPending = true;
      return drain();
    },
    isRunning() {
      return running;
    },
  };
}
