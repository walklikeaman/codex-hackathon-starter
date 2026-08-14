import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LAYER_ID,
  MAP_LAYERS,
  layerById,
  readStoredLayerId,
  writeStoredLayerId,
} from "../app/lib/map-layers.mjs";
import {
  externalPlaceLinks,
  googleEarthUrl,
  googleMapsUrl,
  streetViewUrl,
} from "../app/lib/place-links.mjs";

// --- what we are allowed to draw the map on -------------------------------------

test("every basemap carries the attribution its provider requires", () => {
  // A tile layer with the attribution stripped is the same class of mistake as a place
  // with its source stripped.
  for (const layer of MAP_LAYERS) {
    assert.ok(layer.attribution && layer.attribution.length > 10, `${layer.id} has no attribution`);
    assert.match(layer.url, /^https:\/\//, `${layer.id} is not served over https`);
    assert.ok(layer.maxZoom >= 17, `${layer.id} stops zooming before a building is visible`);
  }
});

test("no basemap pulls tiles from a provider that forbids it", () => {
  // Google's tiles are not licensed outside Google's own APIs, and Apple's need a signed
  // MapKit token. The refusal is the same one the project already made about Reelstreets:
  // the terms forbid the act, whether or not anything is sold.
  for (const layer of MAP_LAYERS) {
    assert.ok(!/google\.com|googleapis|gstatic/.test(layer.url), `${layer.id} uses Google tiles`);
    assert.ok(!/apple\.com|mapkit/.test(layer.url), `${layer.id} uses Apple tiles`);
  }
});

test("the map opens on the layer the product is about", () => {
  // Dark first: the product is the pins and the route between them. Satellite is what you
  // switch to once you have found the pin you care about.
  assert.equal(layerById(DEFAULT_LAYER_ID).id, "dark");
  assert.ok(MAP_LAYERS.some((layer) => layer.id === "satellite"));
  assert.ok(MAP_LAYERS.some((layer) => layer.id === "street"));
});

test("an unknown stored layer falls back instead of blanking the map", () => {
  // A layer removed in a later release would otherwise leave anyone who had selected it
  // looking at nothing at all.
  assert.equal(layerById("apple_satellite").id, DEFAULT_LAYER_ID);
  assert.equal(layerById(null).id, DEFAULT_LAYER_ID);
  assert.equal(readStoredLayerId({ getItem: () => "no_such_layer" }), DEFAULT_LAYER_ID);
  assert.equal(readStoredLayerId({ getItem: () => "satellite" }), "satellite");
});

test("a browser with storage disabled still gets to switch layers", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(readStoredLayerId(throwing), DEFAULT_LAYER_ID);
  assert.doesNotThrow(() => writeStoredLayerId(throwing, "satellite"));
  assert.doesNotThrow(() => writeStoredLayerId(undefined, "satellite"));
});

test("only a known id is ever written", () => {
  let written = null;
  writeStoredLayerId({ setItem: (_k, v) => { written = v; } }, "nonsense");
  assert.equal(written, DEFAULT_LAYER_ID);
});

// --- the three ways to look at a place we do not host -----------------------------

const place = { name: "Alnwick Castle", lat: 55.4157, lng: -1.7057 };

test("a link names the place, not just its numbers", () => {
  // "51.5,-0.1" tells the person who follows the link nothing about what to look for.
  assert.match(googleMapsUrl(place), /Alnwick%20Castle/);
  assert.match(googleMapsUrl(place), /55\.4157/);
});

test("Street View opens the pavement, not the map", () => {
  // Without the pano action the link silently degrades to an ordinary map, which looks
  // like it worked.
  assert.match(streetViewUrl(place), /map_action=pano/);
  assert.match(streetViewUrl(place), /viewpoint=55\.4157,-1\.7057/);
});

test("Google Earth opens above the roofline", () => {
  assert.match(googleEarthUrl(place), /^https:\/\/earth\.google\.com\/web\/@55\.4157,-1\.7057,250a/);
  assert.match(googleEarthUrl(place, { altitudeMetres: 800 }), /,800a,/);
});

test("a place we cannot put on a map gets no links at all", () => {
  // Three links to nowhere is worse than none: each one looks like an answer.
  assert.equal(googleMapsUrl({ name: "Somewhere" }), null);
  assert.equal(streetViewUrl({ lat: 0, lng: 0 }), null);
  assert.equal(googleEarthUrl({ lat: 91, lng: 0 }), null);
  assert.deepEqual(externalPlaceLinks({ name: "Somewhere" }), []);
});

test("a usable place gets all three, in the order a visitor needs them", () => {
  const links = externalPlaceLinks(place);
  assert.deepEqual(links.map((link) => link.id), ["google_maps", "street_view", "google_earth"]);
  assert.ok(links.every((link) => link.url.startsWith("https://")));
});

test("nothing embeds imagery we are not licensed to embed", () => {
  // Deep links only: a link opens their product on their terms, which is what a link is
  // for. Pulling the imagery into our own map is not.
  for (const link of externalPlaceLinks(place)) {
    assert.ok(!/\/vt\?|staticmap|tile/.test(link.url), `${link.id} looks like an embed`);
  }
});
