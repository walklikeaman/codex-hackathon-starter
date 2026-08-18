import assert from "node:assert/strict";
import test from "node:test";

import { createDirectoryCitiesHandler } from "../app/api/directory/cities/route.js";
import { createDirectoryCityHandler } from "../app/api/directory/city/route.js";
import { createDirectoryFilmsHandler } from "../app/api/directory/films/route.js";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://db.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

const get = (path) => new Request(`https://glorymap.local${path}`);

const row = (overrides = {}) => ({
  work_id: "d0296dd7-a372-4fe1-869b-2e189a002cce",
  title: "Skyfall",
  year: 2012,
  kind: "film",
  place_count: 36,
  places: ["Broadgate Tower", "Whitehall"],
  total_works: 656,
  total_points: 2300,
  ...overrides,
});

// ---------- one city ----------

test("an unknown city is a 404 decided here, and the database is never asked", () => {
  // Otherwise /city/<anything> is a way to make us scan the queue for free.
  let asked = false;
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => { asked = true; return []; } }),
  });
  return handler(get("/api/directory/city?slug=atlantis")).then(async (response) => {
    assert.equal(response.status, 404);
    assert.equal(asked, false);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
});

test("a city page asks for its own anchor and radius", async () => {
  const calls = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({
      loadCity: async (args) => { calls.push(args); return [row()]; },
    }),
  });

  const payload = await (await handler(get("/api/directory/city?slug=london"))).json();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].radiusKm, 20);
  assert.equal(calls[0].offset, 0);
  assert.equal(calls[0].limit, 48);
  // The anchor is the gazetteer's, to four decimal places, not something re-derived.
  assert.equal(calls[0].lat, 51.5089);
  assert.equal(calls[0].lng, -0.1241);

  assert.equal(payload.city.name, "London");
  assert.equal(payload.city.country, "UK");
  assert.equal(payload.works[0].title, "Skyfall");
  assert.equal(payload.works[0].place_count, 36);
  assert.equal(payload.points, 2300);
  assert.deepEqual([payload.page.page, payload.page.pages, payload.page.total], [1, 14, 656]);
});

test("the total rides on the rows, so one query answers both questions", async () => {
  // `count(*) over ()` is evaluated before LIMIT, which is what lets a 48-row page know
  // it is 48 of 656 without a second round trip.
  let calls = 0;
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({ loadCity: async () => { calls += 1; return [row()]; } }),
  });
  await handler(get("/api/directory/city?slug=london&page=3"));
  assert.equal(calls, 1);
});

test("a page past the end is re-asked at the first page rather than shown empty", async () => {
  // An empty page under a link we generated ourselves reads as lost data. This can only
  // be detected after the fact: an over-long offset returns no rows, and no rows carry
  // no total.
  const offsets = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    perPage: 48,
    createReader: () => ({
      loadCity: async ({ offset }) => {
        offsets.push(offset);
        return offset === 0 ? [row({ total_works: 12, total_points: 30 })] : [];
      },
    }),
  });

  const payload = await (await handler(get("/api/directory/city?slug=london&page=900"))).json();
  assert.deepEqual(offsets, [(900 - 1) * 48, 0]);
  assert.equal(payload.page.page, 1);
  assert.equal(payload.page.total, 12);
  assert.equal(payload.works.length, 1);
});

test("a city we hold nothing for is an empty page, not an error", async () => {
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => [] }),
  });
  const response = await handler(get("/api/directory/city?slug=jamestown"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.works, []);
  assert.equal(payload.page.total, 0);
});

test("a failing query is a 502 that says nothing about the database", async () => {
  const logged = [];
  const handler = createDirectoryCityHandler({
    env: ENV,
    createReader: () => ({ loadCity: async () => { throw new Error("connection refused at 10.0.0.4"); } }),
    logError: (...args) => logged.push(args),
  });
  const response = await handler(get("/api/directory/city?slug=london"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "The directory is unavailable");
  assert.equal(logged.length, 1);
});

test("no configuration is a 503 and not a crash", async () => {
  const handler = createDirectoryCityHandler({ env: {} });
  const response = await handler(get("/api/directory/city?slug=london"));
  assert.equal(response.status, 503);
});

// ---------- one letter ----------

test("an unknown letter is a 404 decided before any query", async () => {
  let asked = false;
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({ loadLetter: async () => { asked = true; return []; } }),
  });
  for (const slug of ["zz", "1", "", "%23"]) {
    assert.equal((await handler(get(`/api/directory/films?letter=${slug}`))).status, 404);
  }
  assert.equal(asked, false);
});

