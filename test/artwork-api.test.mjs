import assert from "node:assert/strict";
import test from "node:test";

import { createArtworkHandler } from "../app/api/artwork/route.js";
import {
  MAX_POSTER_LOOKUPS,
  parsePosterQuery,
  posterEntry,
  posterKey,
  postersFromRows,
  tmdbDetailUrl,
} from "../app/lib/work-posters.mjs";

const params = (query) => new URL(`http://x/?${query}`).searchParams;

// --- the query ---------------------------------------------------------------

test("a film id and a series id with the same number are different posters", () => {
  // TMDB numbers movies and TV independently, so the kind has to be part of the key.
  assert.equal(posterKey("film", "1399"), "film:1399");
  assert.equal(posterKey("series", "1399"), "series:1399");
  assert.notEqual(posterKey("film", "1399"), posterKey("series", "1399"));
});

test("only films and series have TMDB posters", () => {
  // A book has no TMDB entry; asking would burn a request on a guaranteed miss.
  assert.equal(posterKey("book", "170"), null);
  assert.equal(posterKey("film", "abc"), null);
  assert.equal(posterKey("film", "0"), null);
  assert.equal(posterKey("film", null), null);
});

test("one bad id costs its own poster, not the whole screen", () => {
  const wanted = parsePosterQuery(params("film=170,nope,78"));
  assert.deepEqual(wanted.map((item) => item.key), ["film:170", "film:78"]);
});

test("repeats are asked for once", () => {
  const wanted = parsePosterQuery(params("film=170,170,170"));
  assert.equal(wanted.length, 1);
});

test("the lookup is bounded", () => {
  const ids = Array.from({ length: MAX_POSTER_LOOKUPS + 20 }, (_, i) => i + 1).join(",");
  assert.equal(parsePosterQuery(params(`film=${ids}`)).length, MAX_POSTER_LOOKUPS);
});

test("an empty query asks for nothing", () => {
  assert.deepEqual(parsePosterQuery(params("")), []);
  assert.deepEqual(parsePosterQuery(params("book=1")), []);
});

// --- shaping -----------------------------------------------------------------

test("a poster path becomes both sizes", () => {
  const entry = posterEntry("/abc123.jpg");
  assert.match(entry.thumb, /image\.tmdb\.org\/t\/p\/w185\/abc123\.jpg$/);
  assert.match(entry.card, /image\.tmdb\.org\/t\/p\/w500\/abc123\.jpg$/);
});

test("a malformed path never reaches an img src", () => {
  assert.equal(posterEntry("https://evil.example/x.jpg"), null);
  assert.equal(posterEntry("../../etc/passwd"), null);
  assert.equal(posterEntry(null), null);
});

test("a work we know but have not enriched is not cached as 'no poster'", () => {
  const rows = [
    { kind: "film", tmdb_id: "170", poster_path: "/a.jpg" },
    { kind: "film", tmdb_id: "78", poster_path: null },
    { kind: "book", tmdb_id: null, poster_path: null },
  ];
  const posters = postersFromRows(rows);
  assert.deepEqual(Object.keys(posters), ["film:170"]);
});

test("films and series hit different TMDB endpoints", () => {
  assert.match(tmdbDetailUrl("film", "170"), /\/3\/movie\/170/);
  assert.match(tmdbDetailUrl("series", "19885"), /\/3\/tv\/19885/);
  assert.equal(tmdbDetailUrl("book", "1"), null);
});

// --- the route ---------------------------------------------------------------

function handlerWith(overrides = {}) {
  const calls = { rows: 0, tmdb: [] };
  const handler = createArtworkHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k",
      TMDB_API_READ_ACCESS_TOKEN: "t", ...overrides.env },
    createStore: overrides.createStore ?? (() => ({
      postersByTmdbId: async () => {
        calls.rows += 1;
        if (overrides.storeThrows) throw new Error("db down");
        return overrides.rows ?? [];
      },
    })),
    fetchImpl: overrides.fetchImpl ?? (async (url) => {
      calls.tmdb.push(url);
      return { ok: true, json: async () => ({ poster_path: "/fetched.jpg" }) };
    }),
    logError: () => {},
  });
  return { handler, calls };
}

const request = (query) => new Request(`http://localhost/api/artwork?${query}`);

test("our own table answers first, and TMDB is never called for it", async () => {
  // /api/enrich/artwork has already filled these in; paying TMDB again would be waste.
  const { handler, calls } = handlerWith({
    rows: [{ kind: "film", tmdb_id: "170", poster_path: "/local.jpg" }],
  });
  const body = await (await handler(request("film=170"))).json();

  assert.match(body.posters["film:170"].thumb, /\/local\.jpg$/);
  assert.equal(calls.tmdb.length, 0);
});

