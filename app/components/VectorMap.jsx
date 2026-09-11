"use client";

// The map, drawn by MapLibre instead of Leaflet (#202, phase 2).
//
// This is the layer the GPU expressions in `pin-style.mjs` were written for. Leaflet draws
// one DOM element per pin; with 1,008 on screen, dragging runs at ~30 fps because the
// compositor redraws all of them every frame (#197). Here the same 1,008 places are one
// GeoJSON source and two data-driven layers, and the number of them stops being the thing
// that decides whether the map is smooth.
//
// It lives on its own route rather than replacing the live map, because a half-migrated map
// cannot render: the searched-works markers, the route line, the story trail and the place
// card are all still Leaflet. Phase 3 moves those; this is the piece that has to be
// measured before the rest is worth doing.

import { useCallback, useEffect, useRef, useState } from "react";

// Ships with the library and is not imported globally — the Leaflet path never needed it,
// because the plugin drew into a Leaflet pane. Without it the canvas has no size rules and
// the attribution control is unstyled, which reads as a broken map rather than a missing
// import.
import "maplibre-gl/dist/maplibre-gl.css";

import { basemapChain, DEFAULT_THEME, THEMES } from "../lib/map-styles.mjs";
import { pinCirclePaint, pinFeature, pinLabelLayout, pinLabelPaint } from "../lib/pin-style.mjs";
import { viewportQuery } from "../lib/map-layer.mjs";

const SOURCE_ID = "places";
const CIRCLE_LAYER_ID = "places-circles";
const LABEL_LAYER_ID = "places-labels";

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

// Long enough that a drag does not fire a request per frame, short enough that letting go
// of the mouse feels like it answered. The Leaflet layer settled on the same number.
const REFETCH_DEBOUNCE_MS = 250;

