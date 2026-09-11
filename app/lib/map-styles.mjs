// What the map is drawn on, once MapLibre is the engine drawing it (#202).
//
// This module exists ahead of the migration because it is the part that has a decision in
// it rather than a mechanism: WHICH provider, on WHAT licence, and what happens when the
// key is missing. The engine swap can then be a mechanical change against a settled answer.
//
// ---------------------------------------------------------------------------------------
//
// **Google was evaluated and rejected** (#200), and the reasons are recorded here because
// the question will be asked again by somebody who has not read the issue:
//
//   * Google's tiles are not licensed outside Google's own APIs. Pointing a tile layer at
//     `mt1.google.com/vt` is a terms breach whether or not anything is sold.
//   * Using them legitimately means the Maps JavaScript API: their engine, a key, and a
//     bill — 10,000 map loads a month free, then $7 per 1,000.
//   * **Their terms prohibit caching their content**, which collides with the image cache
//     (#198) and makes offline tours (#70) impossible by licence rather than by code.
//   * It would not have fixed the thing we were trying to fix: Google's markers are DOM
//     elements too, so the ~30 fps drag with 1,008 pins would have survived the move.
//
// **Apple's MapKit JS** is not refused on principle — it needs a developer key and a server
// to sign tokens with, so it is absent rather than forbidden.
//
// ---------------------------------------------------------------------------------------
//
// **Two providers, and the fallback is the point.** MapTiler is the chosen source because
// its style editor is the fastest way to a map that is deliberately black-and-yellow rather
// than a borrowed dark theme. But a missing key must never produce a blank map: OpenFreeMap
// serves the same vector tiles free, with no key, no signup and no usage limit, so it is
// what the app draws when nobody has configured anything. A reader who clones this
// repository gets a working map.

// Set `NEXT_PUBLIC_MAPTILER_KEY` to switch to the designed styles. It is a PUBLIC key by
// design — it ships in the browser bundle, and MapTiler restricts it by domain in their own
// dashboard, which is where that restriction belongs. It is not a secret, and treating it
// as one would mean proxying every tile through our own server for nothing.
const MAPTILER_STYLES = Object.freeze({
  dark: "https://api.maptiler.com/maps/dataviz-dark/style.json",
  light: "https://api.maptiler.com/maps/dataviz-light/style.json",
});

// No key, no signup, no limit, and rendered on the client so it is sharp at any zoom and
// any pixel density by construction rather than by buying a bigger bitmap.
const OPENFREEMAP_STYLES = Object.freeze({
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
});

export const THEMES = Object.freeze({ dark: "dark", light: "light" });

// Dark, because the product is the pins and the route between them — the map is the ground
// they sit on, and a bright ground competes with them for the eye.
export const DEFAULT_THEME = THEMES.dark;

// Attribution is not decoration. A tile layer with the attribution stripped is the same
// class of mistake as a place with its source stripped, so every entry carries the text its
// provider requires and the component renders it.
export const ATTRIBUTION = Object.freeze({
  maptiler: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> '
    + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  openfreemap: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
    + '&copy; <a href="https://openfreemap.org">OpenFreeMap</a>',
  esri: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
});

// Esri's World Imagery is free to use with attribution, which is why the satellite layer is
// Esri's — and why it does not move to MapTiler with the rest. Imagery is imagery: it is
// already photographs, so there is nothing about it to style, and it looks the same on any
// engine. It stays raster.
export const SATELLITE = Object.freeze({
  id: "satellite",
  label: "Satellite",
  hint: "The roof and the footprint",
  tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: ATTRIBUTION.esri,
  maxZoom: 19,
});

function normaliseTheme(theme) {
  return theme === THEMES.light ? THEMES.light : THEMES.dark;
}

// A key with a `?`, a space or a fragment in it is somebody pasting a whole dashboard URL
// rather than the key out of it. Appending that to a style URL produces a request that
// fails at the provider with no useful message, so it is refused here where the cause is
// still visible.
export function isUsableKey(key) {
  return typeof key === "string"
    && key.length > 0
    && key.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(key);
}

// Which provider a given configuration actually reaches. Separate from the URL builder so a
// caller can say WHY the map looks the way it does — and so the attribution can be right
// without re-deriving it from the URL.
export function styleProvider(key) {
  return isUsableKey(key) ? "maptiler" : "openfreemap";
}

export function styleUrl(theme, key) {
  const wanted = normaliseTheme(theme);
  if (!isUsableKey(key)) return OPENFREEMAP_STYLES[wanted];
  return `${MAPTILER_STYLES[wanted]}?key=${encodeURIComponent(key)}`;
}

// Everything a map needs to draw one theme, in one object: the style, who to credit, and
// which provider answered. Built here rather than in the component so the component has no
// opinion about licensing.
export function basemapFor(theme, key) {
  const provider = styleProvider(key);
  return {
    theme: normaliseTheme(theme),
    provider,
    url: styleUrl(theme, key),
    attribution: ATTRIBUTION[provider],
  };
}

// Remembering the choice is the point: somebody comparing a frame with a facade switches
// once and should not have to switch again at every pin. Stored per browser, never per
// account — it is a preference about a screen, not a fact about a person.
export const THEME_STORAGE_KEY = "glorymap.maptheme";

export function readStoredTheme(storage) {
  try {
    // An unknown value must not blank the map: a theme removed in a later release would
    // otherwise leave anyone who had selected it looking at nothing.
    return normaliseTheme(storage?.getItem?.(THEME_STORAGE_KEY));
  } catch {
    // Private browsing, or storage switched off. A preference that cannot be read is not
    // an error — it is a reader who gets the default.
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, normaliseTheme(theme));
  } catch {
    // Not being able to REMEMBER the choice must not stop somebody MAKING it.
  }
}