test("the other bucket is asked for as a null letter, not as '#'", async () => {
  // The function takes "anything that is not a single a-z character" as everything else,
  // which is the same rule letterBucket() applies on this side.
  const letters = [];
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({
      loadLetter: async ({ letter }) => {
        letters.push(letter);
        return [{ work_id: "x", title: "1917", title_norm: "1917", year: 2019, kind: "film", place_count: 4, total_works: 87 }];
      },
    }),
  });

  const payload = await (await handler(get("/api/directory/films?letter=other"))).json();
  assert.deepEqual(letters, ["#"]);
  assert.equal(payload.letter, "#");
  assert.equal(payload.works[0].title, "1917");
  assert.equal(payload.page.total, 87);
});

test("a letter page carries the work id the film card is addressed by", async () => {
  const handler = createDirectoryFilmsHandler({
    env: ENV,
    createReader: () => ({
      loadLetter: async () => [{
        work_id: "d0296dd7-a372-4fe1-869b-2e189a002cce",
        title: "Skyfall", title_norm: "skyfall", year: 2012, kind: "film",
        place_count: 36, total_works: 640,
      }],
    }),
  });
  const payload = await (await handler(get("/api/directory/films?letter=s"))).json();
  assert.equal(payload.works[0].id, "d0296dd7-a372-4fe1-869b-2e189a002cce");
});

// ---------- the index ----------

test("the index lists the gazetteer, and the database only says how much is in each", async () => {
  const handler = createDirectoryCitiesHandler({
    env: ENV,
    cities: [
      { slug: "london", name: "London", country: "UK", lat: 51.5089, lng: -0.1241, radius_km: 20 },
      { slug: "sofia", name: "Sofia", country: "Bulgaria", lat: 42.6932, lng: 23.325, radius_km: 20 },
    ],
    createReader: () => ({
      loadCityTotals: async () => [{ slug: "london", works: 656, points: 2300 }],
      loadLetterTotals: async () => [
        { letter: "s", works: 640, points: 3100 },
        { letter: "#", works: 87, points: 300 },
      ],
    }),
  });

  const payload = await (await handler(get("/api/directory/cities"))).json();

  // Sofia was not in the answer. It is shown at zero rather than dropped: a directory
  // that silently loses its empty entries is a directory that hides a broken query.
  assert.deepEqual(payload.cities.map((c) => [c.slug, c.works]), [["london", 656], ["sofia", 0]]);
  assert.equal(payload.letters.s, 640);
  assert.equal(payload.works, 727);
  // Both halves of the headline come from the letters, never one from the letters and the
  // other from the cities: 656 + 0 city points beside 727 works would be two different sets
  // in one sentence.
  assert.equal(payload.points, 3400);
});

test("the index sends anchors and not names", async () => {
  let sent = null;
  const handler = createDirectoryCitiesHandler({
    env: ENV,
    cities: [{ slug: "london", name: "London", country: "UK", lat: 51.5089, lng: -0.1241, radius_km: 20 }],
    createReader: () => ({
      loadCityTotals: async (anchors) => { sent = anchors; return []; },
      loadLetterTotals: async () => [],
    }),
  });
  await handler(get("/api/directory/cities"));
  assert.deepEqual(sent, [{ slug: "london", lat: 51.5089, lng: -0.1241, radius_km: 20 }]);
});

test("the index is cached at the edge, and its failures are not", async () => {
  // An ingest moves these numbers a few times a week; a stale count only understates
  // what we hold. An error cached for an hour is an outage that outlives its cause.
  const ok = createDirectoryCitiesHandler({
    env: ENV,
    cities: [],
    createReader: () => ({ loadCityTotals: async () => [], loadLetterTotals: async () => [] }),
  });
  const good = await ok(get("/api/directory/cities"));
  assert.match(good.headers.get("Cache-Control"), /max-age=3600/);

  const bad = createDirectoryCitiesHandler({
    env: ENV,
    cities: [],
    createReader: () => ({ loadCityTotals: async () => { throw new Error("nope"); }, loadLetterTotals: async () => [] }),
    logError: () => {},
  });
  const failed = await bad(get("/api/directory/cities"));
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("Cache-Control"), "private, no-store");
});