test("a film we do not hold falls through to TMDB", async () => {
  const { handler, calls } = handlerWith({ rows: [] });
  const body = await (await handler(request("film=999"))).json();

  assert.match(body.posters["film:999"].thumb, /\/fetched\.jpg$/);
  assert.equal(calls.tmdb.length, 1);
  assert.match(calls.tmdb[0], /\/movie\/999/);
});

test("a title with no poster is absent, not an error", async () => {
  // The client keeps its initials tile; an empty answer is valid and cacheable.
  const { handler } = handlerWith({
    rows: [],
    fetchImpl: async () => ({ ok: true, json: async () => ({ poster_path: null }) }),
  });
  const response = await handler(request("film=170"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.posters, {});
  assert.equal(body.unresolved.no_poster, 1);
});

test("a systemic failure is distinguishable from a title with no art", async () => {
  // Both return no poster. Only one of them means the credentials are wrong, and
  // telling them apart otherwise costs a whole deploy cycle.
  const { handler } = handlerWith({ rows: [], fetchImpl: async () => ({ ok: false, status: 401 }) });
  const body = await (await handler(request("film=170&series=19885"))).json();
  assert.deepEqual(body.posters, {});
  assert.equal(body.unresolved.http_401, 2);
});

test("missing credentials say so rather than looking like missing art", async () => {
  const { handler } = handlerWith({
    rows: [], env: { TMDB_API_READ_ACCESS_TOKEN: undefined, TMDB_API_KEY: undefined },
  });
  const body = await (await handler(request("film=170"))).json();
  assert.equal(body.unresolved.no_credentials, 1);
});

test("a rejected bearer token falls back to the api_key scheme", async () => {
  // Production held a value that 401s as a bearer token while an api_key was also
  // configured; trusting the first credential reported every film as art-less.
  const seen = [];
  const { handler } = handlerWith({
    rows: [],
    env: { TMDB_API_READ_ACCESS_TOKEN: "wrong", TMDB_API_KEY: "right" },
    fetchImpl: async (url, init) => {
      seen.push(url);
      if (init.headers.Authorization) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ poster_path: "/viakey.jpg" }) };
    },
  });
  const body = await (await handler(request("film=170"))).json();

  assert.match(body.posters["film:170"].thumb, /\/viakey\.jpg$/);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /api_key=right/);
});

test("a non-auth failure is not retried with the other credential", async () => {
  // A 404 is about the title, not the key; trying again just doubles the traffic.
  let calls = 0;
  const { handler } = handlerWith({
    rows: [],
    env: { TMDB_API_READ_ACCESS_TOKEN: "t", TMDB_API_KEY: "k" },
    fetchImpl: async () => { calls += 1; return { ok: false, status: 404 }; },
  });
  await handler(request("film=170"));
  assert.equal(calls, 1);
});

test("TMDB being down loses the poster, never the response", async () => {
  const { handler } = handlerWith({ rows: [], fetchImpl: async () => ({ ok: false, status: 503 }) });
  const response = await handler(request("film=170"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).posters, {});
});

test("a database failure still lets TMDB answer", async () => {
  // Losing the cheap source means paying for the poster, not going without it.
  const { handler, calls } = handlerWith({ storeThrows: true });
  const body = await (await handler(request("film=170"))).json();
  assert.match(body.posters["film:170"].thumb, /\/fetched\.jpg$/);
  assert.equal(calls.tmdb.length, 1);
});

test("without TMDB credentials the route degrades instead of failing", async () => {
  const { handler, calls } = handlerWith({
    rows: [],
    env: { TMDB_API_READ_ACCESS_TOKEN: undefined, TMDB_API_KEY: undefined },
  });
  const response = await handler(request("film=170"));
  assert.equal(response.status, 200);
  assert.equal(calls.tmdb.length, 0);
});

test("an empty request costs no lookup at all", async () => {
  const { handler, calls } = handlerWith();
  const body = await (await handler(request(""))).json();
  assert.deepEqual(body.posters, {});
  assert.equal(calls.rows, 0);
  assert.equal(calls.tmdb.length, 0);
});

test("posters are cached publicly — none of this is user-specific", async () => {
  const { handler } = handlerWith();
  const response = await handler(request("film=170"));
  assert.match(response.headers.get("Cache-Control"), /public/);
  assert.match(response.headers.get("Cache-Control"), /max-age=\d+/);
});

test("films and series are looked up together in one request", async () => {
  const { handler, calls } = handlerWith({ rows: [] });
  await handler(request("film=170&series=19885"));
  assert.equal(calls.tmdb.length, 2);
  assert.ok(calls.tmdb.some((url) => /\/movie\/170/.test(url)));
  assert.ok(calls.tmdb.some((url) => /\/tv\/19885/.test(url)));
});
