// The pin vocabulary, said again as GPU style expressions (#202, phase 2).
//
// `map-pin.mjs` decides what a pin MEANS and draws it as HTML for a Leaflet `divIcon`. That
// is one DOM element per pin, and with 1,008 of them on screen dragging the map runs at
// ~30 fps because the compositor redraws all of them every frame (#197).
//
// MapLibre draws the same vocabulary as two data-driven layers — a circle and a text label —
// and the GPU does not care whether there are ten of them or ten thousand. So the meaning
// has to be restated as expressions over feature properties instead of classes over
// elements. This module is that restatement, and it is kept pure and separate so the
// vocabulary can be tested without a GPU, exactly as `pinClasses` is tested without a DOM.
//
// **The one thing that cannot survive the move, stated plainly:** an unchecked pin is drawn
// with a DASHED outline in CSS, and a circle in MapLibre has no dashed stroke. The
// distinction it carries is far too important to lose — 32,138 located rows are unchecked
// and only 92 facts are not — so it survives as fill: a checked pin is solid, an unchecked
// pin is hollow, with the same amber ring around a near-transparent middle. Filled against
// outlined is the meaning; the dash was how that meaning was spelled.

import { MAX_PIN, MIN_PIN, PIN_KIND, pinKind, pinLabel, pinSize } from "./map-pin.mjs";

// The same colours the CSS uses, because the pin must not change appearance when the engine
// under it changes. Amber is somewhere you can stand, violet is a studio lot, teal is where
// the story happens and nobody claims a camera was there.
export const PIN_COLORS = Object.freeze({
  [PIN_KIND.place]: "#f7b733",
  [PIN_KIND.studio]: "#b98cff",
  [PIN_KIND.narrative]: "#6fd3c7",
});

// What a checked pin prints its number in — dark, because the pin behind it is filled.
export const PIN_INK = Object.freeze({
  [PIN_KIND.place]: "#16130c",
  [PIN_KIND.studio]: "#17102b",
  [PIN_KIND.narrative]: "#0b2320",
});

// The hollow middle of an unchecked pin. Not fully transparent: a count printed straight
// onto a dark street at night cannot be read, which is the same reason the CSS gives a
// multi-film unchecked pin a more opaque ground.
export const PIN_HOLLOW = "rgba(12, 10, 7, 0.55)";
export const PIN_HOLLOW_MANY = "rgba(12, 10, 7, 0.88)";

// The ring that answers "what did I just click?". It never changes the other three answers:
// a selected studio lot is still violet and still hollow if nobody checked it.
export const PIN_SELECTED_RING = "#fff3a5";

// What each feature must carry for the expressions below to draw it. Built here rather than
// read ad hoc in a component so that the map layer and the legend cannot disagree about
// what a pin is — they read the same function.
export function pinFeatureProperties(props = {}) {
  const count = Number(props.work_count ?? props.filmCount ?? 1);
  const kind = pinKind({
    depicts_elsewhere: props.depicts_elsewhere,
    narrative: props.narrative,
  });

  return {
    kind,
    checked: props.checked === true || props.status === "verified",
    // Precomputed rather than expressed, because `pinSize` is a logarithm and MapLibre
    // expressions have no log. Keeping the arithmetic in JS also keeps ONE definition of
    // how a pin grows — the DOM path and the GPU path cannot drift apart.
    diameter: pinSize(count),
    label: pinLabel(count),
    many: Number.isFinite(count) && count > 1,
    selected: props.selected === true,
  };
}

// MapLibre measures a circle by its radius; the vocabulary is written in diameters.
export function circleRadiusExpression() {
  return ["/", ["get", "diameter"], 2];
}

// Filled means somebody looked. That is evidence, not decoration.
export function circleColorExpression() {
  return [
    "case",
    ["get", "checked"], ["get", "kindColor"],
    ["get", "many"], PIN_HOLLOW_MANY,
    PIN_HOLLOW,
  ];
}

// The outline carries the colour on a hollow pin, and a quiet white edge on a filled one so
// an amber pin on amber-lit satellite imagery still has a border.
export function circleStrokeColorExpression() {
  return [
    "case",
    // Pointing at a row in the list lights its places. It reads like selection because it
    // IS the same question — "which one is this?" — asked from the other side.
    ["get", "highlighted"], PIN_SELECTED_RING,
    ["get", "selected"], PIN_SELECTED_RING,
    ["get", "checked"], "rgba(255, 255, 255, 0.85)",
    ["get", "kindColor"],
  ];
}

export function circleStrokeWidthExpression() {
  return ["case", ["get", "highlighted"], 4, ["get", "selected"], 4, ["get", "checked"], 2, 1.5];
}

// One film prints nothing. A "1" on every pin is noise, and the number exists to mark the
// points that hide something.
export function labelTextExpression() {
  return ["get", "label"];
}

export function labelColorExpression() {
  return ["case", ["get", "checked"], ["get", "kindInk"], ["get", "kindColor"]];
}

// Everything a MapLibre circle layer needs to draw the vocabulary, in one object, so a
// component never assembles paint properties by hand.
export function pinCirclePaint() {
  return {
    "circle-radius": circleRadiusExpression(),
    "circle-color": circleColorExpression(),
    "circle-stroke-color": circleStrokeColorExpression(),
    "circle-stroke-width": circleStrokeWidthExpression(),
  };
}

export function pinLabelLayout() {
  return {
    "text-field": labelTextExpression(),
    "text-size": 11,
    "text-font": ["Noto Sans Bold"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  };
}

export function pinLabelPaint() {
  return { "text-color": labelColorExpression() };
}

// A GeoJSON feature the layers above can draw, from one row of the map API. The colour and
// the ink are resolved HERE rather than in an expression, because a `match` over three kinds
// repeated in four expressions is four places to add a fourth kind and forget one.
export function pinFeature(feature) {
  const props = feature?.properties ?? {};
  const shape = pinFeatureProperties(props);

  return {
    type: "Feature",
    geometry: feature?.geometry,
    properties: {
      ...shape,
      kindColor: PIN_COLORS[shape.kind],
      kindInk: PIN_INK[shape.kind],
    },
  };
}

export { MAX_PIN, MIN_PIN };
