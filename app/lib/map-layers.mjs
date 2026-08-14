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

export const MAP_LAYERS = Object.freeze([
  {
    id: "dark",
    label: "Dark",
    hint: "Pins first, city second",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> '
      + '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
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
