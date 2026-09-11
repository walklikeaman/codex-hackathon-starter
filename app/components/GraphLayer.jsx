"use client";

import L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { workPath } from "../lib/work-url.mjs";
import { pinHtml, pinIconKey, pinSize } from "../lib/map-pin.mjs";

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
function GraphLayer({
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
  // Icons are shared between pins that look alike, and this is why.
  //
  // A fresh `L.divIcon` per marker per render is a CHANGED `icon` prop, so react-leaflet
  // called `setIcon` on every marker — and `setIcon` replaces the marker's DOM element.
  // Every state change in the app, however unrelated, rebuilt every pin on the map:
  // opening the layers menu with 598 pins drawn blocked the main thread for 220 ms, while
  // the same click with 10 pins drawn cost 45 ms. Nothing about the pins had changed.
  //
  // Sharing is safe because `DivIcon.createIcon()` builds a new element per marker; the
  // icon object is the recipe, not the pin. A ref rather than state — filling the cache
  // must never schedule a render, or it would cause the work it exists to avoid.
  const iconCache = useRef(new Map());
  const iconFor = useCallback((options) => {
    const key = pinIconKey(options);
    const cached = iconCache.current.get(key);
    if (cached) return cached;

    const size = pinSize(options.filmCount);
    const icon = L.divIcon({
      className: "",
      html: pinHtml(options),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    iconCache.current.set(key, icon);
    return icon;
  }, []);
  const [data, setData] = useState({ features: [], candidates: [], clustered: false, fictional: [] });
  // Which point's popup is open. Without it a reader cannot tell WHICH pin they hit — the
  // popup appears near a cluster of pins and every one of them still looks the same, which
  // is the "непонятно, на что ты нажал" complaint exactly.
  const [openPoint, setOpenPoint] = useState(null);
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

        // One shape for every place, with the count printed on it. Canvas circles could
        // not hold text, and the count is the thing the reader most needs: 566 of the
        // 2,024 Los Angeles points carry more than one film and the busiest carries 96.
        const pointKey = `${lat},${lng}`;
        const isOpen = openPoint === pointKey;
        const icon = iconFor({
          filmCount: props.work_count,
          checked: props.status === "verified",
          depicts_elsewhere: props.depicts_elsewhere,
          selected: isOpen,
        });

        return (
          <Marker
            key={`candidate-${lat}-${lng}-${index}`}
            position={[lat, lng]}
            icon={icon}
            // The marker is raised while its popup is open, so it is not buried under the
            // neighbours it was picked out of.
            zIndexOffset={isOpen ? 1000 : 0}
            eventHandlers={{
              click: () => onSelect?.(feature),
              popupopen: () => setOpenPoint(pointKey),
              popupclose: () => setOpenPoint((current) => (current === pointKey ? null : current)),
            }}
          >
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
              {/* The films themselves. Before the points were grouped this was
                  unreachable — every film after the first was drawn underneath the pin
                  you could see. */}
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
              {props.films_truncated && (
                <small>Showing {props.films.length} of {props.work_count} — open the place to see them all.</small>
              )}
              <br />
              <small>{candidateSummary(props)}</small>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// Memoised, and this is the measurement it exists for.
//
// Every state change in the parent — opening the layers menu, opening the legend — re-ran
// this component and with it the whole marker list: 1,008 <Marker> elements, each with a
// <Popup> holding a list of films. React had to build and diff all of it to discover that
// none of it had changed. One click on the layers button blocked the main thread for
// **250 ms** with 1,008 pins drawn, and **45 ms** with 10 — the difference was the pins,
// and nothing about the pins was what the click changed.
//
// So the props are all referentially stable at the call site — `onSelect` is a module
// constant, the two `on…` props are setState functions, `isMine` is a useMemo — and a
// parent render that changes none of them now skips this subtree entirely.
export default memo(GraphLayer);
