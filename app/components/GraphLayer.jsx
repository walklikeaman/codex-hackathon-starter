"use client";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import {
  candidateClusterStyle,
  candidateStyle,
  candidateSummary,
  clusterStyle,
  pointStyle,
  pointSummary,
  viewportQuery,
} from "../lib/map-layer.mjs";

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
  // The queue layer (#the-queue-reaches-the-map). Off by default: every caller written
  // before it existed keeps drawing the graph and nothing else.
  showCandidates = false,
  showStudioLots = true,
  // A predicate, not a list. The owner's library lives in localStorage and never reaches
  // the server ([[personal-library]]), so "my films only" can only be decided here, on
  // rows that have already arrived. Passing a matcher keeps the library out of this
  // component entirely — it never sees the titles, only the answer.
  isMine = null,
}) {
  const map = useMap();
  // One shared canvas for every marker in this layer.
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const [data, setData] = useState({ features: [], candidates: [], clustered: false, fictional: [] });
  const requestRef = useRef(null);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    const query = viewportQuery(map.getBounds(), map.getZoom(), { workId, kinds, candidates: showCandidates });
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
        candidates: Array.isArray(body.candidates) ? body.candidates : [],
        clustered: body.clustered === true,
        fictional: Array.isArray(body.fictional) ? body.fictional : [],
        truncated: body.truncated === true,
      });
      onSummary?.({
        count: body.features?.length ?? 0,
        candidateCount: body.candidates?.length ?? 0,
        clustered: body.clustered === true,
        truncated: body.truncated === true,
        // The viewport held more than one response can carry. Said out loud, because a
        // map that draws 1,000 of 4,729 and looks complete is the silent truncation this
        // project has already shipped once.
        candidatesTruncated: body.candidates_truncated === true,
        fictional: body.fictional ?? [],
        // Populated only when the viewport is empty, so the panel can say
        // "nothing here" and offer somewhere to go.
        nearest: body.nearest ?? [],
      });
    } catch (error) {
      if (error?.name === "AbortError") return; // superseded by a newer viewport
      // A failed graph fetch must not blank the map or throw into the render tree —
      // the layer simply keeps what it had.
      console.error("Graph layer refresh failed", error);
    }
  }, [map, workId, kinds, onSummary, showCandidates]);

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

  // Three switches, applied in one pass. A cluster is never filtered by film or by lot:
  // it is a COUNT of rows the server aggregated, and hiding some of what it counted would
  // leave a bubble whose number describes rows that are no longer on the map.
  const visibleCandidates = useMemo(() => {
    if (!showCandidates) return [];
    return data.candidates.filter((feature) => {
      const props = feature.properties ?? {};
      if (props.cluster) return true;
      if (!showStudioLots && props.depicts_elsewhere) return false;
      if (isMine && !isMine(props)) return false;
      return true;
    });
  }, [data.candidates, showCandidates, showStudioLots, isMine]);

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

      {/* The queue, under the graph in reading order and drawn hollow so it can never be
          mistaken for it. Filtered here rather than in the query: the library never
          leaves the browser, and the lot test is a polygon this client already holds. */}
      {visibleCandidates.map((feature, index) => {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const props = feature.properties ?? {};

        if (props.cluster) {
          const count = props.point_count ?? 0;
          return (
            <CircleMarker
              key={`candidate-cluster-${index}-${lat}-${lng}`}
              center={[lat, lng]}
              renderer={renderer}
              pathOptions={candidateClusterStyle(count)}
              eventHandlers={{ click: () => map.flyTo([lat, lng], Math.min(map.getZoom() + 3, 17)) }}
            >
              <Tooltip direction="top">
                {/* Places and the films behind them are two different numbers. */}
                {count} unchecked{props.work_count ? ` · ${props.work_count} films` : ""}
              </Tooltip>
            </CircleMarker>
          );
        }

        return (
          <CircleMarker
            key={props.submission_id ?? `candidate-${lat}-${lng}-${index}`}
            center={[lat, lng]}
            renderer={renderer}
            pathOptions={candidateStyle(feature, { selected: false })}
            eventHandlers={{ click: () => onSelect?.(feature) }}
          >
            <Popup>
              {/* The film first: on a browsable map the reader arrived at a pin without
                  having asked about any work, so "which film is this" is the question. */}
              <strong>{props.work_title ?? "Unknown work"}</strong>
              <br />
              <span>{props.name}</span>
              <br />
              <span className="graph-badge badge-candidate">{candidateSummary(props)}</span>
              {props.studio_lot && (
                <>
                  <br />
                  <small>Inside {props.studio_lot.name}</small>
                </>
              )}
              {props.source_url && (
                <>
                  <br />
                  <a href={props.source_url} target="_blank" rel="noopener noreferrer">Where this came from</a>
                </>
              )}
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
