// What the map is drawn on, and what we are allowed to draw it on.
//
// The map has had ONE hardcoded basemap since it was written: CARTO's dark tiles. That is
// a good backdrop for pins and a bad one for the product's actual question, which is not
// "where is this" but **"is this the building I saw in the film"**. You cannot answer that
// on a grey street map. A satellite image and a street map answer different halves of it:
// the roof and the footprint from above, the street name and the doorway from the side.
//
// LICENCE IS THE WHOLE CONSTRAINT HERE, and it is why this list is three entries and not
// the five a reference site shows.
//
//   * **Google satellite tiles are refused.** They are not licensed for use outside
//     Google's own APIs, and pulling `mt1.google.com/vt` into a Leaflet layer is a terms
//     breach whether or not anything is sold. This is the same ruling the project already
//     made about Doctor Who Locations Guide and Reelstreets: the terms forbid the ACT.
//   * **Apple's satellite needs MapKit JS and a signed token.** Not refused on principle,
//     simply not available without a developer key and a server to sign with — so it is
//     absent rather than broken.
//   * **Esri World Imagery is free to use with attribution**, which is why the satellite
//     layer here is Esri's.
//
// Attribution is not decoration. Every entry carries the text its provider requires, and
// the component renders it — a tile layer with the attribution stripped is the same class
// of mistake as a place with its source stripped.
//
// ---------------------------------------------------------------------------------------
//
// **CARTO was removed on 11.09.2026 because it stopped being free.** Every tile it serves
// without a key now arrives with `API KEY REQUIRED / carto.com/basemaps/apikey` burned
// diagonally across the image. Not an error, not a 403 — a 200 with the words painted into
// the PNG, so the map looked broken while every check said it was fine. The legacy
// `cartodb-basemaps-*.global.ssl.fastly.net` endpoint is watermarked identically.
//
// **What replaced it, and what did not:**
//
//   * **Esri's Dark Gray Canvas was the obvious swap and it fails where it matters.** It is
//     clean and dark at city zoom, and at z18 it returns a light grey tile reading "Map
//     data not yet available". z18-19 is precisely where this product works — somebody
//     standing at a doorway comparing it with a frame — so a basemap that gives up at z16
//     is no basemap for it.
//   * **Every keyed provider is out for now** — Stadia, Thunderforest, MapTiler, Jawg and
//     CARTO's own free tier all need an account. Not refused on principle; simply not
//     something to require before the app can draw a map.
//
// So the dark layer is **OpenStreetMap's own tiles, rendered dark in the browser**. Same
// tiles as the street layer, same attribution, one CSS filter. It is honest — nothing is
// restyled server-side and nothing is re-hosted — and it costs no key and no signup.
//
// **The real limit, stated rather than discovered later:** OSM's tile usage policy is
// written for low-volume use and asks heavy consumers to move to a keyed provider or to
// self-host. This is fine for an app with one user testing Los Angeles and is NOT fine at
// scale. The day traffic justifies it, the fix is a key in `url` — the shape of this file
// does not change.

export const MAP_LAYERS = Object.freeze([
  {
    id: "dark",
    label: "Dark",
    hint: "Pins first, city second",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    // Applied to the tile images in the browser. The tiles arrive exactly as OSM served
    // them; only the rendering is inverted, which is why the attribution is unchanged and
    // no second provider appears in it.
    filter: "invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.85) saturate(0.35)",
    maxZoom: 19,
  },
  {
    id: "satellite",
    label: "Satellite",
    hint: "The roof and the footprint",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  {
    id: "street",
    label: "Street",
    hint: "Street names and doorways",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
]);

// The one the map opens on. Dark, because the product is the pins and the route between
// them; satellite is what you switch to once you have found the pin you care about.
export const DEFAULT_LAYER_ID = "dark";

export function layerById(id) {
  return MAP_LAYERS.find((layer) => layer.id === id) ?? MAP_LAYERS.find((layer) => layer.id === DEFAULT_LAYER_ID);
}

// Remembering the choice is the point: somebody comparing a frame with a facade switches
// to satellite once and should not have to switch again at every pin. Stored per browser,
// never per account — it is a preference about a screen, not a fact about a person.
export const LAYER_STORAGE_KEY = "glorymap.basemap";

export function readStoredLayerId(storage) {
  try {
    const stored = storage?.getItem?.(LAYER_STORAGE_KEY);
    // An unknown id must not blank the map: a layer removed in a later release would
    // otherwise leave anyone who had selected it looking at nothing.
    return layerById(stored).id;
  } catch {
    return DEFAULT_LAYER_ID;
  }
}

export function writeStoredLayerId(storage, id) {
  try {
    storage?.setItem?.(LAYER_STORAGE_KEY, layerById(id).id);
  } catch {
    // A browser with storage disabled still gets to switch layers, it just forgets.
  }
}
