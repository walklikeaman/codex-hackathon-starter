import test from "node:test";
import assert from "node:assert/strict";

import {
  ATTRIBUTION,
  DEFAULT_THEME,
  SATELLITE,
  THEMES,
  THEME_STORAGE_KEY,
  basemapChain,
  basemapFor,
  fallbackBasemap,
  isUsableKey,
  readStoredTheme,
  styleProvider,
  styleUrl,
  writeStoredTheme,
} from "../app/lib/map-styles.mjs";

// The rule the whole module exists for: no key must never mean no map.
test("with no key at all the map still has a style to draw", () => {
  const dark = styleUrl(THEMES.dark, undefined);
  const light = styleUrl(THEMES.light, null);
  assert.match(dark, /^https:\/\/tiles\.openfreemap\.org\//);
  assert.match(light, /^https:\/\/tiles\.openfreemap\.org\//);
  assert.notEqual(dark, light);
});

test("a key switches both themes to MapTiler and carries the key", () => {
  assert.match(styleUrl(THEMES.dark, "abc123"), /^https:\/\/api\.maptiler\.com\/.*[?&]key=abc123$/);
  assert.match(styleUrl(THEMES.light, "abc123"), /^https:\/\/api\.maptiler\.com\/.*[?&]key=abc123$/);
});

// A pasted dashboard URL rather than the key out of it produces a request that fails at the
// provider with no useful message. Better to fall back to a map that works.
test("a pasted URL is not a key, and falls back rather than building a broken one", () => {
  for (const notAKey of ["https://api.maptiler.com/?key=abc", "abc 123", "abc#frag", "", "   "]) {
    assert.equal(isUsableKey(notAKey), false, `${notAKey} should be refused`);
    assert.match(styleUrl(THEMES.dark, notAKey), /openfreemap/);
  }
});

test("an absurdly long key is refused rather than sent", () => {
  assert.equal(isUsableKey("a".repeat(129)), false);
});

test("a normal key is accepted", () => {
  assert.equal(isUsableKey("AbC_123-xyz"), true);
});

test("the provider is named, so the map can say why it looks as it does", () => {
  assert.equal(styleProvider("abc123"), "maptiler");
  assert.equal(styleProvider(null), "openfreemap");
});

// Attribution is not decoration. Whoever actually served the tiles is who gets credited.
test("the credit follows the provider that actually answered", () => {
  assert.equal(basemapFor(THEMES.dark, "abc123").attribution, ATTRIBUTION.maptiler);
  assert.equal(basemapFor(THEMES.dark, null).attribution, ATTRIBUTION.openfreemap);
  assert.match(ATTRIBUTION.openfreemap, /OpenStreetMap/);
  assert.match(ATTRIBUTION.maptiler, /OpenStreetMap/);
});

test("basemapFor answers with the theme it actually resolved, not the one asked for", () => {
  assert.equal(basemapFor("nonsense", null).theme, THEMES.dark);
  assert.equal(basemapFor(THEMES.light, null).theme, THEMES.light);
});

test("the map opens dark, because the product is the pins", () => {
  assert.equal(DEFAULT_THEME, THEMES.dark);
});

// Imagery is imagery: there is nothing to style, and Esri's is free with attribution.
test("satellite stays Esri raster and keeps its required credit", () => {
  assert.match(SATELLITE.tiles, /arcgisonline\.com/);
  assert.equal(SATELLITE.attribution, ATTRIBUTION.esri);
  assert.match(SATELLITE.attribution, /Esri/);
});

test("a remembered theme comes back, and an unknown one does not blank the map", () => {
  const store = new Map([[THEME_STORAGE_KEY, THEMES.light]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readStoredTheme(storage), THEMES.light);

  store.set(THEME_STORAGE_KEY, "chartreuse");
  assert.equal(readStoredTheme(storage), DEFAULT_THEME);
});

test("the choice survives a write and a read", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  writeStoredTheme(storage, THEMES.light);
  assert.equal(readStoredTheme(storage), THEMES.light);
});

// Private browsing, or storage switched off. Not being able to remember a choice must not
// stop somebody making it, and must not throw into the render.
test("storage that throws gives the default rather than an exception", () => {
  const hostile = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  assert.equal(readStoredTheme(hostile), DEFAULT_THEME);
  assert.doesNotThrow(() => writeStoredTheme(hostile, THEMES.light));
});

test("no storage at all is the same as storage with nothing in it", () => {
  assert.equal(readStoredTheme(undefined), DEFAULT_THEME);
  assert.doesNotThrow(() => writeStoredTheme(undefined, THEMES.dark));
});

// A rejected key is worse than a missing one: `styleUrl` cannot see an origin rejection,
// because it happens at the network. Vercel gives every preview deployment its own
// subdomain, so a key locked to the production domain fails on every pull request.
test("a key yields a chain that ends somewhere needing no key", () => {
  const chain = basemapChain(THEMES.dark, "abc123");
  assert.equal(chain.length, 2);
  assert.equal(chain[0].provider, "maptiler");
  assert.equal(chain[chain.length - 1].provider, "openfreemap");
});

test("no key yields a chain of one — there is nothing to fall back from", () => {
  const chain = basemapChain(THEMES.dark, null);
  assert.deepEqual(chain.map((step) => step.provider), ["openfreemap"]);
});

test("the chain keeps the theme that was asked for at every step", () => {
  for (const step of basemapChain(THEMES.light, "abc123")) {
    assert.equal(step.theme, THEMES.light);
  }
});

test("every step of the chain carries the credit for whoever serves it", () => {
  const [preferred, floor] = basemapChain(THEMES.dark, "abc123");
  assert.equal(preferred.attribution, ATTRIBUTION.maptiler);
  assert.equal(floor.attribution, ATTRIBUTION.openfreemap);
});

test("the floor needs no credentials, so it cannot fail the way the first step can", () => {
  assert.match(fallbackBasemap(THEMES.dark).url, /openfreemap/);
  assert.doesNotMatch(fallbackBasemap(THEMES.light).url, /key=/);
});
