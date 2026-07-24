"use client";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { clusterStyle, pointStyle, pointSummary, viewportQuery } from "../lib/map-layer.mjs";

const REFRESH_DEBOUNCE_MS = 300;

// The graph layer: points served by /api/map/points, drawn on a CANVAS renderer rather
// than as DOM markers. Thousands of pins as DOM nodes stall the browser; one canvas
// stays smooth, and the database does the clustering so the client never holds the
// whole set. Below z12 the endpoint returns cluster bubbles instead of places.
export default function GraphLayer({
  workId = null,
  kinds = null,
  selectedPlaceId = null,
  onSelect,
  onSummary,
}) {
  const map = useMap();
  // One shared canvas for every marker in this layer.
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const [data, setData] = useState({ features: [], clustered: false, fictional: [] });
  const requestRef = useRef(null);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    const query = viewportQuery(map.getBounds(), map.getZoom(), { workId, kinds });
    if (!query) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(`/api/map/points?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`map points responded ${response.status}`);
      const body = await response.json();
      setData({
        features: Array.isArray(body.features) ? body.features : [],
        clustered: body.clustered === true,
        fictional: Array.isArray(body.fictional) ? body.fictional : [],
        truncated: body.truncated === true,
      });
      onSummary?.({
        count: body.features?.length ?? 0,
        clustered: body.clustered === true,
        truncated: body.truncated === true,
        fictional: body.fictional ?? [],
      });
    } catch (error) {
      if (error?.name === "AbortError") return; // superseded by a newer viewport
      // A failed graph fetch must not blank the map or throw into the render tree —
      // the layer simply keeps what it had.
      console.error("Graph layer refresh failed", error);
    }
  }, [map, workId, kinds, onSummary]);

  const scheduleLoad = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
  }, [load]);

  // `resize` matters as much as move/zoom: a window resize, a rotated phone, or a
  // panel opening changes which part of the world is visible without ever firing
  // moveend, so without it the layer would keep serving the previous viewport.
  useMapEvents({ moveend: scheduleLoad, zoomend: scheduleLoad, resize: scheduleLoad });

  useEffect(() => {
    load();
    return () => {
      clearTimeout(timerRef.current);
      requestRef.current?.abort();
    };
  }, [load]);

  return (
    <>
      {data.features.map((feature, index) => {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const props = feature.properties ?? {};

        if (data.clustered || props.cluster) {
          const count = props.point_count ?? 0;
          return (
            <CircleMarker
              key={`cluster-${index}-${lat}-${lng}`}
              center={[lat, lng]}
              renderer={renderer}
              pathOptions={clusterStyle(count, { hasStudio: props.has_studio })}
              eventHandlers={{ click: () => map.flyTo([lat, lng], Math.min(map.getZoom() + 3, 17)) }}
            >
              <Tooltip direction="top" permanent={count > 1}>
                {count}
              </Tooltip>
            </CircleMarker>
          );
        }

        const selected = selectedPlaceId && props.place_id === selectedPlaceId;
        return (
          <CircleMarker
            key={props.place_id ?? `${lat}-${lng}-${index}`}
            center={[lat, lng]}
            renderer={renderer}
            pathOptions={pointStyle(feature, { selected })}
            eventHandlers={{ click: () => onSelect?.(feature) }}
          >
            <Popup>
              <strong>{props.name}</strong>
              <br />
              <span className={`graph-badge badge-${props.badge}`}>{pointSummary(props)}</span>
              <br />
              <small>{props.geocode_precision} · confidence {props.confidence}</small>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
