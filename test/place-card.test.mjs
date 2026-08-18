import assert from "node:assert/strict";
import test from "node:test";

import {
  COORDINATE_DECIMALS,
  DEFAULT_PLACE_TAB,
  PLACE_TABS,
  coordinateToCopy,
  countInView,
  filterInView,
  formatCoordinate,
  isInView,
  isUsableBounds,
  isPlaceTab,
  routeTabState,
  tabForLocation,
  viewCountLabel,
} from "../app/lib/place-card.mjs";

const at = (lat, lng, over = {}) => ({ id: `${lat},${lng}`, position: [lat, lng], filmId: "f1", ...over });

// ---------- the coordinate ----------

test("the copied coordinate is exactly the one the card printed", () => {
  // A copy button that hands over more precision than the page displayed is inventing
  // digits: we located most of these from a gazetteer, not with a theodolite.
  assert.equal(COORDINATE_DECIMALS, 4);
  assert.equal(formatCoordinate(51.50735, -0.12776), "51.5074, -0.1278");
  assert.equal(coordinateToCopy({ position: [41.65313, 41.68309] }), "41.6531, 41.6831");
});

test("the copied text is a bare pair, because it is pasted into a maps app", () => {
  // No label, no place name, no degree signs — "51.5074, -0.1278" is what Google Maps,
  // Apple Maps and a phone keyboard all accept.
  assert.match(formatCoordinate(51.5074, -0.1278), /^-?\d+\.\d{4}, -?\d+\.\d{4}$/);
});

test("Null Island is never copyable", () => {
  // `Number("")` is 0 and 0 is finite. Four incidents in this project; a copy button is
  // the last place to pass one on to somebody standing in a street.
  assert.equal(formatCoordinate(0, 0), null);
  // A real zero on one axis only is a real place — the Greenwich meridian runs through
  // London, and the Open Plaques dump ships a Leeds cinema at latitude 0.0.
  assert.equal(formatCoordinate(51.4779, 0), "51.4779, 0.0000");
});

test("a place with no coordinate offers nothing to copy", () => {
  assert.equal(formatCoordinate(null, 5), null);
  assert.equal(formatCoordinate("", ""), null);
  assert.equal(coordinateToCopy({}), null);
  assert.equal(coordinateToCopy(null), null);
});

// ---------- what is on screen ----------

const LONDON = { north: 51.6, south: 51.4, east: 0.1, west: -0.3 };

test("the panel counts places and films apart", () => {
  // Ours listed films without ever saying how many places that was, so a thin catalogue
  // and a viewport zoomed too far out looked identical.
  const counted = countInView([
    at(51.5, -0.12, { filmId: "skyfall" }),
    at(51.51, -0.1, { filmId: "skyfall" }),
    at(51.52, -0.09, { filmId: "notting-hill" }),
    at(55.9, -3.19, { filmId: "trainspotting" }),
  ], LONDON);
  assert.deepEqual(counted, { places: 3, films: 2 });
  assert.equal(viewCountLabel(counted), "3 places from 2 films");
});

test("the list and its heading are filtered by the same function", () => {
  // Counting the viewport while listing the whole selection put "6 places from 4 films"
  // above ten rows — a header contradicting the thing it heads.
  const all = [at(51.5, -0.12), at(51.55, -0.1), at(55.9, -3.19)];
  const shown = filterInView(all, LONDON);
  assert.equal(shown.length, 2);
  assert.equal(countInView(all, LONDON).places, shown.length);
});

test("one place from one film reads as one of each", () => {
  assert.equal(viewCountLabel({ places: 1, films: 1 }), "1 place from 1 film");
});

test("an empty view says so rather than counting to zero twice", () => {
  assert.equal(viewCountLabel({ places: 0, films: 0 }), "No places in view");
  assert.equal(viewCountLabel({}), "No places in view");
});

