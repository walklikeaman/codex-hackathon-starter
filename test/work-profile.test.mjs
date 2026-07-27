import assert from "node:assert/strict";
import test from "node:test";

import { createWorkProfileHandler } from "../app/api/work/route.js";
import {
  MAX_PROFILE_PLACES,
  parseProfileQuery,
  placeRole,
  placeSummary,
  placeTally,
  precisionBadge,
  profilePlaces,
  profileRatings,
  sortPlaces,
  sourceLinks,
} from "../app/lib/work-profile.mjs";

const params = (query) => new URL(`http://x/?${query}`).searchParams;

const place = (overrides = {}) => ({
  id: "p1", name: "Leadenhall Market", city: "London", country: "United Kingdom",
  lat: 51.5127, lng: -0.0835, place_class: "real_exterior",
  geocode_precision: "point", confidence: 0.9, wikidata_id: "Q961148",
  relation_kind: "filming_location", ...overrides,
});

// --- the studio distinction, taken from data instead of the name ---------------

test("a studio is identified by its class, not by the word 'studio'", () => {
  // The scene-image matcher tested /studio/i against the NAME, which calls the
  // "Studio Ghibli Museum" a soundstage and misses any lot without the word.
  const museum = place({ name: "Studio Ghibli Museum", place_class: "real_exterior" });
  assert.equal(placeRole(museum).role, "on_location");

  const lot = place({ name: "Leavesden", place_class: "studio_interior" });
  assert.equal(placeRole(lot).role, "studio");
});

test("a studio pin is real, but it says it depicts somewhere else", () => {
  // The product's rule: mark it and show the studio's own geography.
  const summary = placeSummary(place({ name: "Pinewood Studios", place_class: "studio_interior" }));
  assert.equal(summary.depicts_elsewhere, true);
  assert.equal(summary.role_label, "Filmed at a studio");
  assert.equal(summary.lat, 51.5127); // still a real coordinate
});

test("filmed here and set here are different claims", () => {
  assert.equal(placeRole(place({ relation_kind: "narrative_location" })).role, "narrative");
  assert.equal(placeSummary(place({ relation_kind: "narrative_location" })).depicts_elsewhere, false);
  assert.equal(placeRole(place()).role, "on_location");
});

test("a fictional place is never presented as mappable", () => {
  const role = placeRole(place({ name: "Hogwarts", place_class: "fictional" }));
  assert.equal(role.role, "fictional");
  assert.equal(role.mappable, false);
});

test("an unclassified place says so rather than claiming a location", () => {
  assert.equal(placeRole(place({ place_class: "unknown" })).role, "unknown");
  assert.equal(placeRole({}).role, "unknown");
});

// --- precision -----------------------------------------------------------------

test("the badge reports how well we know WHERE", () => {
  assert.equal(precisionBadge(place({ geocode_precision: "city" })), "City only");
  assert.equal(precisionBadge(place({ geocode_precision: "street" })), "Street");
  assert.equal(precisionBadge(place({ geocode_precision: "point" })), "Exact point");
  assert.equal(precisionBadge(place({ geocode_precision: "country" })), "Region only");
  assert.equal(precisionBadge({}), "Unknown precision");
});

test("a snapped building outranks whatever the geocoder claimed", () => {
  // The footprint snap is stronger evidence than the precision string it inherited.
  const snapped = place({ geocode_precision: "city", osm_building_id: "way/88313379" });
  assert.equal(precisionBadge(snapped), "Building");
});

// --- ordering ------------------------------------------------------------------

test("places we actually found come before studios and story settings", () => {
  // "We found the street" is the answer; a studio pin is real but is not that.
  const ordered = sortPlaces([
    placeSummary(place({ id: "n", relation_kind: "narrative_location" })),
    placeSummary(place({ id: "s", place_class: "studio_interior" })),
    placeSummary(place({ id: "r" })),
  ]);
  assert.deepEqual(ordered.map((p) => p.id), ["r", "s", "n"]);
});

test("the tally counts each kind of claim separately", () => {
  const tally = placeTally(profilePlaces([
    place({ id: "a" }), place({ id: "b" }),
    place({ id: "c", place_class: "studio_interior" }),
    place({ id: "d", relation_kind: "narrative_location" }),
  ]));
  assert.equal(tally.on_location, 2);
  assert.equal(tally.studio, 1);
  assert.equal(tally.narrative, 1);
});

test("the place list is bounded", () => {
  const many = Array.from({ length: MAX_PROFILE_PLACES + 30 }, (_, i) => place({ id: `p${i}` }));
  assert.equal(profilePlaces(many).length, MAX_PROFILE_PLACES);
  assert.deepEqual(profilePlaces(null), []);
});

// --- links ---------------------------------------------------------------------

test("every external source is a link, never borrowed content", () => {
  // IMDb's terms forbid extracting their material; pointing at it is fine.
  const links = sourceLinks({
    kind: "film", tmdb_id: "509", imdb_id: "tt0125439",
    rt_path: "m/notting_hill", mc_path: "movie/notting-hill", wikidata_id: "Q217628",
  });
  const byLabel = Object.fromEntries(links.map((l) => [l.label, l.url]));
  assert.match(byLabel.IMDb, /imdb\.com\/title\/tt0125439/);
  assert.match(byLabel["Rotten Tomatoes"], /rottentomatoes\.com\/m\/notting_hill/);
  assert.match(byLabel.Metacritic, /metacritic\.com\/movie\/notting-hill/);
  assert.match(byLabel.TMDB, /themoviedb\.org\/movie\/509/);
});

