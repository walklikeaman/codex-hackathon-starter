// The place card's own arithmetic (#160): what to copy, what to count, and what to say.
//
// Three things taken from lostfoundations' place card, and one deliberately not. The card
// we have is a single scroll holding the sentence, the precision badge, the evidence, the
// voice guide, two images, "Recreate this shot", three external links and "Add to route" —
// a lot of unrelated things in one column. What is here is the part of that split which is
// arithmetic and sentences rather than layout, so it can be tested without a browser.
//
// **Not taken: their 1-5 safety score.** It exists because their readers climb into
// derelict buildings; ours walk to a café on a public street. We already carry the two
// badges that matter here — precision and evidence — and both are better calibrated than a
// number nobody could source.

import { finiteOrNull } from "./numbers.mjs";

// ---------- the coordinate somebody standing in the street wants ----------

// Six decimals is ~11 cm, which is past the point of meaning for a place we located from a
// gazetteer, and four is ~11 m, which is a doorway. The card already printed four; this is
// what gets COPIED, and it is the same number, because a copy button that hands over more
// precision than the page displayed is inventing digits.
export const COORDINATE_DECIMALS = 4;

export function formatCoordinate(lat, lng, { decimals = COORDINATE_DECIMALS } = {}) {
  const latitude = finiteOrNull(lat);
  const longitude = finiteOrNull(lng);
  if (latitude === null || longitude === null) return null;
  // Null Island is not a place. Four incidents in this project, all from `Number("")`
  // being 0 and 0 being finite — a copy button is the last place to hand one on.
  if (latitude === 0 && longitude === 0) return null;
  return `${latitude.toFixed(decimals)}, ${longitude.toFixed(decimals)}`;
}

// "41.65313, 41.68309" is what every maps app, every phone and every messaging app accepts
// when pasted, so the copied text is exactly what the card shows — no label, no name, no
// degree signs. A person pastes this into Google Maps, not into an essay.
export function coordinateToCopy(location) {
  return formatCoordinate(location?.position?.[0], location?.position?.[1]);
}

// ---------- how many places are on screen, and how many films that is ----------

// The two numbers are different and the panel never said so. Ours lists FILMS in view
// without stating how many PLACES that is, which makes "we hold little here" and "you are
// zoomed too far out" look identical — the reader cannot tell a thin catalogue from a
// wrong viewport.

function within(value, low, high) {
  return value >= low && value <= high;
}

// Longitude wraps and latitude does not. A viewport across the antimeridian arrives with
// `west` greater than `east`, and a naive between-test returns zero places for the whole
// Pacific — which would read as "we have nothing there" rather than "the test is wrong".
function longitudeWithin(lng, west, east) {
  return west <= east ? within(lng, west, east) : lng >= west || lng <= east;
}

// A box with no height is not a viewport, it is a map that has not been laid out yet.
// Leaflet answers `getBounds()` on a zero-sized container with a degenerate box, and
// treating that as the truth prints "No places in view" over a map drawing five pins —
// observed on the first paint before the container had a size.
export function isUsableBounds(bounds) {
  if (!bounds) return false;
  const { north, south, east, west } = bounds;
  if ([north, south, east, west].some((edge) => finiteOrNull(edge) === null)) return false;
  return Math.abs(north - south) > 0 && east !== west;
}

export function isInView(location, bounds) {
  const lat = finiteOrNull(location?.position?.[0]);
  const lng = finiteOrNull(location?.position?.[1]);
  if (lat === null || lng === null || !isUsableBounds(bounds)) return false;
  const { north, south, east, west } = bounds;
  return within(lat, Math.min(south, north), Math.max(south, north))
    && longitudeWithin(lng, west, east);
}

// With no usable bounds — the first paint, before the map has been laid out or moved —
// everything is in view. An empty answer there would flash "0 places" over a map full of
// pins.
export function filterInView(locations, bounds) {
  const all = Array.isArray(locations) ? locations : [];
  return isUsableBounds(bounds) ? all.filter((location) => isInView(location, bounds)) : all;
}

export function countInView(locations, bounds) {
  const shown = filterInView(locations, bounds);
  const films = new Set();
  for (const location of shown) {
    const id = location?.filmId ?? location?.film;
    if (id) films.add(id);
  }
  return { places: shown.length, films: films.size };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Places first, because places are what is drawn. The film count comes second and is
// phrased as a source of them — "12 places from 5 films" — rather than as a second total a
// reader has to work out the relationship of.
export function viewCountLabel({ places = 0, films = 0 } = {}) {
  if (places === 0) return "No places in view";
  return `${plural(places, "place")} from ${plural(films, "film")}`;
}

// ---------- the tabs ----------

// Details and Route. NOT Discussion: #157 is not built, and a tab that opens onto nothing
// is the padding this project keeps refusing elsewhere. The id is here so the day #157
// lands the tab is one line and the card does not have to be rearranged again.
export const PLACE_TABS = Object.freeze([
  { id: "details", label: "Details" },
  { id: "route", label: "Route" },
]);

export const DEFAULT_PLACE_TAB = "details";

export function isPlaceTab(id) {
  return PLACE_TABS.some((tab) => tab.id === id);
}

// The card reopens on Details whenever the place changes. Leaving it on Route means
// clicking a new pin shows route controls where the sentence about the place should be —
// which is exactly the "pushed off screen" the issue asks us to stop.
export function tabForLocation(currentTab, changed) {
  if (changed) return DEFAULT_PLACE_TAB;
  return isPlaceTab(currentTab) ? currentTab : DEFAULT_PLACE_TAB;
}

// What the Route tab says about THIS place, so the tab is worth opening even before
// anything has been added.
export function routeTabState({ location, stops = [], maxStops = 5 }) {
  const list = Array.isArray(stops) ? stops : [];
  const index = list.findIndex((stop) => stop.id === location?.id);
  const full = list.length >= maxStops;
  return {
    index,
    added: index !== -1,
    // A stop already on the route cannot be added again, and a full route cannot take
    // another. Both are the same button, and it says which of the two it is.
    canAdd: index === -1 && !full,
    full,
    count: list.length,
    maxStops,
    note: index !== -1
      ? `Stop ${index + 1} of ${list.length} on your route.`
      : full
        ? `Your route is full at ${maxStops} stops. Remove one to add this place.`
        : list.length === 0
          ? "Nothing on your route yet. This place can be the first stop."
          : `${plural(list.length, "stop")} so far. A route needs three before it can be built.`,
  };
}