test("before the map has moved, everything counts", () => {
  // The first paint happens before any move event. Answering 0 there would flash
  // "No places in view" over a map already full of pins.
  const all = [at(51.5, -0.12), at(55.9, -3.19)];
  assert.deepEqual(countInView(all, null), { places: 2, films: 1 });
});

test("a viewport across the antimeridian is not an empty Pacific", () => {
  // Longitude wraps and latitude does not: such a viewport arrives with west > east, and
  // a naive between-test returns zero for the whole ocean — which reads as "we hold
  // nothing there" rather than as a broken test.
  const pacific = { north: 20, south: -20, east: -170, west: 170 };
  assert.equal(isInView(at(0, 179), pacific), true);
  assert.equal(isInView(at(0, -179), pacific), true);
  assert.equal(isInView(at(0, 0), pacific), false);
});

test("a map with no size has not said what is in view", () => {
  // Leaflet answers getBounds() on a zero-sized container with a degenerate box. Observed
  // on the first paint: the panel printed "No places in view" over a map drawing five pins.
  const flat = { north: 51.5, south: 51.5, east: -0.1, west: -0.1 };
  assert.equal(isUsableBounds(flat), false);
  assert.deepEqual(countInView([at(51.5, -0.12), at(55.9, -3.19)], flat), { places: 2, films: 1 });
  assert.equal(isUsableBounds(LONDON), true);
});

test("a place with no coordinate is not in view", () => {
  assert.equal(isInView({ position: [null, null] }, LONDON), false);
  assert.equal(isInView({}, LONDON), false);
  assert.equal(isInView(at(51.5, -0.12), { north: null, south: 0, east: 0, west: 0 }), false);
});

test("bounds given upside down still describe the same box", () => {
  // Leaflet is well behaved about this; a caller assembling bounds by hand is not.
  assert.equal(isInView(at(51.5, -0.12), { north: 51.4, south: 51.6, east: 0.1, west: -0.3 }), true);
});

// ---------- the tabs ----------

test("there is no Discussion tab, because #157 is not built", () => {
  // A tab that opens onto nothing is the padding this project refuses elsewhere.
  assert.deepEqual(PLACE_TABS.map((tab) => tab.id), ["details", "route"]);
  assert.equal(isPlaceTab("discussion"), false);
  assert.equal(DEFAULT_PLACE_TAB, "details");
});

test("a new place always opens on its own details", () => {
  // Otherwise clicking a new pin shows route controls where the sentence about the place
  // should be — exactly the "pushed off screen" the issue asks us to stop.
  assert.equal(tabForLocation("route", true), "details");
  assert.equal(tabForLocation("route", false), "route");
  assert.equal(tabForLocation("nonsense", false), "details");
});

// ---------- the route tab ----------

test("the route tab says something before anything is on the route", () => {
  const state = routeTabState({ location: at(51.5, -0.12), stops: [] });
  assert.equal(state.canAdd, true);
  assert.equal(state.added, false);
  assert.match(state.note, /can be the first stop/);
});

test("a place already on the route cannot be added twice", () => {
  const place = at(51.5, -0.12);
  const state = routeTabState({ location: place, stops: [at(55.9, -3.19), place] });
  assert.equal(state.added, true);
  assert.equal(state.canAdd, false);
  assert.equal(state.note, "Stop 2 of 2 on your route.");
});

test("a full route says it is full rather than silently refusing", () => {
  // The old button simply did nothing at five stops, which reads as a broken button.
  const stops = Array.from({ length: 5 }, (_, i) => at(51 + i, 0));
  const state = routeTabState({ location: at(48, 2), stops });
  assert.equal(state.canAdd, false);
  assert.equal(state.full, true);
  assert.match(state.note, /full at 5 stops/);
});

test("the route tab names the three-stop threshold before it is reached", () => {
  const state = routeTabState({ location: at(48, 2), stops: [at(51, 0), at(52, 0)] });
  assert.match(state.note, /2 stops so far/);
  assert.match(state.note, /needs three/);
});
