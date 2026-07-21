"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { BookOpen, CheckCircle2, Clapperboard, Film, Link2, MapPin, Plus, Route, Search, Upload, User, X } from "lucide-react";

const londonCenter = [51.5094, -0.1183];

const films = [
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

const books = [
  { id: "paddington", title: "A Bear Called Paddington", author: "Michael Bond", year: 1958 },
  { id: "sherlock", title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", year: 1892 },
  { id: "harry-potter-book", title: "Harry Potter and the Philosopher's Stone", author: "J. K. Rowling", year: 1997 },
  { id: "mrs-dalloway", title: "Mrs Dalloway", author: "Virginia Woolf", year: 1925 },
];

const connectorDetails = [
  { id: "letterboxd", name: "Letterboxd", note: "Import your diary or watchlist CSV" },
  { id: "imdb", name: "IMDb", note: "Import your ratings or check-ins CSV" },
];

const locations = [
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
        padding: [64, 64],
        maxZoom: 14,
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

export default function SceneMapApp() {
  const connectorInputRef = useRef(null);
  const [selectedFilms, setSelectedFilms] = useState(() => films.map((film) => film.id));
  const [filmQuery, setFilmQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingConnector, setPendingConnector] = useState(null);
  const [connectedServices, setConnectedServices] = useState({});
  const [activeLocation, setActiveLocation] = useState(locations[0]);
  const [routeStops, setRouteStops] = useState([]);
  const [route, setRoute] = useState(null);
  const [routeStatus, setRouteStatus] = useState("idle");

  const matchingFilms = useMemo(() => {
    const query = filmQuery.trim().toLowerCase();

    if (!query) return films;

    return films.filter((film) =>
      `${film.title} ${film.year} ${film.code}`.toLowerCase().includes(query),
    );
  }, [filmQuery]);

  const matchingBooks = useMemo(() => {
    const query = filmQuery.trim().toLowerCase();
    if (!query) return [];

    return books.filter((book) =>
      `${book.title} ${book.author} ${book.year}`.toLowerCase().includes(query),
    );
  }, [filmQuery]);

  const visibleLocations = useMemo(() => {
    const matchingFilmIds = new Set(matchingFilms.map((film) => film.id));

    return locations.filter(
      (location) => selectedFilms.includes(location.filmId) && matchingFilmIds.has(location.filmId),
    );
  }, [matchingFilms, selectedFilms]);

  useEffect(() => {
    if (!visibleLocations.length) {
      if (activeLocation) setActiveLocation(null);
      return;
    }

    if (!activeLocation || !visibleLocations.some((location) => location.id === activeLocation.id)) {
      setActiveLocation(visibleLocations[0]);
    }
  }, [activeLocation, visibleLocations]);

  const routePositions = route?.positions ?? [];
  const routeKm = route ? route.distanceMeters / 1000 : kmBetween(routeStops);
  const routeMinutes = route
    ? Math.max(1, Math.round(route.durationSeconds / 60))
    : Math.max(8, Math.round((routeKm / 4.6) * 60));

  function clearRoute() {
    setRoute(null);
    setRouteStatus("idle");
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
    setRouteStops((current) => {
      if (current.some((stop) => stop.id === location.id)) return current;
      return [...current, location].slice(0, 5);
    });
    clearRoute();
  }

  function removeRouteStop(locationId) {
    setRouteStops((current) => current.filter((stop) => stop.id !== locationId));
    clearRoute();
  }

  function chooseConnectorFile(connectorId) {
    setPendingConnector(connectorId);
    connectorInputRef.current?.click();
  }

  async function importConnector(event) {
    const file = event.target.files?.[0];
    if (file && pendingConnector) {
      const exportText = (await file.text()).toLowerCase();
      const matchedFilmIds = films
        .filter((film) => exportText.includes(film.title.toLowerCase()))
        .map((film) => film.id);

      if (matchedFilmIds.length) setSelectedFilms(matchedFilmIds);
      setConnectedServices((current) => ({
        ...current,
        [pendingConnector]: { fileName: file.name, matchedFilms: matchedFilmIds.length },
      }));
    }
    event.target.value = "";
    setPendingConnector(null);
  }

  async function buildRoute() {
    const fallbackKm = kmBetween(routeStops);
    const fallback = {
      positions: routeStops.map((stop) => stop.position),
      distanceMeters: fallbackKm * 1000,
      durationSeconds: Math.max(8, Math.round((fallbackKm / 4.6) * 60)) * 60,
    };

    setRoute(null);
    setRouteStatus("loading");

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: routeStops.map((stop) => stop.position) }),
      });
      const data = await response.json();

      if (!response.ok || !Array.isArray(data.positions) || data.positions.length < 2) {
        throw new Error(data.error || "Route unavailable");
      }

      setRoute(data);
      setRouteStatus("ready");
    } catch {
      setRoute(fallback);
      setRouteStatus("fallback");
    }
  }

  return (
    <main className="scene-shell">
      <section className="map-stage" aria-label="SceneMap locations map">
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
            <Polyline positions={routePositions} pathOptions={{ color: "#f7b733", weight: 5, opacity: 0.9 }} />
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
            <h1>A film walk through London</h1>
          </div>
          <button className="account-button" type="button" onClick={() => setAccountOpen(true)}>
            <User size={18} />
            Account
          </button>
        </div>

        <div className="action-row">
          <div className="film-search">
            <Search size={17} />
            <label className="sr-only" htmlFor="film-search">Search films and books</label>
            <input
              id="film-search"
              type="search"
              value={filmQuery}
              onChange={(event) => setFilmQuery(event.target.value)}
              placeholder="Search films and books"
              autoComplete="off"
            />
            {filmQuery && (
              <button
                className="clear-search"
                type="button"
                onClick={() => setFilmQuery("")}
                aria-label="Clear film search"
                title="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button className="ghost-button" type="button">
            <Upload size={17} />
            CSV later
          </button>
        </div>

        <div className="film-grid" aria-label="Film search results" aria-live="polite">
          {matchingFilms.map((film) => {
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
          {matchingFilms.length === 0 && matchingBooks.length === 0 && (
            <p className="film-empty">No films or books match "{filmQuery.trim()}".</p>
          )}
        </div>

        {matchingBooks.length > 0 && (
          <div className="book-results" aria-label="Book search results">
            <div className="section-row">
              <p className="eyebrow">Books</p>
              <span>{matchingBooks.length} found</span>
            </div>
            {matchingBooks.map((book) => (
              <article className="book-result" key={book.id}>
                <BookOpen size={18} />
                <div>
                  <strong>{book.title}</strong>
                  <span>{book.author} · {book.year}</span>
                </div>
              </article>
            ))}
            <p className="search-note">Book locations are a preview and are not added to the film map yet.</p>
          </div>
        )}

        <div className="location-list" aria-label="Map locations">
          <div className="section-row">
            <p className="eyebrow">Locations</p>
            <span>{visibleLocations.length} in London</span>
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
                aria-label={`Add ${location.place} to the route`}
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
            className="primary-button"
            disabled={routeStops.length < 3 || routeStatus === "loading"}
            onClick={buildRoute}
            type="button"
          >
            <Route size={18} />
            {routeStatus === "loading" ? "Building..." : "Build route"}
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

        {(routeStatus === "ready" || routeStatus === "fallback") && (
          <p className="route-summary" role="status">
            About {routeKm.toFixed(1)} km on foot · {routeMinutes} min. {routeStatus === "ready"
              ? "Route follows walkable streets."
              : "Routing is unavailable, so the stops are connected directly."}
          </p>
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
                <figcaption>scene reference</figcaption>
              </figure>
              <figure>
                <img src={activeLocation.now} alt="" onError={(event) => event.currentTarget.remove()} />
                <figcaption>the place today</figcaption>
              </figure>
            </div>
            <button className="wide-button" type="button" onClick={() => addRouteStop(activeLocation)}>
              <Route size={18} />
              Add to route
            </button>
          </div>
        </section>
      )}

      {accountOpen && (
        <div className="account-backdrop" role="presentation" onMouseDown={() => setAccountOpen(false)}>
          <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="account-heading">
              <div className="account-avatar"><User size={22} /></div>
              <div>
                <p className="eyebrow">Your account</p>
                <h2 id="account-title">Build your cinema library</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAccountOpen(false)} aria-label="Close account">
                <X size={18} />
              </button>
            </div>

            <p className="account-copy">Connect an export to personalise film search and map results. Files stay in this browser session.</p>
            <input ref={connectorInputRef} type="file" accept=".csv,text/csv" hidden onChange={importConnector} />

            <div className="connector-list">
              {connectorDetails.map((connector) => {
                const connection = connectedServices[connector.id];
                return (
                  <article className="connector-card" key={connector.id}>
                    <div className={`connector-logo is-${connector.id}`}>
                      {connector.id === "letterboxd" ? <Film size={20} /> : <span>IMDb</span>}
                    </div>
                    <div>
                      <strong>{connector.name}</strong>
                      <span>{connection ? `${connection.fileName} · ${connection.matchedFilms} mapped films matched` : connector.note}</span>
                    </div>
                    <button className={connection ? "connected-button" : "connector-button"} type="button" onClick={() => chooseConnectorFile(connector.id)}>
                      {connection ? <CheckCircle2 size={16} /> : <Link2 size={16} />}
                      {connection ? "Replace" : "Connect"}
                    </button>
                  </article>
                );
              })}
            </div>

            <div className="account-privacy">
              <CheckCircle2 size={17} />
              <span>No passwords are requested. CSV files are processed locally and are not uploaded.</span>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