export default function VectorMap({
  center = [-118.3269, 34.1016],
  zoom = 12,
  theme = DEFAULT_THEME,
  maptilerKey = null,
  onStatus,
  // Draw the basemap and NOTHING of ours. If a bare map renders and ours does not, the
  // fault is in our layers; if neither renders, it is the map itself in this app.
  bare = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const requestRef = useRef(null);
  const timerRef = useRef(null);
  // Whether the initial style has finished and our layers are on it. Guards the style-swap
  // path so it cannot fire during the first load, which is what stalled the map.
  const portedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(0);
  const [provider, setProvider] = useState(null);
  // What the map is actually doing, shown on the page. A black rectangle and "Loading the
  // map…" is not a diagnosis — it is the absence of one, and it cost two rounds of guessing.
  const [diag, setDiag] = useState({ built: false, load: false, styledata: 0, sourcedata: 0, error: null });

  // Kept in a ref as well as in state: the fetch callback must not be rebuilt every time the
  // count changes, or every viewport change would tear down and rebuild its own listeners.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const load = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const query = viewportQuery(map.getBounds(), map.getZoom(), { candidates: true });
    // A degenerate viewport — a map the browser has not measured yet — asks the server about
    // a single point and gets an honest nothing back, which looks exactly like "there is
    // nothing here". Keep what we have and ask again on the next event.
    if (!query) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(`/api/map/points?${query}`, { signal: controller.signal });
      if (!response.ok) return;
      const body = await response.json();

      const features = [...(body.features ?? []), ...(body.candidates ?? [])]
        .filter((feature) => feature?.geometry?.type === "Point")
        .map(pinFeature);

      const source = map.getSource(SOURCE_ID);
      if (!source) return;
      source.setData({ type: "FeatureCollection", features });
      setDrawn(features.length);
      onStatusRef.current?.({ drawn: features.length });
    } catch (error) {
      // An aborted request is the normal case while panning, not a failure worth reporting.
      if (error?.name !== "AbortError") console.error("map points failed", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let map = null;

    (async () => {
      // ~800 kB, and nothing above the map needs it, so it is imported lazily exactly as the
      // Leaflet vector layer already does.
      // `mod.default ?? mod`, not `{ default: … }`. Destructuring the default alone gave
      // `undefined` here and "Cannot read properties of undefined (reading 'Map')" at the
      // constructor — the interop shape depends on how the bundler resolved the package,
      // and the map must not depend on which answer it got.
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled || !containerRef.current) return;

      // The chain, not the style: a well-formed key that MapTiler rejects by origin fails at
      // the network, where no amount of checking in JS can see it. Walking the chain means a
      // rejected key degrades to free tiles instead of to a blank map.
      const chain = basemapChain(theme, maptilerKey);
      let step = 0;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: chain[0].url,
        center,
        zoom,
        attributionControl: { compact: false },
      });
      mapRef.current = map;
      setProvider(chain[0].provider);
      setDiag((d) => ({ ...d, built: true }));

      map.on("error", (event) => {
        // ALWAYS say what happened. Registering an `error` listener REPLACES MapLibre's own
        // logging, so a handler that returns quietly makes the library silent — which is how
        // a black map with no console output was debugged for an hour. Whatever else this
        // does, it reports first.
        const described = `${event?.error?.status ?? ""} ${event?.error?.message ?? event?.error ?? "?"}`.trim();
        console.error("maplibre:", described, event?.sourceId ?? "");
        setDiag((d) => ({ ...d, error: described.slice(0, 120) }));

        // Only a failure of the STYLE itself is worth falling back for. A single missing
        // tile is not: swapping the whole basemap because one tile 404ed would flicker the
        // map for a fault that fixes itself on the next pan.
        const failedStyle = event?.error?.status === 403 || event?.error?.status === 401;
        if (!failedStyle || step + 1 >= chain.length) return;
        step += 1;
        setProvider(chain[step].provider);
        map.setStyle(chain[step].url);
      });

      // One idempotent setup, called from both events. Two things were wrong here before,
      // and both produced the same symptom — a map that drew and a page that said "Loading
      // the map…" forever.
      //
      // First, `styledata` fires DURING the initial style load, before `load`, so it added
      // the source and then `load` threw on the duplicate id and never reached `setReady`.
      //
      // Second and less obvious: the guard was `map.isStyleLoaded()`, which is a STRICTER
      // condition than "you may add layers now". Measured on the running map with MapTiler's
      // Dataviz Dark: the style was parsed (its name and both its sources were readable),
      // `areTilesLoaded()` was true, WebGL 2.0 was available and no error had fired — and
      // `isStyleLoaded()` was still false ten seconds later. Gating on it waits for
      // something that may never arrive. The `load` event is the signal; a failed `addSource`
      // mid-swap is caught and left for the next `styledata`.
      const ensureLayers = () => {
        if (cancelled) return;
        if (bare) { portedRef.current = true; setReady(true); return; }

        try {
          if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY_COLLECTION });
          }
          if (!map.getLayer(CIRCLE_LAYER_ID)) {
            map.addLayer({ id: CIRCLE_LAYER_ID, type: "circle", source: SOURCE_ID, paint: pinCirclePaint() });
          }
          if (!map.getLayer(LABEL_LAYER_ID)) {
            map.addLayer({
              id: LABEL_LAYER_ID, type: "symbol", source: SOURCE_ID,
              layout: pinLabelLayout(), paint: pinLabelPaint(),
            });
          }
        } catch (error) {
          // The style is being replaced under us; `styledata` fires again when it settles.
          // But SAY so — a silent catch is how the previous fault stayed invisible.
          console.error("maplibre layers:", error?.message ?? error);
          setDiag((d) => ({ ...d, error: `layers: ${error?.message ?? error}`.slice(0, 120) }));
          return;
        }

        portedRef.current = true;
        setReady(true);
        load();
      };

      // `load` is the ONLY event that may add layers for the first time.
      //
      // Adding them from `styledata` as well looked like belt and braces and was the bug:
      // `styledata` fires repeatedly DURING the initial style load, so layers were being
      // attached to a style that had not finished parsing. No error was raised — MapLibre
      // simply never completed initialisation: `load` never fired, `loaded()` stayed false,
      // and not one vector tile was ever requested, while the style itself was readable and
      // every URL in it returned 200 with correct CORS from the page. A black map.
      //
      // So `styledata` is for RE-attaching after a deliberate style swap only, and it is
      // gated on having got through `load` once already.
      map.on("styledata", () => setDiag((d) => ({ ...d, styledata: d.styledata + 1 })));
      map.on("sourcedata", () => setDiag((d) => ({ ...d, sourcedata: d.sourcedata + 1 })));
      map.once("load", () => { setDiag((d) => ({ ...d, load: true })); ensureLayers(); });
      map.on("styledata", () => {
        if (portedRef.current) ensureLayers();
      });

      map.on("moveend", () => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(load, REFETCH_DEBOUNCE_MS);
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      requestRef.current?.abort();
      map?.remove();
      mapRef.current = null;
    };
    // Deliberately built once. A theme change is handled by `setStyle` below rather than by
    // tearing the map down, because rebuilding it would lose the reader's position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const [preferred] = basemapChain(theme, maptilerKey);
    setProvider(preferred.provider);
    map.setStyle(preferred.url);
  }, [theme, maptilerKey, ready]);

  return (
    <div className="vector-map">
      <div ref={containerRef} className="vector-map-canvas" />
      <p className="vector-map-status" role="status">
        {ready
          ? `${drawn} places drawn · ${provider}`
          : `built:${diag.built ? "y" : "n"} load:${diag.load ? "y" : "n"} styledata:${diag.styledata} sourcedata:${diag.sourcedata}${diag.error ? ` · ${diag.error}` : ""}`}
      </p>
    </div>
  );
}

export { THEMES };
