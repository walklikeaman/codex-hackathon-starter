"use client";

// What the map draws on top of the basemap, as MapLibre layers (#202, phase 3).
//
// Each of these replaces a react-leaflet component the app already used, and each keeps the
// meaning the old one carried. The difference is where the drawing happens: a Leaflet
// `<Marker>` is a DOM element the compositor redraws every frame, while a layer here is
// data the GPU draws. With 1,008 places on screen that is 30 fps against 120 (#197).

import { useEffect, useMemo, useRef } from "react";

import { circleFeature } from "../../lib/geo-circle.mjs";
import { pinCirclePaint, pinFeature, pinLabelLayout, pinLabelPaint } from "../../lib/pin-style.mjs";
import { claimClick, useGeoJsonLayer, useMapCanvas } from "./MapCanvas.jsx";

const EMPTY = { type: "FeatureCollection", features: [] };

function collection(features) {
  return { type: "FeatureCollection", features: features.filter(Boolean) };
}

// The places. One source, two layers: a circle carrying the vocabulary from `map-pin.mjs`,
// and a label carrying the count for the points that stack several films.
export function PinLayer({ id = "places", features, onSelect, selectedKey = null }) {
  const map = useMapCanvas();

  const data = useMemo(() => collection(
    (features ?? []).map((feature) => {
      const shaped = pinFeature(feature);
      if (!shaped?.geometry) return null;
      const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
      return {
        ...shaped,
        properties: { ...shaped.properties, selected: key === selectedKey, key },
      };
    }),
  ), [features, selectedKey]);

  const circleId = `${id}-circles`;
  const labelId = `${id}-labels`;

  useGeoJsonLayer({
    id,
    data,
    layers: [
      { id: circleId, type: "circle", paint: pinCirclePaint() },
      { id: labelId, type: "symbol", layout: pinLabelLayout(), paint: pinLabelPaint() },
    ],
  });

  // Clicks and the pointer, both on the circle layer. The label sits on top of the circle,
  // so hit-testing only the circle would miss the middle of any pin carrying a number.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!map) return undefined;

    const pick = (event) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: [circleId, labelId] })[0];
      if (!hit) return;
      // Tell the map's own background handler to stand down: this click was answered.
      claimClick(event);
      selectRef.current?.(hit.properties);
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };

    map.on("click", pick);
    for (const layer of [circleId, labelId]) {
      map.on("mouseenter", layer, enter);
      map.on("mouseleave", layer, leave);
    }

    return () => {
      map.off("click", pick);
      for (const layer of [circleId, labelId]) {
        map.off("mouseenter", layer, enter);
        map.off("mouseleave", layer, leave);
      }
    };
  }, [map, circleId, labelId]);

  return null;
}

// The dashed ring that says "the source named a city or a region, not a doorway".
//
// Drawn as a polygon in real coordinates rather than a pixel radius, because the number it
// carries is a DISTANCE. A pixel radius would hold the ring the same size on screen while
// the city under it grew and shrank, and the ring would stop meaning anything.
export function AreaLayer({ id = "areas", areas }) {
  const data = useMemo(() => collection(
    (areas ?? []).map((area) => circleFeature(area.position, area.radiusMeters, { id: area.id })),
  ), [areas]);

  useGeoJsonLayer({
    id,
    data,
    layers: [
      {
        id: `${id}-fill`,
        type: "fill",
        paint: { "fill-color": "#f7b733", "fill-opacity": 0.06 },
      },
      {
        id: `${id}-outline`,
        type: "line",
        paint: {
          "line-color": "#f7b733",
          "line-opacity": 0.55,
          "line-width": 1,
          // The dash is the whole point: a solid ring would read as a boundary we know,
          // and we do not know one. It is vagueness drawn honestly.
          "line-dasharray": [3, 3],
        },
      },
    ],
  });

  return null;
}

// A route or a trail. One line, styled by whether it is a real route or a straight-line
// stand-in — a dashed line is the honest drawing of "we could not get directions".
export function RouteLine({ id = "route", positions, dashed = false, color = "#f7b733" }) {
  const data = useMemo(() => {
    const coordinates = (positions ?? [])
      .map((point) => (Array.isArray(point) ? [point[1], point[0]] : [point.lng, point.lat]))
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

    if (coordinates.length < 2) return EMPTY;
    return collection([{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} }]);
  }, [positions]);

  useGeoJsonLayer({
    id,
    data,
    layers: [{
      id: `${id}-line`,
      type: "line",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": 5,
        "line-opacity": dashed ? 0.7 : 0.95,
        ...(dashed ? { "line-dasharray": [1.6, 2] } : {}),
      },
    }],
  });

  return null;
}

// One marker, as a DOM element — for the handful of things that are genuinely one of a kind
// and want real markup: where the reader is standing, and the numbered stops of a trail.
// Using a layer for these would be the same mistake in reverse.
export function MapMarker({ position, children, onClick, className = "", zIndex }) {
  // `children` is text only — see the effect at the end of this component for why.
  const map = useMapCanvas();
  const elementRef = useRef(null);
  const markerRef = useRef(null);

  if (!elementRef.current && typeof document !== "undefined") {
    elementRef.current = document.createElement("div");
  }

  useEffect(() => {
    if (!map || !elementRef.current) return undefined;

    let cancelled = false;
    let marker = null;

    (async () => {
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled) return;
      marker = new maplibregl.Marker({ element: elementRef.current })
        .setLngLat(position)
        .addTo(map);
      markerRef.current = marker;
    })();

    return () => { cancelled = true; marker?.remove(); markerRef.current = null; };
  }, [map, position]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.className = className;
    if (zIndex !== undefined) element.style.zIndex = String(zIndex);
  }, [className, zIndex]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !onClick) return undefined;
    const handler = (event) => { event.stopPropagation(); onClick(); };
    element.addEventListener("click", handler);
    return () => element.removeEventListener("click", handler);
  }, [onClick]);

  useEffect(() => {
    if (markerRef.current && position) markerRef.current.setLngLat(position);
  }, [position]);

  // `textContent`, never `innerHTML`. A marker here carries at most a number — a trail stop's
  // position in the walk — and the shape comes from CSS. Accepting markup would put a place
  // name from a third-party source into the DOM as HTML, which is a route from a scraped
  // title to script execution that this map has no reason to open.
  useEffect(() => {
    const element = elementRef.current;
    if (element) element.textContent = children == null ? "" : String(children);
  }, [children]);

  return null;
}
