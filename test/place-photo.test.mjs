import assert from "node:assert/strict";
import test from "node:test";

import { createPlacePhotoHandler } from "../app/api/place-photo/route.js";
import {
  bearingDelta,
  choosePlacePhoto,
  clampRadius,
  scoreCandidate,
  SOURCE_ORDER,
  STORABLE,
  streetViewEmbedUrl,
} from "../app/lib/place-photo.mjs";
import { bboxAround, parseMapillaryImages } from "../app/lib/mapillary.mjs";
import { parseCommonsGeosearch } from "../app/lib/commons-metadata.mjs";

const commonsCandidate = (overrides = {}) => ({
  image_url: "https://upload.wikimedia.org/a.jpg",
  distance_m: 40,
  compass_angle: null,
  attribution: { source: "wikimedia", author: "Jane Doe", license: "CC BY-SA 4.0" },
  ...overrides,
});

const mapillaryCandidate = (overrides = {}) => ({
  image_id: "123",
  image_url: "https://images.mapillary.com/123/thumb.jpg",
  distance_m: 60,
  compass_angle: 90,
  attribution: {
    source: "mapillary", author: "Mapillary contributors", license: "CC BY-SA 4.0",
  },
  ...overrides,
});

test("the cascade order is a licensing decision, and Street View is never storable", () => {
  assert.deepEqual(SOURCE_ORDER, ["mapillary", "wikimedia", "streetview"]);
  assert.equal(STORABLE.mapillary, true);
  assert.equal(STORABLE.wikimedia, true);
  // Google's terms forbid caching or saving Street View imagery — it may only ever
  // be a live embed, so it can never appear in a saved before/after composition.
  assert.equal(STORABLE.streetview, false);
});

test("a storable source wins even when a later source is closer", () => {
  const chosen = choosePlacePhoto({
    mapillary: [mapillaryCandidate({ distance_m: 90 })],
    wikimedia: [commonsCandidate({ distance_m: 5 })],
  });
  assert.equal(chosen.source, "mapillary"); // sources are not mixed
  assert.equal(chosen.storable, true);
});

test("a photo we cannot credit is dropped, not shown", () => {
  // Commons is licensed per file: without author + licence there is no lawful way
  // to display it, so the cascade must fall through to the next source.
  const chosen = choosePlacePhoto({
    wikimedia: [commonsCandidate({ attribution: { source: "wikimedia", author: null, license: null } })],
  });
  assert.equal(chosen, null);
});

test("the cascade falls through to the next source when the first cannot be credited", () => {
  const chosen = choosePlacePhoto({
    mapillary: [mapillaryCandidate({ attribution: { source: "mapillary", author: null, license: null } })],
    wikimedia: [commonsCandidate()],
  });
  assert.equal(chosen.source, "wikimedia");
  assert.equal(chosen.attribution.author, "Jane Doe");
});

test("a photo facing the frame's direction beats a slightly closer one facing away", () => {
  // This is the point of using compass_angle: a photo of the wrong wall is not a
  // photo of the place, however close it was taken.
  const facing = mapillaryCandidate({ image_id: "facing", distance_m: 70, compass_angle: 90 });
  const away = mapillaryCandidate({ image_id: "away", distance_m: 50, compass_angle: 270 });
  const chosen = choosePlacePhoto({ mapillary: [away, facing] }, { heading: 90 });
  assert.equal(chosen.image_id, "facing");
});

test("without a heading the nearest photo simply wins", () => {
  const near = mapillaryCandidate({ image_id: "near", distance_m: 20, compass_angle: 270 });
  const far = mapillaryCandidate({ image_id: "far", distance_m: 200, compass_angle: 90 });
  assert.equal(choosePlacePhoto({ mapillary: [far, near] }).image_id, "near");
});

test("bearingDelta takes the short way round the compass", () => {
  assert.equal(bearingDelta(10, 350), 20); // not 340
  assert.equal(bearingDelta(0, 180), 180);
  assert.equal(bearingDelta(90, null), null);
});

test("scoreCandidate penalises facing away but never more than 90", () => {
  const straight = scoreCandidate({ distance_m: 100, compass_angle: 90 }, { heading: 90 });
  const backwards = scoreCandidate({ distance_m: 100, compass_angle: 270 }, { heading: 90 });
  assert.equal(straight, 100);
  assert.equal(backwards, 190);
});

test("clampRadius keeps the search on the actual place", () => {
  assert.equal(clampRadius(50), 50);
  assert.equal(clampRadius(99999), 500);
  assert.equal(clampRadius("nonsense"), 120);
  assert.equal(clampRadius(-5), 120);
});

test("streetViewEmbedUrl only builds a LIVE embed, and only with a key", () => {
  const url = streetViewEmbedUrl({ lat: 51.5, lng: -0.12, heading: 90, key: "k" });
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/embed\/v1\/streetview\?/);
  assert.match(url, /location=51\.5%2C-0\.12/);
  // No key configured means no Street View at all, rather than a broken embed.
  assert.equal(streetViewEmbedUrl({ lat: 51.5, lng: -0.12, key: null }), null);
});

