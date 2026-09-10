"use client";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { workPath } from "../lib/work-url.mjs";

import {
  candidateClusterStyle,
  candidateStyle,
  candidateSummary,
  pointFilmLine,
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
  onCandidatesInView,
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
    return data.candidates.flatMap((feature) => {
      const props = feature.properties ?? {};
      if (props.cluster) return [feature];
      if (!showStudioLots && props.depicts_elsewhere) return [];
      if (!isMine) return [feature];

      // A point carries many films, so "mine" is a question about the LIST, not the pin.
      // A place keeps its pin if any film there is the reader's — and the popup is
      // narrowed to those, because a filtered map that still lists 96 films in the popup
      // is answering a question nobody asked.
      const mine = props.films.filter((film) => isMine(film));
      if (!mine.length) return [];
      return [{
        ...feature,
        properties: {
          ...props,
          films: mine,
          work_count: mine.length,
          row_count: mine.length,
          // The cap belonged to the unfiltered list; this one is complete by construction.
          films_truncated: false,
        },
      }];
    });
  }, [data.candidates, showCandidates, showStudioLots, isMine]);

  // The panel lists exactly what the map DREW, not what the server sent. Listing the
  // response instead would put films in the list that the studio-lot switch or the library
  // filter had just removed from the map — a header contradicting the thing it heads.
  useEffect(() => {
    onCandidatesInView?.(visibleCandidates);
  }, [visibleCandidates, onCandidatesInView]);

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
            key={`candidate-${lat}-${lng}-${index}`}
            center={[lat, lng]}
            renderer={renderer}
            pathOptions={candidateStyle(feature, { selected: false })}
            eventHandlers={{ click: () => onSelect?.(feature) }}
          >
            {/* The count on the pin, not only inside it. A point holding 96 films looks
                like a point holding one until you click it, and the whole reason this
                layer groups by coordinate is that 71% of the rows were hidden. */}
            {props.work_count > 1 && (
              <Tooltip direction="top" opacity={0.9}>{props.work_count}</Tooltip>
            )}
            <Popup maxHeight={280}>
              <strong>{props.name}</strong>
              <br />
              <span className="graph-badge badge-candidate">{pointFilmLine(props)}</span>
              {props.studio_lot && (
                <>
                  <br />
                  <small>Inside {props.studio_lot.name} — the camera was here, the scene is set elsewhere</small>
                </>
              )}
              {props.area_hint && (
                <>
                  <br />
                  <small>{props.area_hint}</small>
                </>
              )}
              {/* The films themselves. This is the answer to "what was shot here", and
                  before the grouping it was unreachable — every film after the first was
                  drawn underneath the pin you could see. */}
              <ul className="point-films">
                {props.films.map((film) => (
                  <li key={`${film.work_id}-${film.place_name}`}>
                    <a href={workPath({ id: film.work_id, title: film.title })}>
                      {film.title}
                    </a>
                    {film.year ? <span className="point-film-year"> {film.year}</span> : null}
                  </li>
                ))}
              </ul>
              {/* Says so rather than printing its own cap as the number we hold — the
                  silent truncation this project has already shipped once. */}
              {props.films_truncated && (
                <small>Showing {props.films.length} of {props.work_count} — open the place to see them all.</small>
              )}
              <br />
              <small>{candidateSummary(props)}</small>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
