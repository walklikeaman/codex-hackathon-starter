// The sitemap's one promise: a URL it prints is a URL the app serves (#158, and #129 step 4
// for the places). Every entry is built by the same function the page parses, so the tests
// here are about which pages are enumerated and where they land — never about spelling.
//
// The catalogue half is not reachable without a database, so these run with no Supabase
// configured: the film route answers 503, the loop stops, and what is left is exactly the
// fixed pages plus whatever places are handed in.

import assert from "node:assert/strict";
import test from "node:test";

import sitemap, { generateSitemaps, placesInTheGraph } from "../app/sitemap.js";
import { ALL_CITIES, cityPath } from "../app/lib/city-gazetteer.mjs";
import { DIRECTORY_LETTERS } from "../app/lib/directory.mjs";
import { placePath } from "../app/lib/place-url.mjs";

// Pinned rather than assumed. A shell with the team's .env exported would otherwise send
// the film loop at the real database, and a test suite that reaches the network is a test
// suite that passes or fails on the wifi.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const A = "40d442dd-257e-424b-8043-50677eb30ca6";
const B = "75f7b94d-feb7-429f-bcd9-3f1d02a589e5";

const noPlaces = async () => [];
const urls = (entries) => entries.map((entry) => entry.url);

// A route that hands back one page of places per call, in the shape the real one returns.
const routeReturning = (pages) => async (request) => {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const places = pages[page - 1] ?? [];
  return Response.json({ places, page: { page, hasNext: page < pages.length } });
};

test("the index is one file per letter, and '#' travels as a slug", () => {
  const ids = generateSitemaps().map((entry) => entry.id);
  assert.equal(ids.length, DIRECTORY_LETTERS.length);
  assert.ok(ids.includes("other"));
  assert.ok(!ids.includes("#"));
});

test("the fixed pages ride on the first file and nowhere else", async () => {
  const first = urls(await sitemap({ id: "a" }, { loadPlaces: noPlaces }));
  const second = urls(await sitemap({ id: "b" }, { loadPlaces: noPlaces }));

  // 84 of them, measured 10.09: the map, the directory, 27 letters and 55 cities.
  assert.equal(first.length, 2 + DIRECTORY_LETTERS.length + ALL_CITIES.length);
  assert.ok(first.some((url) => url.endsWith("/directory")));
  assert.ok(first.some((url) => url.endsWith(cityPath(ALL_CITIES[0]))));
  assert.deepEqual(second, []);
});

test("a place is addressed by placePath, absolutely, on the first file", async () => {
  const places = [{ id: A, name: "Trafalgar Square" }, { id: B, name: "Marseille" }];
  const first = urls(await sitemap({ id: "a" }, { loadPlaces: async () => places }));
  const second = urls(await sitemap({ id: "b" }, { loadPlaces: async () => places }));

  for (const place of places) {
    const url = first.find((candidate) => candidate.endsWith(placePath(place)));
    assert.ok(url, `no entry for ${place.name}`);
    // A relative URL in a sitemap is ignored by every crawler that reads it.
    assert.ok(new URL(url).protocol.startsWith("http"));
  }
  assert.deepEqual(second, []);
});

test("a place placePath cannot address is dropped rather than printed half-formed", async () => {
  // `/place/<not a uuid>` is a 404 by the page's own rule, so the URL must not exist. The
  // readable half is decorative: a place with no name keeps its address, unnamed.
  const entries = await sitemap(
    { id: "a" },
    { loadPlaces: async () => [{ id: "queue-row-17", name: "A candidate" }, { id: B, name: null }] },
  );
  const places = urls(entries).filter((url) => url.includes("/place/"));
  assert.deepEqual(places.map((url) => new URL(url).pathname), [`/place/${B}`]);
});

test("a place page is weighted like a work page, and expires like one", async () => {
  const entry = (await sitemap({ id: "a" }, { loadPlaces: async () => [{ id: A, name: "London" }] }))
    .find((candidate) => candidate.url.includes("/place/"));
  assert.equal(entry.priority, 0.6);
  assert.equal(entry.changeFrequency, "monthly");
});

test("the walk takes as many pages as the listing has", async () => {
  const places = await placesInTheGraph(routeReturning([
    [{ id: A, name: "London" }],
    [{ id: B, name: "Marseille" }],
  ]));
  assert.deepEqual(places.map((place) => place.name), ["London", "Marseille"]);
});

test("a listing that fails costs the places, never the deploy", async () => {
  // A sitemap that throws is a build that fails, and the fixed pages are still worth
  // serving. Both halves of that: the walk stops on a bad status, and a walk that throws
  // outright is caught by the file that asked for it.
  const stopped = await placesInTheGraph(async () => Response.json({ error: "no" }, { status: 502 }));
  assert.deepEqual(stopped, []);

  const entries = await sitemap({ id: "a" }, { loadPlaces: async () => { throw new Error("down"); } });
  assert.equal(entries.length, 2 + DIRECTORY_LETTERS.length + ALL_CITIES.length);
});
