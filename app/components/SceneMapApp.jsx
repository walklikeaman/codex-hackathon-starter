"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { Clapperboard, LoaderCircle, MapPin, Plus, Route, Search, Sparkles, Upload, X } from "lucide-react";
import { films, locations, londonCenter } from "../lib/scenemap-data";

function RecenterOnSelection({ position }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, 14, { duration: 0.8 });
    }
  }, [map, position]);

  return null;
}

function FitRoute({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), {
        animate: true,
        maxZoom: 14,
        padding: [48, 48],
      });
    }
  }, [map, positions]);

  return null;
}

function makeMarkerIcon(selected) {
  return L.divIcon({
    className: "",
    html: `<span class="scene-pin${selected ? " is-selected" : ""}"><span></span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 34],
  });
}

function kmBetween(routeStops) {
  if (routeStops.length < 2) return 0;

  return routeStops.slice(1).reduce((sum, stop, index) => {
    const [lat1, lon1] = routeStops[index].position;
    const [lat2, lon2] = stop.position;
    const toRad = (value) => (value * Math.PI) / 180;
    const earthKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return sum + earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, 0);
}

function makeFallbackRoute(routeStops) {
  const distanceKm = kmBetween(routeStops);

  return {
    positions: routeStops.map((stop) => stop.position),
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes: Math.max(8, Math.round((distanceKm / 4.6) * 60)),
    source: "fallback",
  };
}

export default function SceneMapApp() {
  const routeRequestId = useRef(0);
  const [selectedFilms, setSelectedFilms] = useState(() => films.map((film) => film.id));
  const [activeLocation, setActiveLocation] = useState(locations[0]);
  const [routeStops, setRouteStops] = useState([]);
  const [routeStatus, setRouteStatus] = useState("idle");
  const [routeResult, setRouteResult] = useState(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [tourFilmId, setTourFilmId] = useState(films[0].id);
  const [aiTour, setAiTour] = useState(null);
  const [aiTourStatus, setAiTourStatus] = useState("idle");
  const [aiTourError, setAiTourError] = useState("");

  const visibleLocations = useMemo(
    () => locations.filter((location) => selectedFilms.includes(location.filmId)),
    [selectedFilms],
  );

  const routePositions = routeResult?.positions ?? [];

  function invalidateRoute() {
    routeRequestId.current += 1;
    setRouteResult(null);
    setRouteStatus("idle");
    setRouteMessage("");
  }

  function toggleFilm(filmId) {
    setAiTour(null);
    setAiTourError("");
    setSelectedFilms((current) => {
      const next = current.includes(filmId)
        ? current.filter((id) => id !== filmId)
        : [...current, filmId];

      return next.length ? next : current;
    });
  }

  function addRouteStop(location) {
    if (routeStops.some((stop) => stop.id === location.id) || routeStops.length >= 5) return;

    setAiTour(null);
    setAiTourError("");
    setRouteStops([...routeStops, location]);
    invalidateRoute();
  }

  function removeRouteStop(locationId) {
    setAiTour(null);
    setAiTourError("");
    setRouteStops(routeStops.filter((stop) => stop.id !== locationId));
    invalidateRoute();
  }

  async function buildRoute(stops = routeStops) {
    const requestId = routeRequestId.current + 1;
    routeRequestId.current = requestId;
    setRouteResult(null);
    setRouteStatus("loading");
    setRouteMessage("");

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: stops.map((stop) => stop.position) }),
      });
      const payload = await response.json();

      if (
        !response.ok ||
        !Array.isArray(payload?.positions) ||
        payload.positions.length < 2 ||
        !Number.isFinite(payload?.distanceKm) ||
        !Number.isFinite(payload?.durationMinutes)
      ) {
        throw new Error(payload?.error || "Walking route response is invalid");
      }

      if (requestId !== routeRequestId.current) return;

      setRouteResult(payload);
      setRouteStatus("ready");
    } catch {
      if (requestId !== routeRequestId.current) return;

      setRouteResult(makeFallbackRoute(stops));
      setRouteStatus("fallback");
      setRouteMessage(
        "Роутер недоступен — показываем приблизительную линию между точками.",
      );
    }
  }

  async function buildAiTour() {
    setAiTourStatus("loading");
    setAiTourError("");

    try {
      const response = await fetch("/api/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filmId: tourFilmId }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось собрать AI-экскурсию");
      }

      const orderedStops = payload.stops.map((stop) =>
        locations.find((location) => location.id === stop.locationId),
      );

      if (orderedStops.some((stop) => !stop)) {
        throw new Error("AI вернул неизвестную точку маршрута");
      }

      setSelectedFilms([tourFilmId]);
      setRouteStops(orderedStops);
      setActiveLocation(orderedStops[0]);
      setAiTour(payload);
      setAiTourStatus("success");
      await buildRoute(orderedStops);
    } catch (error) {
      setAiTour(null);
      setAiTourStatus("error");
      setAiTourError(error instanceof Error ? error.message : "Не удалось собрать AI-экскурсию");
    }
  }

  return (
    <main className="scene-shell">
      <section className="map-stage" aria-label="Карта локаций SceneMap">
        <MapContainer center={londonCenter} zoom={12} minZoom={11} maxZoom={17} zoomControl={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <RecenterOnSelection position={activeLocation?.position} />
          <FitRoute positions={routePositions} />
          {visibleLocations.map((location) => (
            <Marker
              key={location.id}
              position={location.position}
              icon={makeMarkerIcon(activeLocation?.id === location.id)}
              eventHandlers={{
                click: () => setActiveLocation(location),
              }}
            >
              <Popup>
                <strong>{location.film}</strong>
                <br />
                {location.place}
              </Popup>
            </Marker>
          ))}
          {routePositions.length > 1 && (
            <Polyline
              positions={routePositions}
              pathOptions={{
                color: "#f7b733",
                dashArray: routeResult?.source === "fallback" ? "8 10" : undefined,
                opacity: routeResult?.source === "fallback" ? 0.7 : 0.95,
                weight: 5,
              }}
            />
          )}
        </MapContainer>
      </section>

      <aside className="command-panel" aria-label="Выбор фильмов">
        <div className="brand-row">
          <div className="brand-mark">
            <Clapperboard size={22} />
          </div>
          <div>
            <p className="eyebrow">SceneMap MVP</p>
            <h1>Кино-прогулка по Лондону</h1>
          </div>
        </div>

        <div className="action-row">
          <button className="ghost-button" type="button">
            <Search size={17} />
            Галерея
          </button>
          <button className="ghost-button" type="button">
            <Upload size={17} />
            CSV позже
          </button>
        </div>

        <div className="film-grid" aria-label="Выбранные фильмы">
          {films.map((film) => {
            const selected = selectedFilms.includes(film.id);

            return (
              <button
                className={`film-chip${selected ? " is-selected" : ""}`}
                key={film.id}
                onClick={() => toggleFilm(film.id)}
                type="button"
                aria-pressed={selected}
              >
                <span className="poster-tile" aria-hidden="true">{film.code}</span>
                <span>
                  <strong>{film.title}</strong>
                  <small>{film.year}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="ai-tour-card">
          <div className="ai-tour-heading">
            <span className="ai-tour-icon" aria-hidden="true">
              <Sparkles size={17} />
            </span>
            <div>
              <p className="eyebrow">AI-гид</p>
              <strong>Экскурсия по фильму</strong>
            </div>
          </div>
          <div className="ai-tour-controls">
            <label>
              <span className="sr-only">Фильм для AI-экскурсии</span>
              <select
                value={tourFilmId}
                onChange={(event) => {
                  setTourFilmId(event.target.value);
                  setAiTour(null);
                  setAiTourError("");
                }}
                disabled={aiTourStatus === "loading"}
              >
                {films.map((film) => (
                  <option key={film.id} value={film.id}>{film.title}</option>
                ))}
              </select>
            </label>
            <button
              className="ai-tour-button"
              type="button"
              onClick={buildAiTour}
              disabled={aiTourStatus === "loading"}
            >
              {aiTourStatus === "loading" ? (
                <LoaderCircle className="loading-icon" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              {aiTourStatus === "loading" ? "Собираю…" : "Создать"}
            </button>
          </div>
          {aiTourError && <p className="ai-tour-error" role="alert">{aiTourError}</p>}
          {aiTour && (
            <div className="ai-tour-ready" aria-live="polite">
              <strong>{aiTour.title}</strong>
              <span>{aiTour.intro}</span>
            </div>
          )}
        </div>

        <div className="location-list" aria-label="Точки на карте">
          <div className="section-row">
            <p className="eyebrow">Точки</p>
            <span>{visibleLocations.length} в Лондоне</span>
          </div>
          {visibleLocations.map((location) => (
            <div className="location-row" key={location.id}>
              <button type="button" onClick={() => setActiveLocation(location)}>
                <strong>{location.place}</strong>
                <span>{location.film}</span>
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => addRouteStop(location)}
                aria-label={`Добавить ${location.place} в маршрут`}
              >
                <Plus size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="route-card">
          <div>
            <p className="eyebrow">Маршрут</p>
            <strong>{routeStops.length} / 5 точек</strong>
          </div>
          <button
            className={`primary-button${routeResult ? " is-complete" : ""}`}
            disabled={routeStops.length < 3 || routeStatus !== "idle"}
            onClick={() => buildRoute()}
            type="button"
          >
            <Route size={18} />
            {routeStatus === "loading"
              ? "Строим..."
              : routeStatus === "fallback"
                ? "Маршрут примерный"
                : routeResult
                ? "Маршрут готов"
                : "Построить"}
          </button>
        </div>

        {aiTour && (
          <section className="ai-tour-result" aria-live="polite">
            <p className="eyebrow">Истории на остановках</p>
            <ol>
              {aiTour.stops.map((stop) => {
                const location = locations.find((item) => item.id === stop.locationId);

                return (
                  <li key={stop.locationId}>
                    <strong>{location?.place}</strong>
                    <span>{stop.narration}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {routeStops.length > 0 && (
          <ol className="route-list">
            {routeStops.map((stop, index) => (
              <li key={stop.id}>
                <button type="button" onClick={() => setActiveLocation(stop)}>
                  <span>{index + 1}</span>
                  {stop.place}
                </button>
                <button className="icon-button" type="button" onClick={() => removeRouteStop(stop.id)} aria-label="Убрать точку">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {routeStatus === "loading" && (
          <p className="route-summary" role="status">
            Строим маршрут по пешеходным улицам Лондона...
          </p>
        )}

        {routeResult && (
          <div
            className={`route-summary${routeResult.source === "fallback" ? " is-fallback" : ""}`}
            role="status"
          >
            <strong>
              Пешком {routeResult.distanceKm.toFixed(1)} км · {routeResult.durationMinutes} мин
            </strong>
            {routeResult.source === "fallback" ? (
              <span>{routeMessage}</span>
            ) : (
              <span>
                {aiTour ? "AI выбрал порядок остановок · " : ""}
                Маршрут построен по улицам ·{" "}
                <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">
                  OpenStreetMap routing
                </a>
                {" · "}
                <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
                  исправить карту
                </a>
              </span>
            )}
          </div>
        )}
      </aside>

      {activeLocation && (
        <section className="location-sheet" aria-label="Карточка локации">
          <div className="sheet-media">
            <img src={activeLocation.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />
            <div>
              <p>{activeLocation.film}</p>
              <h2>{activeLocation.scene}</h2>
            </div>
          </div>

          <div className="sheet-body">
            <div className="place-row">
              <MapPin size={19} />
              <div>
                <strong>{activeLocation.place}</strong>
                <span>{activeLocation.position[0].toFixed(4)}, {activeLocation.position[1].toFixed(4)}</span>
              </div>
            </div>
            <p>{activeLocation.description}</p>
            <div className="comparison-grid">
              <figure>
                <img src={activeLocation.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />
                <figcaption>кадр / настроение сцены</figcaption>
              </figure>
              <figure>
                <img src={activeLocation.now} alt="" onError={(event) => event.currentTarget.remove()} />
                <figcaption>место сейчас</figcaption>
              </figure>
            </div>
            <button className="wide-button" type="button" onClick={() => addRouteStop(activeLocation)}>
              <Route size={18} />
              В маршрут
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
