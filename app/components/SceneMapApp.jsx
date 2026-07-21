"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { Clapperboard, Crosshair, ExternalLink, MapPin, Plus, Route, Search, X } from "lucide-react";

import {
  DEMO_LOCATION,
  RADIUS_OPTIONS_METERS,
  findNearby,
  formatDistanceMeters,
  zoomForRadius,
} from "../lib/nearby.mjs";

const londonCenter = [51.5094, -0.1183];

const fallbackFilms = [
  {
    id: "notting-hill",
    title: "Notting Hill",
    year: 1999,
    code: "NH",
  },
  {
    id: "skyfall",
    title: "Skyfall",
    year: 2012,
    code: "007",
  },
  {
    id: "harry-potter",
    title: "Harry Potter",
    year: 2001,
    code: "HP",
  },
  {
    id: "sherlock",
    title: "Sherlock Holmes",
    year: 2009,
    code: "SH",
  },
  {
    id: "love-actually",
    title: "Love Actually",
    year: 2003,
    code: "LA",
  },
];

const fallbackLocations = [
  {
    id: "portobello-road",
    filmId: "notting-hill",
    film: "Notting Hill",
    scene: "Portobello morning walk",
    place: "Portobello Road Market",
    description: "William walks through the changing seasons of Notting Hill, turning a street market into the film's emotional timeline.",
    position: [51.5156, -0.2057],
    backdrop: "https://images.unsplash.com/photo-1533929736458-ca588d08c8be?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1555085634-25c3c9c10b6b?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "blue-door",
    filmId: "notting-hill",
    film: "Notting Hill",
    scene: "The blue door",
    place: "Westbourne Park Road",
    description: "The private home behind the blue door anchors the romance in a real London neighborhood.",
    position: [51.5174, -0.1993],
    backdrop: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1578269174936-2709b6aeb913?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "mi6",
    filmId: "skyfall",
    film: "Skyfall",
    scene: "MI6 on the Thames",
    place: "Vauxhall Cross",
    description: "Bond's world is framed by the real MI6 headquarters on the river, one of modern spy cinema's clearest London signals.",
    position: [51.4874, -0.1247],
    backdrop: "https://images.unsplash.com/photo-1510279770292-4b34de9f5c23?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "national-gallery",
    filmId: "skyfall",
    film: "Skyfall",
    scene: "Q meets Bond",
    place: "National Gallery",
    description: "Bond and Q meet in front of Turner's painting, setting the old-versus-new theme in a public landmark.",
    position: [51.5089, -0.1283],
    backdrop: "https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "kings-cross",
    filmId: "harry-potter",
    film: "Harry Potter",
    scene: "Platform 9 3/4",
    place: "King's Cross Station",
    description: "The gateway to Hogwarts turns a busy railway station into a pilgrimage point for fans.",
    position: [51.532, -0.1233],
    backdrop: "https://images.unsplash.com/photo-1517563259479-5b9d0f9d0448?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1590253230532-a67f6bc61c9e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "leadenhall",
    filmId: "harry-potter",
    film: "Harry Potter",
    scene: "Entrance to Diagon Alley",
    place: "Leadenhall Market",
    description: "Victorian arches stand in for the magical shopping street hidden inside ordinary London.",
    position: [51.5126, -0.0834],
    backdrop: "https://images.unsplash.com/photo-1533929736458-ca588d08c8be?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "st-pauls",
    filmId: "sherlock",
    film: "Sherlock Holmes",
    scene: "Old London pursuit",
    place: "St Paul's Cathedral",
    description: "The cathedral and surrounding streets sell the film's smoky, industrial version of London.",
    position: [51.5138, -0.0984],
    backdrop: "https://images.unsplash.com/photo-1543832923-44667a44c804?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1520986606214-8b456906c813?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "parliament",
    filmId: "sherlock",
    film: "Sherlock Holmes",
    scene: "Westminster stakes",
    place: "Houses of Parliament",
    description: "The detective story borrows Westminster's silhouette to make the conspiracy feel national.",
    position: [51.4995, -0.1248],
    backdrop: "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1496307653780-42ee777d4833?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "south-bank",
    filmId: "love-actually",
    film: "Love Actually",
    scene: "Riverside London",
    place: "South Bank",
    description: "The ensemble romance uses the Thames walk to make separate lives feel connected by the same city.",
    position: [51.5066, -0.1162],
    backdrop: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "somerset-house",
    filmId: "love-actually",
    film: "Love Actually",
    scene: "Christmas London",
    place: "Somerset House",
    description: "A classic central London courtyard gives the film its polished winter-city texture.",
    position: [51.5111, -0.1171],
    backdrop: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&w=1200&q=80",
    now: "https://images.unsplash.com/photo-1577048982768-5cb3e7ddfa23?auto=format&fit=crop&w=1200&q=80",
  },
];

