import assert from "node:assert/strict";
import test from "node:test";

import { createLetterboxdImportHandler } from "../app/api/import/letterboxd/route.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
<channel>
  <item>
    <letterboxd:filmTitle>Notting Hill</letterboxd:filmTitle>
    <letterboxd:filmYear>1999</letterboxd:filmYear>
    <letterboxd:memberRating>4.0</letterboxd:memberRating>
    <tmdb:movieId>509</tmdb:movieId>
  </item>
  <item>
    <letterboxd:filmTitle>Amelie</letterboxd:filmTitle>
    <letterboxd:filmYear>2001</letterboxd:filmYear>
    <tmdb:movieId>194</tmdb:movieId>
  </item>
  <item>
    <title>My watchlist</title>
    <link>https://letterboxd.com/dave/list/my-watchlist/</link>
  </item>
</channel>
</rss>`;

// A writer that records what the route tried to persist, and hands back synthetic
// work ids so the library-row join can be asserted end to end.
function recordingWriter() {
  const calls = { works: null, library: null };
  return {
    calls,
    upsertWorks: async (rows) => {
      calls.works = rows;
      return rows.map((row, index) => ({ id: `work-${index}`, tmdb_id: row.tmdb_id }));
    },
    upsertLibraryItems: async (rows) => {
      calls.library = rows;
    },
  };
}

function importRequest(body) {
  return new Request("http://localhost/api/import/letterboxd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function handlerWith(overrides = {}) {
  return createLetterboxdImportHandler({
    env: {},
    fetchImpl: overrides.fetchImpl
      ?? (async () => new Response(FEED, { status: 200 })),
    resolveUserId: overrides.resolveUserId ?? (async () => "user-1"),
    createWriter: overrides.createWriter ?? (() => overrides.writer ?? recordingWriter()),
    logError: () => {},
  });
}

test("import rejects an invalid Letterboxd handle before any fetch", async () => {
  let fetched = false;
  const handler = handlerWith({ fetchImpl: async () => { fetched = true; return new Response(FEED); } });
  const response = await handler(importRequest({ handle: "bad/handle" }));
  assert.equal(response.status, 400);
  assert.equal(fetched, false);
});

test("import requires an authenticated user", async () => {
  const handler = handlerWith({ resolveUserId: async () => null });
  const response = await handler(importRequest({ handle: "dave" }));
  assert.equal(response.status, 401);
});

test("import returns 503 when the writer is not configured", async () => {
  const handler = handlerWith({ createWriter: () => null });
  const response = await handler(importRequest({ handle: "dave" }));
  assert.equal(response.status, 503);
});

test("import surfaces an unknown profile as 404", async () => {
  const handler = handlerWith({
    fetchImpl: async () => new Response("Not found", { status: 404 }),
  });
  const response = await handler(importRequest({ handle: "ghost" }));
  assert.equal(response.status, 404);
});

test("import maps a 5xx feed to a 502", async () => {
  const handler = handlerWith({
    fetchImpl: async () => new Response("boom", { status: 503 }),
  });
  const response = await handler(importRequest({ handle: "dave" }));
  assert.equal(response.status, 502);
});

test("import reports zero for an empty feed and never writes", async () => {
  const writer = recordingWriter();
  const handler = handlerWith({
    writer,
    fetchImpl: async () => new Response("<rss><channel></channel></rss>", { status: 200 }),
  });
  const response = await handler(importRequest({ handle: "dave" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { handle: "dave", films: 0, works_upserted: 0, library_added: 0 });
  assert.equal(writer.calls.works, null);
});

test("import upserts deduped works and this user's library rows", async () => {
  const writer = recordingWriter();
  const handler = handlerWith({ writer, resolveUserId: async () => "user-42" });
  const response = await handler(importRequest({ handle: "dave" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    handle: "dave",
    films: 2,
    works_upserted: 2,
    library_added: 2,
  });

  assert.deepEqual(writer.calls.works.map((w) => w.tmdb_id), ["509", "194"]);
  assert.deepEqual(writer.calls.library, [
    { user_id: "user-42", work_id: "work-0", source: "letterboxd", rating: 4 },
    { user_id: "user-42", work_id: "work-1", source: "letterboxd", rating: null },
  ]);
});

test("import returns 502 when the database write throws", async () => {
  const handler = handlerWith({
    writer: {
      upsertWorks: async () => { throw new Error("db down"); },
      upsertLibraryItems: async () => {},
    },
  });
  const response = await handler(importRequest({ handle: "dave" }));
  assert.equal(response.status, 502);
});