test("a series links to the tv page, not the movie page", () => {
  const links = sourceLinks({ kind: "series", tmdb_id: "19885" });
  assert.match(links.find((l) => l.label === "TMDB").url, /\/tv\/19885/);
});

test("missing identifiers simply produce no link", () => {
  assert.deepEqual(sourceLinks({ kind: "film" }), []);
  assert.deepEqual(sourceLinks(null), []);
});

test("a rating carries the page it came from", () => {
  const ratings = profileRatings([
    { source: "imdb", display: "7.1/10", score: 7.1, votes: 300000, source_url: "https://www.imdb.com/title/tt0125439/" },
    { source: "broken", display: null, score: null },
  ]);
  assert.equal(ratings.length, 1);
  assert.match(ratings[0].url, /imdb\.com/);
});

// --- the query -----------------------------------------------------------------

test("a profile is addressed by TMDB id, because that is what a live chip has", () => {
  assert.deepEqual(parseProfileQuery(params("film=509")), { kind: "film", tmdbId: "509" });
  assert.deepEqual(parseProfileQuery(params("series=19885")), { kind: "series", tmdbId: "19885" });
  assert.equal(parseProfileQuery(params("film=abc")), null);
  assert.equal(parseProfileQuery(params("")), null);
});

// --- the route -----------------------------------------------------------------

const WORK = { id: "w1", title: "Notting Hill", kind: "film", year: 1999, tmdb_id: "509",
  imdb_id: "tt0125439", wikidata_id: "Q217628", poster_path: "/p.jpg", rt_path: "m/notting_hill" };

function handlerWith(overrides = {}) {
  const calls = { tmdb: [] };
  const handler = createWorkProfileHandler({
    env: { NEXT_PUBLIC_SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k",
      TMDB_API_READ_ACCESS_TOKEN: "t", ...overrides.env },
    createStore: overrides.createStore ?? (() => ({
      loadWork: async () => ("work" in overrides ? overrides.work : WORK),
      loadRatings: async () => overrides.ratings ?? [],
      loadPlaces: async () => overrides.places ?? [],
    })),
    fetchImpl: overrides.fetchImpl ?? (async (url) => {
      calls.tmdb.push(url);
      return { ok: true, json: async () => ({ backdrops: [{ file_path: "/still.jpg", vote_count: 9, width: 1920, height: 1080 }] }) };
    }),
    logError: () => {},
  });
  return { handler, calls };
}

const request = (query) => new Request(`http://localhost/api/work?${query}`);

test("a work we hold returns its places, ratings and links", async () => {
  const { handler } = handlerWith({
    places: [place(), place({ id: "p2", place_class: "studio_interior", name: "Shepperton" })],
    ratings: [{ source: "imdb", display: "7.1/10", score: 7.1, source_url: "https://www.imdb.com/title/tt0125439/" }],
  });
  const body = await (await handler(request("film=509"))).json();

  assert.equal(body.work.title, "Notting Hill");
  assert.equal(body.work.in_graph, true);
  assert.equal(body.places.length, 2);
  assert.equal(body.tally.on_location, 1);
  assert.equal(body.tally.studio, 1);
  assert.ok(body.links.some((l) => l.label === "IMDb"));
  assert.equal(body.ratings.length, 1);
});

test("a film we do NOT hold still gets a profile instead of an empty page", async () => {
  // Most chips come from the live Wikidata path and are not in our graph.
  const { handler } = handlerWith({ work: null });
  const body = await (await handler(request("film=27205"))).json();

  assert.equal(body.work.in_graph, false);
  assert.equal(body.work.tmdb_id, "27205");
  assert.deepEqual(body.places, []);
  assert.equal(body.stills.length, 1); // stills still arrive
  assert.ok(body.links.some((l) => l.label === "TMDB"));
});

test("stills are labelled as belonging to the film, not to a place", async () => {
  // Tier B of the stills policy: real frames, unverified location. Pinning them to a
  // street would be an invention.
  const { handler } = handlerWith();
  const body = await (await handler(request("film=509"))).json();

  assert.match(body.stills_note, /not matched to a location/i);
  assert.match(body.stills[0].url, /image\.tmdb\.org/);
  assert.equal(body.stills[0].place_id, undefined);
});

test("a broken graph still returns the stills rather than failing the page", async () => {
  const { handler } = handlerWith({
    createStore: () => ({
      loadWork: async () => { throw new Error("db down"); },
      loadRatings: async () => [], loadPlaces: async () => [],
    }),
  });
  const response = await handler(request("film=509"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stills.length, 1);
  assert.equal(body.work.in_graph, false);
});

test("TMDB being unavailable loses the stills, not the profile", async () => {
  const { handler } = handlerWith({ places: [place()], fetchImpl: async () => ({ ok: false, status: 503 }) });
  const body = await (await handler(request("film=509"))).json();
  assert.deepEqual(body.stills, []);
  assert.equal(body.places.length, 1);
});

test("a rejected bearer token falls back to the api_key scheme", async () => {
  const { handler, calls } = handlerWith({
    env: { TMDB_API_READ_ACCESS_TOKEN: "wrong", TMDB_API_KEY: "right" },
    fetchImpl: async (url, init) => {
      calls.tmdb.push(url);
      if (init.headers.Authorization) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ backdrops: [{ file_path: "/k.jpg", vote_count: 1 }] }) };
    },
  });
  const body = await (await handler(request("film=509"))).json();
  assert.equal(body.stills.length, 1);
  assert.match(calls.tmdb[1], /api_key=right/);
});

test("a request without an id is rejected before any work is done", async () => {
  const { handler, calls } = handlerWith();
  assert.equal((await handler(request(""))).status, 400);
  assert.equal(calls.tmdb.length, 0);
});