function locationsFromApi(records) {
  return records
    .map((record) => ({
      id: `${record.work_wikidata_id}-${record.loc_wikidata_id}`,
      filmId: record.work_wikidata_id,
      film: record.work_title,
      scene: record.work_title,
      place: record.loc_name,
      description: `Filming location for ${record.work_title}${record.work_year ? ` (${record.work_year})` : ""}.`,
      position: [record.lat, record.lng],
      backdrop: record.commons_image,
      now: record.commons_image,
      year: record.work_year,
    }))
    .filter((location) => Number.isFinite(location.position[0]) && Number.isFinite(location.position[1]));
}

function filmsFromLocations(sourceLocations) {
  return [...new Map(sourceLocations.map((location) => [
    location.filmId,
    {
      id: location.filmId,
      title: location.film,
      year: location.year,
      code: location.film.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
    },
  ])).values()].slice(0, 5);
}

function RecenterOnSelection({ center, position }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(center, 12, { duration: 0.8 });
  }, [center, map]);

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

function makeMarkerIcon(selected, nearest) {
  return L.divIcon({
    className: "",
    html: `<span class="scene-pin${selected ? " is-selected" : ""}${nearest ? " is-nearest" : ""}"><span></span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 34],
  });
}

const userIcon = L.divIcon({
  className: "",
  html: '<span class="user-pin"><span></span></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function FlyToUser({ position, radius }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, zoomForRadius(radius), { duration: 0.8 });
    }
  }, [map, position, radius]);

  return null;
}

const GEOLOCATION_ERRORS = {
  1: {
    status: "denied",
    message: "Location access was denied. You can retry or use the demo location.",
  },
  2: {
    status: "unavailable",
    message: "Your position is unavailable right now. Try again or use the demo location.",
  },
  3: {
    status: "timeout",
    message: "Locating took too long. Try again or use the demo location.",
  },
};

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

function makeImageSearchUrl(location) {
  const scene = location.scene?.trim();
  const query = [
    `"${location.film}"`,
    `"${location.place}"`,
    scene && scene.toLowerCase() !== location.film.toLowerCase() ? `"${scene}"` : null,
    "movie scene filming location",
  ].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q: query });

  return `https://www.bing.com/images/search?${params.toString()}`;
}

export default function SceneMapApp() {
  const [liveLocations, setLiveLocations] = useState(null);
  const [mapCenter, setMapCenter] = useState(londonCenter);
  const [cityQuery, setCityQuery] = useState("London");
  const [cityName, setCityName] = useState("London");
  const [citySearchStatus, setCitySearchStatus] = useState("");
  const routeRequestId = useRef(0);
  const [selectedFilms, setSelectedFilms] = useState(() => fallbackFilms.map((film) => film.id));
  const [activeLocation, setActiveLocation] = useState(fallbackLocations[0]);
  const [routeStops, setRouteStops] = useState([]);
  const [routeStatus, setRouteStatus] = useState("idle");
  const [routeResult, setRouteResult] = useState(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [nearbyStatus, setNearbyStatus] = useState("idle");
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [userPosition, setUserPosition] = useState(null);
  const [userIsDemo, setUserIsDemo] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(RADIUS_OPTIONS_METERS[2]);

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        const response = await fetch(`/api/locations?lat=${mapCenter[0]}&lng=${mapCenter[1]}&radius=5&limit=30`);
        if (!response.ok) throw new Error("Locations API failed");
        const payload = await response.json();
        const nextLocations = locationsFromApi(payload.locations ?? []);
        if (!nextLocations.length) throw new Error("Locations API returned no usable points");
        if (cancelled) return;

        const nextFilms = filmsFromLocations(nextLocations);
        setLiveLocations(nextLocations);
        setSelectedFilms(nextFilms.map((film) => film.id));
        setActiveLocation(nextLocations[0]);
        setRouteStops([]);
        setRouteResult(null);
        setRouteStatus("idle");
        setRouteMessage("");
      } catch {
        // Keep the local demo locations visible if Wikidata is temporarily unavailable.
      }
    }

    loadLocations();
    return () => { cancelled = true; };
  }, [mapCenter]);

  const sourceLocations = liveLocations ?? fallbackLocations;
  const films = useMemo(
    () => liveLocations ? filmsFromLocations(sourceLocations) : fallbackFilms,
    [liveLocations, sourceLocations],
  );

  const visibleLocations = useMemo(
    () => sourceLocations.filter((location) => selectedFilms.includes(location.filmId)),
    [selectedFilms, sourceLocations],
  );

  const routePositions = routeResult?.positions ?? [];

  const nearby = useMemo(
    () => (userPosition ? findNearby(userPosition, visibleLocations, nearbyRadius) : null),
    [nearbyRadius, userPosition, visibleLocations],
  );

  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyStatus("unavailable");
      setNearbyMessage("This browser has no geolocation. Use the demo location instead.");
      return;
    }

    setNearbyStatus("locating");
    setNearbyMessage("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setUserPosition([result.coords.latitude, result.coords.longitude]);
        setUserIsDemo(false);
        setNearbyStatus("ready");
        setNearbyMessage("");
      },
      (error) => {
        const known = GEOLOCATION_ERRORS[error.code] ?? GEOLOCATION_ERRORS[2];
        setNearbyStatus(known.status);
        setNearbyMessage(known.message);
      },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 8000 },
    );
  }

  function useDemoLocation() {
    setUserPosition(DEMO_LOCATION.position);
    setUserIsDemo(true);
    setNearbyStatus("ready");
    setNearbyMessage("");
  }

  function invalidateRoute() {
    routeRequestId.current += 1;
    setRouteResult(null);
    setRouteStatus("idle");
    setRouteMessage("");
  }

  function toggleFilm(filmId) {
    setSelectedFilms((current) => {
      const next = current.includes(filmId)
        ? current.filter((id) => id !== filmId)
        : [...current, filmId];

      return next.length ? next : current;
    });
  }

  function addRouteStop(location) {
    if (routeStops.some((stop) => stop.id === location.id) || routeStops.length >= 5) return;

    setRouteStops([...routeStops, location]);
    invalidateRoute();
  }

  function removeRouteStop(locationId) {
    setRouteStops(routeStops.filter((stop) => stop.id !== locationId));
    invalidateRoute();
  }

  async function buildRoute() {
    const requestId = routeRequestId.current + 1;
    routeRequestId.current = requestId;
    setRouteResult(null);
    setRouteStatus("loading");
    setRouteMessage("");

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: routeStops.map((stop) => stop.position) }),
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

      setRouteResult(makeFallbackRoute(routeStops));
      setRouteStatus("fallback");
      setRouteMessage(
        "The walking router is unavailable, so the line between stops is approximate.",
      );
    }
  }

  async function searchCity(event) {
    event.preventDefault();
    const query = cityQuery.trim();
    if (!query) return;

    setCitySearchStatus("Searching city…");
    try {
      const response = await fetch(`/api/cities?q=${encodeURIComponent(query)}`);
      const city = await response.json();
      if (!response.ok) throw new Error(city.error);

      setMapCenter([city.lat, city.lng]);
      setCityName(city.name);
      setLiveLocations([]);
      setActiveLocation(null);
      setRouteStops([]);
      invalidateRoute();
      setCitySearchStatus("");
    } catch {
      setCitySearchStatus("City not found");
    }
  }

  return (
    <main className="scene-shell">
      <section className="map-stage" aria-label="SceneMap locations map">
        <MapContainer center={mapCenter} zoom={12} minZoom={11} maxZoom={17} zoomControl={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <RecenterOnSelection center={mapCenter} position={activeLocation?.position} />
          <FitRoute positions={routePositions} />
          <FlyToUser position={userPosition} radius={nearbyRadius} />
          {userPosition && (
            <>
              <Circle
                center={userPosition}
                radius={nearbyRadius}
                pathOptions={{ color: "#f7b733", fillOpacity: 0.06, opacity: 0.5, weight: 1.5 }}
              />
              <Marker icon={userIcon} position={userPosition}>
                <Popup>{userIsDemo ? DEMO_LOCATION.label : "You are here"}</Popup>
              </Marker>
            </>
          )}
          {visibleLocations.map((location) => (
            <Marker
              key={location.id}
              position={location.position}
              icon={makeMarkerIcon(
                activeLocation?.id === location.id,
                nearby?.nearest?.location.id === location.id,
              )}
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

      <aside className="command-panel" aria-label="Film selection">
        <div className="brand-row">
          <div className="brand-mark">
            <Clapperboard size={22} />
          </div>
          <div>
            <p className="eyebrow">SceneMap MVP</p>
            <h1>Film map · {cityName}</h1>
          </div>
        </div>

        <form className="city-search" onSubmit={searchCity}>
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="City"
            onChange={(event) => setCityQuery(event.target.value)}
            placeholder="City"
            type="search"
            value={cityQuery}
          />
          <button aria-label="Search city" className="ghost-button" type="submit">
            <Search size={17} />
          </button>
        </form>
        {citySearchStatus && <p className="eyebrow city-search-status">{citySearchStatus}</p>}

        <div className="nearby-card" aria-label="Nearby locations">
          <div className="nearby-actions">
            <button
              className="ghost-button nearby-cta"
              disabled={nearbyStatus === "locating"}
              onClick={locateMe}
              type="button"
            >
              <Crosshair size={17} />
              {nearbyStatus === "locating" ? "Locating..." : "What's nearby?"}
            </button>
            {(nearbyStatus === "denied" ||
              nearbyStatus === "unavailable" ||
              nearbyStatus === "timeout") && (
              <button className="ghost-button" onClick={useDemoLocation} type="button">
                Use demo location
              </button>
            )}
          </div>

          {nearbyMessage && (
            <p className="nearby-status" role="status">{nearbyMessage}</p>
          )}

          {userPosition && (
            <>
              <div className="radius-chips" role="group" aria-label="Search radius">
                {RADIUS_OPTIONS_METERS.map((radius) => (
                  <button
                    aria-pressed={nearbyRadius === radius}
                    className={`radius-chip${nearbyRadius === radius ? " is-selected" : ""}`}
                    key={radius}
                    onClick={() => setNearbyRadius(radius)}
                    type="button"
                  >
                    {formatDistanceMeters(radius)}
                  </button>
                ))}
              </div>

              {nearby?.nearest ? (
                <button
                  className="nearby-result"
                  onClick={() => setActiveLocation(nearby.nearest.location)}
                  type="button"
                >
                  <MapPin size={17} aria-hidden="true" />
                  <span>
                    <strong>{nearby.nearest.location.place}</strong>
                    <small>
                      {nearby.nearest.location.film} ·{" "}
                      {formatDistanceMeters(nearby.nearest.distanceMeters)} away
                      {nearby.nearest.distanceMeters > nearbyRadius
                        ? " · outside radius"
                        : ""}
                    </small>
                  </span>
                </button>
              ) : (
                <p className="nearby-status" role="status">
                  No film locations loaded for this city yet.
                </p>
              )}

              <p className="nearby-count">
                {nearby?.inRadius.length ?? 0} location{(nearby?.inRadius.length ?? 0) === 1 ? "" : "s"} within{" "}
                {formatDistanceMeters(nearbyRadius)}
                {userIsDemo ? ` · ${DEMO_LOCATION.label}` : ""}
              </p>
            </>
          )}
        </div>

        <div className="film-grid" aria-label="Selected films">
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

        <div className="location-list" aria-label="Map locations">
          <div className="section-row">
            <p className="eyebrow">Locations</p>
            <span>{visibleLocations.length} in {cityName}</span>
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
                aria-label={`Add ${location.place} to route`}
              >
                <Plus size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="route-card">
          <div>
            <p className="eyebrow">Route</p>
            <strong>{routeStops.length} / 5 stops</strong>
          </div>
          <button
            className={`primary-button${routeResult ? " is-complete" : ""}`}
            disabled={routeStops.length < 3 || routeStatus !== "idle"}
            onClick={buildRoute}
            type="button"
          >
            <Route size={18} />
            {routeStatus === "loading"
              ? "Building..."
              : routeStatus === "fallback"
                ? "Approximate route"
                : routeResult
                ? "Route ready"
                : "Build route"}
          </button>
        </div>

        {routeStops.length > 0 && (
          <ol className="route-list">
            {routeStops.map((stop, index) => (
              <li key={stop.id}>
                <button type="button" onClick={() => setActiveLocation(stop)}>
                  <span>{index + 1}</span>
                  {stop.place}
                </button>
                <button className="icon-button" type="button" onClick={() => removeRouteStop(stop.id)} aria-label="Remove stop">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {routeStatus === "loading" && (
          <p className="route-summary" role="status">
            Building a walking route through London...
          </p>
        )}

        {routeResult && (
          <div
            className={`route-summary${routeResult.source === "fallback" ? " is-fallback" : ""}`}
            role="status"
          >
            <strong>
              Walk {routeResult.distanceKm.toFixed(1)} km · {routeResult.durationMinutes} min
            </strong>
            {routeResult.source === "fallback" ? (
              <span>{routeMessage}</span>
            ) : (
              <span>
                Route follows mapped streets ·{" "}
                <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">
                  OpenStreetMap routing
                </a>
                {" · "}
                <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
                  fix the map
                </a>
              </span>
            )}
          </div>
        )}
      </aside>

      {activeLocation && (
        <section className="location-sheet" aria-label="Location details">
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
                <figcaption>film frame / scene mood</figcaption>
              </figure>
              <figure>
                <img src={activeLocation.now} alt="" onError={(event) => event.currentTarget.remove()} />
                <figcaption>location today</figcaption>
              </figure>
            </div>
            <a
              className="ghost-button image-search-link"
              href={makeImageSearchUrl(activeLocation)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Search size={18} />
              Find scenes filmed here
              <ExternalLink size={15} />
            </a>
            <button className="wide-button" type="button" onClick={() => addRouteStop(activeLocation)}>
              <Route size={18} />
              Add to route
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