test("bboxAround widens longitude as latitude rises", () => {
  const london = bboxAround(51.5, -0.12, 100);
  const equator = bboxAround(0, 0, 100);
  const lngSpan = (box) => box.east - box.west;
  assert.ok(lngSpan(london) > lngSpan(equator)); // a degree of longitude is shorter up north
});

test("parseMapillaryImages keeps the image id, because preview urls expire", () => {
  const [candidate] = parseMapillaryImages({
    data: [{
      id: "999", compass_angle: 42, thumb_1024_url: "https://images.mapillary.com/999.jpg",
      computed_geometry: { coordinates: [-0.12, 51.5] },
    }],
  }, { lat: 51.5, lng: -0.12 });

  assert.equal(candidate.image_id, "999"); // the durable handle
  assert.equal(candidate.compass_angle, 42);
  assert.equal(candidate.attribution.license, "CC BY-SA 4.0");
  assert.ok(candidate.distance_m >= 0);
});

test("parseMapillaryImages skips entries with no usable geometry or url", () => {
  const parsed = parseMapillaryImages({
    data: [
      { id: "1" },
      { id: "2", thumb_1024_url: "https://x/2.jpg" },
      { id: "3", thumb_1024_url: "https://x/3.jpg", computed_geometry: { coordinates: ["a", "b"] } },
    ],
  }, { lat: 0, lng: 0 });
  assert.deepEqual(parsed, []);
});

test("parseCommonsGeosearch returns candidates carrying their own licence", () => {
  const [candidate] = parseCommonsGeosearch({
    query: { pages: { "1": {
      title: "File:Square.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/thumb.jpg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Square.jpg",
        extmetadata: {
          Artist: { value: "<a href='#'>CGP Grey</a>" },
          LicenseShortName: { value: "CC BY 2.0" },
        },
      }],
    } } },
  });
  assert.equal(candidate.attribution.author, "CGP Grey");
  assert.equal(candidate.attribution.license, "CC BY 2.0");
});

// --- route -------------------------------------------------------------------

const photoRequest = (query) =>
  new Request(`http://localhost/api/place-photo?${new URLSearchParams(query)}`);

test("place photo route rejects a missing or absurd coordinate", async () => {
  // An absent coordinate must NOT become 0,0: Number(null) is 0, which would send us
  // looking for photos in the Gulf of Guinea instead of answering 400.
  const handler = createPlacePhotoHandler({ env: {}, fetchImpl: async () => new Response("{}") });
  assert.equal((await handler(photoRequest({}))).status, 400);
  assert.equal((await handler(photoRequest({ lat: "", lng: "" }))).status, 400);
  assert.equal((await handler(photoRequest({ lat: "51.5" }))).status, 400); // lng missing
  assert.equal((await handler(photoRequest({ lat: "91", lng: "0" }))).status, 400);
});

test("place photo route returns a credited photo and says whether it may be stored", async () => {
  const handler = createPlacePhotoHandler({
    env: {},
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes("commons.wikimedia.org")) {
        return new Response(JSON.stringify({
          query: { pages: { "1": {
            title: "File:Square.jpg",
            imageinfo: [{
              thumburl: "https://upload.wikimedia.org/thumb.jpg",
              extmetadata: {
                Artist: { value: "CGP Grey" },
                LicenseShortName: { value: "CC BY 2.0" },
              },
            }],
          } } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
    logError: () => {},
  });

  const body = await (await handler(photoRequest({ lat: "51.508", lng: "-0.128" }))).json();
  assert.equal(body.photo.source, "wikimedia");
  assert.equal(body.photo.storable, true);
  assert.equal(body.photo.attribution.author, "CGP Grey");
});

test("with nothing creditable the route offers Street View as a LIVE embed only", async () => {
  const handler = createPlacePhotoHandler({
    env: { GOOGLE_MAPS_EMBED_KEY: "k" },
    fetchImpl: async () => new Response(JSON.stringify({ data: [], query: { pages: {} } }), { status: 200 }),
    logError: () => {},
  });
  const body = await (await handler(photoRequest({ lat: "51.5", lng: "-0.12" }))).json();

  assert.equal(body.photo, null);
  assert.equal(body.reason, "live_street_view_only");
  assert.match(body.street_view.embed_url, /maps\/embed\/v1\/streetview/);
  // The contract that keeps it out of saved compositions.
  assert.equal(body.street_view.storable, false);
});

test("one failing source does not sink the request", async () => {
  const handler = createPlacePhotoHandler({
    env: { MAPILLARY_TOKEN: "t" },
    fetchImpl: async (url) => {
      if (String(url).includes("mapillary")) throw new Error("mapillary down");
      return new Response(JSON.stringify({
        query: { pages: { "1": {
          title: "File:A.jpg",
          imageinfo: [{
            thumburl: "https://upload.wikimedia.org/a.jpg",
            extmetadata: { Artist: { value: "Jane" }, LicenseShortName: { value: "CC0" } },
          }],
        } } },
      }), { status: 200 });
    },
    logError: () => {},
  });
  const body = await (await handler(photoRequest({ lat: "51.5", lng: "-0.12" }))).json();
  assert.equal(body.photo.source, "wikimedia"); // degraded, not failed
});
