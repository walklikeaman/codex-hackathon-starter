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
// **CARTO was removed on 11.09 because it stopped being free**, and the OSM raster that
// replaced it was replaced again the same day because it looked bad. Both facts are worth
// keeping, because the second one has a cause people usually guess wrong.
//
// CARTO's URL ended `{z}/{x}/{y}{r}.png`, and Leaflet expands `{r}` to `@2x` on a
// high-DPI screen. **We were serving retina tiles and did not know it.** OSM's standard
// tileset has no @2x, so every tile arrived at 256 px and was upscaled to 512 — which is
// exactly what "низкое разрешение" looks like. Inverting them for a dark theme made it
// worse: `invert()` on a bitmap muddies every colour it touches.
//
// So the dark layer is **vector**, from [OpenFreeMap](https://openfreemap.org): free,
// **no key, no signup, no usage limit**, and rendered on the client, so it is sharp at any
// zoom and any pixel density by construction rather than by buying a bigger bitmap. Its
// `dark` style is a dark-matter descendant — background `rgb(12,12,12)` — which is the
// look CARTO had.
//
// **What that costs:** `maplibre-gl` is ~800 kB and only the dark layer needs it, so it is
// loaded lazily, when that layer is first shown. A reader who stays on satellite never
// downloads it.
//
// The raster entries stay raster. Esri's imagery is the satellite layer and has no vector
// equivalent that is free; OSM's own raster is kept as the plain "Street" layer, where the
// upscaling matters far less than it does under a dark theme.
//
//   * **Google satellite tiles are refused.** Not licensed outside Google's own APIs, and
//     pulling `mt1.google.com/vt` into Leaflet is a terms breach whether or not anything is
//     sold — the same ruling made about Doctor Who Locations Guide and Reelstreets.
//   * **Apple's satellite needs MapKit JS and a signed token.** Not refused on principle;
//     simply not available without a developer key and a server to sign with.
//   * **Esri World Imagery is free with attribution**, which is why satellite is Esri's.
//
// Attribution is not decoration. Every entry carries the text its provider requires and the
// component renders it — a tile layer with the attribution stripped is the same class of
// mistake as a place with its source stripped.

// **There were four layers and there are three.** The raster "Street" layer was OpenStreetMap's
// own 256 px tileset, and it was the last raster basemap left — upscaled on every retina
// screen, which is exactly the "низкое разрешение, некрасивая карта" the owner kept reporting.
// A street map is what Light already is, drawn as vector and sharp at any zoom, so Street was
// not a fourth choice; it was a worse copy of one we already had.
//
// Satellite stays raster because imagery IS raster. There is nothing about a photograph to
// draw sharper.
export const MAP_LAYERS = Object.freeze([
  {
    id: "dark",
    label: "Dark",
    hint: "Pins first, city second",
    // Vector, not raster: rendered on the client, so it is sharp at any zoom and any pixel
    // density by construction rather than by buying a bigger bitmap.
    vector: "https://tiles.openfreemap.org/styles/dark",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
      + '&copy; <a href="https://openfreemap.org">OpenFreeMap</a>',
    maxZoom: 19,
  },
  {
    id: "light",
    label: "Light",
    hint: "The same map in daylight",
    // The counterpart to dark, and the reason it can exist at all: the dark layer is a
    // vector style, so a second one costs a URL rather than a second tile pipeline.
    //
    // It is `positron` rather than a lightened `dark`. A dark style inverted is not a light
    // style — the contrasts it was drawn for run the wrong way, and roads end up paler than
    // the ground they cross. Positron is drawn for daylight from the start.
    vector: "https://tiles.openfreemap.org/styles/positron",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
      + '&copy; <a href="https://openfreemap.org">OpenFreeMap</a>',
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
