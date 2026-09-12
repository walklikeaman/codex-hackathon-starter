import assert from "node:assert/strict";
import test from "node:test";

import { createLibraryHandler } from "../app/api/library/route.js";

const MOVIES = [
  { title: "Heat", year: 1995, rating: 9, watchedDate: "2026-01-02", sources: ["imdb"] },
  { title: "Drive", year: 2011, rating: 8, watchedDate: "2026-06-15", sources: ["imdb"] },
  { title: "Solaris", year: 1972, rating: null, watchedDate: "2025-11-01", sources: ["letterboxd"] },
];

function request(token) {
  return {
    headers: { get: (name) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) },
  };
}

function handlerWith(result, { throws = null } = {}) {
  const seen = [];
  return {
    seen,
    handler: createLibraryHandler({
      env: {},
      readLibrary: () => async (token) => {
        seen.push(token);
        if (throws) throw throws;
        return result;
      },
      logError: () => {},
    }),
  };
}

test("the owner is told what the account holds", async () => {
  const { handler, seen } = handlerWith({ movies: MOVIES, updatedAt: "2026-09-12T10:00:00Z" });
  const body = await (await handler(request("tok"))).json();

  assert.deepEqual(seen, ["tok"]);
  assert.equal(body.titles, 3);
  assert.equal(body.rated, 2);
  assert.deepEqual(body.sources, ["imdb", "letterboxd"]);
  assert.equal(body.updated_at, "2026-09-12T10:00:00Z");
});

// The library is the one piece of personal data here. A route that hands 2,798 titles to
// anybody holding a token is a bigger target than one that proves the filter is live.
test("the list itself is never returned, only enough to recognise it", async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    title: `Film ${i}`, year: 2000, watchedDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
  }));
  const { handler } = handlerWith({ movies: many, updatedAt: null });
  const body = await (await handler(request("tok"))).json();

  assert.equal(body.titles, 400);
  assert.equal(body.sample.length, 5);
  assert.ok(JSON.stringify(body).length < 2000, "the response is a summary, not a copy");
});

test("the sample is the recent end, which is what a person recognises", async () => {
  const { handler } = handlerWith({ movies: MOVIES, updatedAt: null });
  const body = await (await handler(request("tok"))).json();
  assert.deepEqual(body.sample.map((movie) => movie.title), ["Drive", "Heat", "Solaris"]);
});

test("an account with no library is zero titles, not an error", async () => {
  const { handler } = handlerWith({ movies: [], updatedAt: null });
  const response = await handler(request("tok"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).titles, 0);
});

test("no token, no answer", async () => {
  const { handler, seen } = handlerWith({ movies: MOVIES, updatedAt: null });
  const response = await handler(request(null));
  assert.equal(response.status, 401);
  assert.deepEqual(seen, [], "nothing was read");
});

test("a token that identifies nobody is refused rather than answered emptily", async () => {
  const { handler } = handlerWith(null);
  assert.equal((await handler(request("stale"))).status, 401);
});

test("a failed read is a 502 and never a zero", async () => {
  const { handler } = handlerWith(null, { throws: new Error("network") });
  assert.equal((await handler(request("tok"))).status, 502);
});

test("the answer is never cached", async () => {
  const { handler } = handlerWith({ movies: MOVIES, updatedAt: null });
  const response = await handler(request("tok"));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
