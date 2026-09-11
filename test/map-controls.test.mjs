import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ZOOM, MIN_ZOOM, activeLayerLabel, zoomAffordance,
} from "../app/lib/map-controls.mjs";

test("both zoom buttons are live in the middle of the range", () => {
  const affordance = zoomAffordance(12);
  assert.equal(affordance.canZoomIn, true);
  assert.equal(affordance.canZoomOut, true);
});

test("zoom in is refused at the maximum, and only zoom in", () => {
  const affordance = zoomAffordance(MAX_ZOOM);
  assert.equal(affordance.canZoomIn, false);
  assert.equal(affordance.canZoomOut, true);
});

test("zoom out is refused at the minimum, and only zoom out", () => {
  const affordance = zoomAffordance(MIN_ZOOM);
  assert.equal(affordance.canZoomOut, false);
  assert.equal(affordance.canZoomIn, true);
});

// The flicker this exists to stop: a pinch passes through 18.997 on its way to 19, and a
// strict comparison leaves the button enabled there and disabled a frame later.
test("a fractional zoom a hair under the limit is already at the limit", () => {
  assert.equal(zoomAffordance(18.997).canZoomIn, false);
  assert.equal(zoomAffordance(3.003).canZoomOut, false);
});

test("a zoom well inside the limits is not rounded away", () => {
  assert.equal(zoomAffordance(18.5).canZoomIn, true);
  assert.equal(zoomAffordance(3.5).canZoomOut, true);
});

// Before Leaflet answers there is no zoom to read. Disabling both buttons for that frame
// would show the reader a dead control on first paint.
test("no map yet leaves both buttons live", () => {
  const affordance = zoomAffordance(null);
  assert.deepEqual(affordance, { canZoomIn: true, canZoomOut: true, zoom: null });
});

test("custom bounds are honoured over the defaults", () => {
  assert.equal(zoomAffordance(14, { maxZoom: 14 }).canZoomIn, false);
  assert.equal(zoomAffordance(14, { maxZoom: 19 }).canZoomIn, true);
});

test("the layers button names the layer that is on", () => {
  const layers = [{ id: "dark", label: "Dark" }, { id: "satellite", label: "Satellite" }];
  assert.equal(activeLayerLabel(layers, "satellite"), "Satellite");
});

test("an unknown or missing layer gives an empty label rather than a wrong one", () => {
  assert.equal(activeLayerLabel([{ id: "dark", label: "Dark" }], "nope"), "");
  assert.equal(activeLayerLabel(null, "dark"), "");
});
