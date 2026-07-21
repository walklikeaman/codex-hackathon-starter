"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  CheckCircle2,
  Clapperboard,
  Cloud,
  Clock3,
  Crosshair,
  ExternalLink,
  Film,
  Link2,
  LoaderCircle,
  LocateFixed,
  LogOut,
  MapPin,
  Plus,
  Route,
  Search,
  Sparkles,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  DEMO_LOCATION,
  RADIUS_OPTIONS_METERS,
  findNearby,
  formatDistanceMeters,
  mapSearchRadiusKm,
  zoomForRadius,
} from "../lib/nearby.mjs";
import { parseLetterboxdArchive } from "../lib/letterboxd-archive.mjs";
import { loadCloudLibrary, saveCloudLibrary } from "../lib/cloud-library.mjs";
import { mergeLibraries, parseMediaCsv, workIsInLibrary } from "../lib/media-library.mjs";
import { getSupabaseBrowserClient } from "../lib/supabase-browser.mjs";
import { filmLocationImageKey } from "../lib/tmdb-images.mjs";
import {
  TOUR_BUDGETS,
  createFallbackGuide,
  createTimedTourCandidates,
  routeFitsBudget,
} from "../lib/timed-tour.mjs";
import VoiceGuide from "./VoiceGuide";

const londonCenter = [51.5094, -0.1183];
const GUEST_LIBRARY_KEY = "scenemap-library";

function readStoredLibrary(key) {
  if (typeof window === "undefined") return [];
  try {
    const storedLibrary = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(storedLibrary) ? storedLibrary : [];
  } catch {
    return [];
  }
}

const kindLabels = {
  film: "Film",
  series: "Series",
  book: "Book",
};

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
].map((work) => ({ ...work, kind: "film" }));

const fallbackLocations = [
  {
    id: "portobello-road",
    filmId: "notting-hill",
    film: "Notting Hill",
    scene: "Portobello morning walk",
    place: "Portobello Road Market",
    description: "William walks through the changing seasons of Notting Hill, turning a street market into the film's emotional timeline.",
    position: [51.5156, -0.2057],
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
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
    backdrop: null,
    now: "https://images.unsplash.com/photo-1577048982768-5cb3e7ddfa23?auto=format&fit=crop&w=1200&q=80",
  },
].map((location) => ({ ...location, kind: "film", backdropVerified: false }));

function kindLabel(kind) {
  return kindLabels[kind] ?? "Work";
}

function filmImagePlaceholderLabel(status) {
  if (status === "loading") return "Matching scene to this place…";
  if (status === "no_match") return "No verified scene match";
  if (status === "error") return "Scene matching failed";
  return "Scene matching unavailable";
}

function locationsFromApi(records) {
  return records
    .map((record) => {
      const kind = record.kind ?? "film";
      const relationLabel = record.relation_label
        ?? (kind === "book" ? "Story setting" : "Filming location");

      return {
        id: `${kind}-${record.work_wikidata_id}-${record.loc_wikidata_id}`,
        filmId: record.work_wikidata_id,
        film: record.work_title,
        scene: record.scene_title ?? relationLabel,
        place: record.loc_name,
        description: record.relation_description
          ?? `${record.loc_name} is connected with ${record.work_title}.`,
        position: [record.lat, record.lng],
        locationId: record.loc_wikidata_id,
        backdrop: record.backdrop_verified === true ? record.backdrop ?? null : null,
        backdropVerified: record.backdrop_verified === true,
        now: record.commons_image?.replace(/^http:\/\//, "https://") ?? null,
        filmTmdbId: record.film_tmdb_id,
        sceneMatchToken: record.scene_match_token ?? null,
        year: record.work_year,
        kind,
        relationKind: record.relation_kind,
        sourceUrl: record.source_url,
        sourceTitle: record.source_title,
        evidenceSource: record.evidence_source ?? "wikidata",
      };
    })
    .filter((location) => Number.isFinite(location.position[0]) && Number.isFinite(location.position[1]));
}

function worksFromLocations(sourceLocations) {
  return [...new Map(sourceLocations.map((location) => [
    location.filmId,
    {
      id: location.filmId,
      title: location.film,
      year: location.year,
      kind: location.kind ?? "film",
      code: location.film.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
    },
  ])).values()];
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

function RefreshLocationsOnDrag({ onViewportChange }) {
  const map = useMapEvents({
    dragend() {
      const center = map.getCenter();
      const distanceToCorner = map.distance(center, map.getBounds().getNorthEast());

      onViewportChange({
        center: [Number(center.lat.toFixed(5)), Number(center.lng.toFixed(5))],
        radiusKm: mapSearchRadiusKm(distanceToCorner),
      });
    },
  });

  return null;
}

function makeMarkerIcon(selected, nearest, kind) {
  return L.divIcon({
    className: "",
    html: `<span class="scene-pin kind-${kind}${selected ? " is-selected" : ""}${nearest ? " is-nearest" : ""}"><span></span></span>`,
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
  const relationQuery = location.kind === "book"
    ? "book setting real place"
    : "scene filming location";
  const query = [
    `"${location.film}"`,
    `"${location.place}"`,
    scene && scene.toLowerCase() !== location.film.toLowerCase() ? `"${scene}"` : null,
    relationQuery,
  ].filter(Boolean).join(" ");

  return `https://www.bing.com/images/search?${new URLSearchParams({ q: query })}`;
}

function RecreateShot({ location, onClose }) {
  const inputRef = useRef(null);
  const photoUrlRef = useRef("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [view, setView] = useState("overlay");
  const [opacity, setOpacity] = useState(55);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function loadPhoto(event) {
    const [file] = event.target.files;
    if (!file?.type.startsWith("image/")) return;

    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    photoUrlRef.current = nextUrl;
    setPhotoUrl(nextUrl);
    setView("overlay");
  }

  function resetPhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = "";
    setPhotoUrl("");
    setView("overlay");
    setOpacity(55);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="recreate-backdrop">
      <section
        aria-labelledby="recreate-title"
        aria-modal="true"
        className="recreate-dialog"
        role="dialog"
      >
        <header className="recreate-header">
          <div>
            <p className="eyebrow">Recreate the shot</p>
            <h2 id="recreate-title">{location.scene}</h2>
            <span>{location.film} · {location.place}</span>
          </div>
          <button
            aria-label="Close recreate shot"
            autoFocus
            className="icon-button recreate-close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="recreate-stage">
          {view === "overlay" ? (
            <div className="recreate-canvas">
              <img src={location.backdrop} alt={`Reference frame for ${location.film}`} />
              {photoUrl && (
                <img
                  className="recreate-user-photo"
                  src={photoUrl}
                  alt="Your uploaded recreation"
                  style={{ opacity: opacity / 100 }}
                />
              )}
            </div>
          ) : (
            <div className="recreate-comparison" aria-label="Then and now comparison">
              <figure>
                <img src={location.backdrop} alt={`Reference frame for ${location.film}`} />
                <figcaption>Then · reference</figcaption>
              </figure>
              <figure>
                <img src={photoUrl} alt="Your uploaded recreation" />
                <figcaption>Now · your photo</figcaption>
              </figure>
            </div>
          )}
          {!photoUrl && (
            <div className="recreate-empty">
              <strong>Match the framing</strong>
              <span>Upload a photo from this device to line it up with the reference.</span>
            </div>
          )}
        </div>

        <div className="recreate-controls">
          <input
            accept="image/*"
            className="recreate-file-input"
            id="recreate-photo"
            onChange={loadPhoto}
            ref={inputRef}
            type="file"
          />
          <label className="wide-button recreate-upload" htmlFor="recreate-photo">
            {photoUrl ? "Choose another photo" : "Upload your photo"}
          </label>

          {photoUrl && (
            <>
              <div className="recreate-view-switch" aria-label="Comparison mode">
                <button
                  aria-pressed={view === "overlay"}
                  className="ghost-button"
                  onClick={() => setView("overlay")}
                  type="button"
                >
                  Overlay
                </button>
                <button
                  aria-pressed={view === "compare"}
                  className="ghost-button"
                  onClick={() => setView("compare")}
                  type="button"
                >
                  Then / now
                </button>
              </div>

              {view === "overlay" && (
                <label className="recreate-opacity">
                  <span>Your photo opacity</span>
                  <input
                    aria-label="Your photo opacity"
                    max="100"
                    min="0"
                    onChange={(event) => setOpacity(Number(event.target.value))}
                    type="range"
                    value={opacity}
                  />
                  <output>{opacity}%</output>
                </label>
              )}

              <button className="ghost-button recreate-reset" onClick={resetPhoto} type="button">
                Reset photo
              </button>
            </>
          )}

          <p className="recreate-privacy">Your photo stays in this browser tab and is never uploaded.</p>
        </div>
      </section>
    </div>
  );
}

export default function SceneMapApp() {
  const connectorInputRef = useRef(null);
  const [liveLocations, setLiveLocations] = useState(null);
  const [mapCenter, setMapCenter] = useState(londonCenter);
  const [browseCenter, setBrowseCenter] = useState(londonCenter);
  const [browseRadius, setBrowseRadius] = useState(10);
  const [cityQuery, setCityQuery] = useState("London");
  const [cityName, setCityName] = useState("London");
  const [cityRadius, setCityRadius] = useState(15);
  const [cityWikidataId, setCityWikidataId] = useState("Q84");
  const [citySearchStatus, setCitySearchStatus] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const [workKind, setWorkKind] = useState("film");
  const [locationsStatus, setLocationsStatus] = useState("");
  const locationRequestId = useRef(0);
  const preserveViewportContext = useRef(false);
  const routeRequestId = useRef(0);
  const filmImageCache = useRef(new Map());
  const [selectedFilms, setSelectedFilms] = useState(() => fallbackFilms.map((film) => film.id));
  const [activeLocation, setActiveLocation] = useState(fallbackLocations[0]);
  const [filmImageState, setFilmImageState] = useState({
    locationId: fallbackLocations[0].id,
    url: null,
    sourceUrl: null,
    status: "unavailable",
  });
  const [filmImageRetry, setFilmImageRetry] = useState(0);
  const [routeStops, setRouteStops] = useState([]);
  const [routeStatus, setRouteStatus] = useState("idle");
  const [routeResult, setRouteResult] = useState(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [nearbyStatus, setNearbyStatus] = useState("idle");
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [userPosition, setUserPosition] = useState(null);
  const [userIsDemo, setUserIsDemo] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(RADIUS_OPTIONS_METERS[2]);
  const [tourFilmId, setTourFilmId] = useState(fallbackFilms[0].id);
  const [aiTour, setAiTour] = useState(null);
  const [aiTourStatus, setAiTourStatus] = useState("idle");
  const [aiTourError, setAiTourError] = useState("");
  const [tourBudget, setTourBudget] = useState(60);
  const [timedTour, setTimedTour] = useState(null);
  const [timedTourStatus, setTimedTourStatus] = useState("idle");
  const [timedTourMessage, setTimedTourMessage] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [accountUser, setAccountUser] = useState(null);
  const [accountStatus, setAccountStatus] = useState(supabase ? "loading" : "unavailable");
  const [cloudStatus, setCloudStatus] = useState("Saved on this device");
  const [cloudReady, setCloudReady] = useState(false);
  const [libraryStorageKey, setLibraryStorageKey] = useState(GUEST_LIBRARY_KEY);
  const [pendingConnector, setPendingConnector] = useState(null);
  const [library, setLibrary] = useState(() => readStoredLibrary(GUEST_LIBRARY_KEY));
  const [libraryQuery, setLibraryQuery] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [libraryMapOnly, setLibraryMapOnly] = useState(false);
  const [recreateLocation, setRecreateLocation] = useState(null);

  useEffect(() => {
    localStorage.setItem(libraryStorageKey, JSON.stringify(library));
  }, [library, libraryStorageKey]);

  useEffect(() => {
    if (!supabase) return undefined;

    let cancelled = false;
    let hydrationId = 0;

    async function applySession(session) {
      const requestId = hydrationId + 1;
      hydrationId = requestId;
      const user = session?.user ?? null;

      if (!user) {
        setAccountUser(null);
        setAccountStatus("signed_out");
        setCloudReady(false);
        setLibraryStorageKey(GUEST_LIBRARY_KEY);
        setLibrary(readStoredLibrary(GUEST_LIBRARY_KEY));
        setCloudStatus("Saved on this device");
        return;
      }

      const userStorageKey = `${GUEST_LIBRARY_KEY}:${user.id}`;
      setAccountUser(user);
      setAccountStatus("loading");
      setCloudReady(false);
      setCloudStatus("Loading your account…");

      const cachedAccountLibrary = readStoredLibrary(userStorageKey);
      const guestLibrary = readStoredLibrary(GUEST_LIBRARY_KEY);

      try {
        const cloudLibrary = await loadCloudLibrary(supabase, user.id);
        const mergedLibrary = mergeLibraries(
          cloudLibrary,
          mergeLibraries(cachedAccountLibrary, guestLibrary),
        );
        await saveCloudLibrary(supabase, user.id, mergedLibrary);
        if (cancelled || requestId !== hydrationId) return;

        localStorage.removeItem(GUEST_LIBRARY_KEY);
        setLibraryStorageKey(userStorageKey);
        setLibrary(mergedLibrary);
        setAccountStatus("signed_in");
        setCloudReady(true);
        setCloudStatus("Synced to your account");
      } catch {
        if (cancelled || requestId !== hydrationId) return;
        setLibraryStorageKey(userStorageKey);
        setLibrary(mergeLibraries(cachedAccountLibrary, guestLibrary));
        setAccountStatus("error");
        setCloudStatus("Cloud sync is unavailable. Your library is still saved on this device.");
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => applySession(session));
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !accountUser || !cloudReady) return undefined;

    setCloudStatus("Saving…");
    const timeout = window.setTimeout(async () => {
      try {
        await saveCloudLibrary(supabase, accountUser.id, library);
        setCloudStatus("Synced to your account");
      } catch {
        setCloudStatus("Cloud sync failed. Your device copy is safe.");
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [accountUser, cloudReady, library, supabase]);

  function applyLocationResults(nextLocations, { preserveContext = false } = {}) {
    const nextFilms = worksFromLocations(nextLocations);
    setLiveLocations(nextLocations);
    setSelectedFilms(nextFilms.map((film) => film.id));
    setActiveLocation((currentLocation) => {
      if (!preserveContext) return nextLocations[0] ?? null;
      return nextLocations.some((location) => location.id === currentLocation?.id)
        ? currentLocation
        : null;
    });

    if (preserveContext) return;

    setTourFilmId(nextFilms[0]?.id ?? "");
    setAiTour(null);
    setAiTourStatus("idle");
    setAiTourError("");
    setTimedTour(null);
    setTimedTourStatus("idle");
    setTimedTourMessage("");
    setRouteStops([]);
    setRouteResult(null);
    setRouteStatus("idle");
    setRouteMessage("");
  }

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const requestId = locationRequestId.current + 1;
    const preserveContext = preserveViewportContext.current;
    locationRequestId.current = requestId;

    async function loadLocations() {
      setLocationsStatus(`Finding mapped ${workKind} locations in this map area…`);
      try {
        const params = new URLSearchParams({
          lat: String(browseCenter[0]),
          lng: String(browseCenter[1]),
          radius: String(browseRadius),
          limit: "30",
          kind: workKind,
        });
        if (cityWikidataId) params.set("exclude", cityWikidataId);

        const response = await fetch(`/api/locations?${params}`, {
          signal: abortController.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Locations API failed");
        const nextLocations = locationsFromApi(payload.locations ?? []);
        if (cancelled || requestId !== locationRequestId.current) return;

        applyLocationResults(nextLocations, { preserveContext });
        setLocationsStatus(nextLocations.length
          ? `${nextLocations.length} verified places found nearby.`
          : `No mapped ${workKind} locations found nearby. Search for a title to check the whole city.`);
      } catch (error) {
        if (cancelled || requestId !== locationRequestId.current) return;
        if (liveLocations !== null && !preserveContext) applyLocationResults([]);
        setLocationsStatus(error instanceof Error
          ? error.message
          : "Live location search is unavailable. The London demo remains available.");
      }
    }

    loadLocations();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [browseCenter, browseRadius, cityWikidataId, workKind]);

  useEffect(() => {
    if (!activeLocation) return undefined;

    if (activeLocation.backdrop && activeLocation.backdropVerified) {
      setFilmImageState({
        locationId: activeLocation.id,
        url: activeLocation.backdrop,
        sourceUrl: null,
        status: "ready",
      });
      return undefined;
    }

    if (!activeLocation.filmTmdbId || !activeLocation.filmId || !activeLocation.locationId || !activeLocation.sceneMatchToken) {
      setFilmImageState({
        locationId: activeLocation.id,
        url: null,
        sourceUrl: null,
        status: "unavailable",
      });
      return undefined;
    }

    const locationCacheId = activeLocation.locationId ?? activeLocation.id;
    const cacheKey = filmLocationImageKey(activeLocation.filmTmdbId, locationCacheId);
    if (filmImageCache.current.has(cacheKey)) {
      const cached = filmImageCache.current.get(cacheKey);
      setFilmImageState({
        locationId: activeLocation.id,
        url: cached?.url ?? null,
        sourceUrl: cached?.sourceUrl ?? null,
        status: cached?.status ?? (cached?.url ? "ready" : "unavailable"),
      });
      return undefined;
    }

    const controller = new AbortController();
    setFilmImageState({
      locationId: activeLocation.id,
      url: null,
      sourceUrl: null,
      status: "loading",
    });

    async function loadFilmImage() {
      try {
        const query = new URLSearchParams({
          tmdbId: String(activeLocation.filmTmdbId),
          workId: String(activeLocation.filmId),
          locationId: String(locationCacheId),
          token: activeLocation.sceneMatchToken,
          v: "2",
        });
        const response = await fetch(`/api/film-image?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Film image API failed");

        const status = payload.image_url
          ? "ready"
          : ["no_candidates", "no_high_confidence_match"].includes(payload.reason)
            ? "no_match"
            : "unavailable";
        const cached = {
          url: payload.image_url ?? null,
          sourceUrl: payload.source_url ?? null,
          status,
        };
        filmImageCache.current.set(cacheKey, cached);
        setFilmImageState({
          locationId: activeLocation.id,
          ...cached,
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        setFilmImageState({
          locationId: activeLocation.id,
          url: null,
          sourceUrl: null,
          status: "error",
        });
      }
    }

    loadFilmImage();
    return () => controller.abort();
  }, [activeLocation, filmImageRetry]);

  const sourceLocations = liveLocations ?? fallbackLocations;
  const films = useMemo(
    () => liveLocations ? worksFromLocations(sourceLocations) : fallbackFilms,
    [liveLocations, sourceLocations],
  );
  const libraryFilmIds = useMemo(
    () => new Set(films.filter((film) => workIsInLibrary(film, library)).map((film) => film.id)),
    [films, library],
  );
  const mapFilms = useMemo(
    () => libraryMapOnly ? films.filter((film) => libraryFilmIds.has(film.id)) : films,
    [films, libraryFilmIds, libraryMapOnly],
  );

  useEffect(() => {
    if (!mapFilms.some((film) => film.id === tourFilmId)) {
      setTourFilmId(mapFilms[0]?.id ?? "");
    }
  }, [mapFilms, tourFilmId]);

  const visibleLocations = useMemo(
    () => sourceLocations.filter((location) =>
      selectedFilms.includes(location.filmId)
        && (!libraryMapOnly || libraryFilmIds.has(location.filmId)),
    ),
    [libraryFilmIds, libraryMapOnly, selectedFilms, sourceLocations],
  );

  useEffect(() => {
    if (!libraryMapOnly) return;
    if (!visibleLocations.some((location) => location.id === activeLocation?.id)) {
      setActiveLocation(visibleLocations[0] ?? null);
    }
  }, [activeLocation?.id, libraryMapOnly, visibleLocations]);

  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return library;
    return library.filter((movie) =>
      `${movie.title} ${movie.year ?? ""} ${(movie.sources ?? []).join(" ")}`.toLowerCase().includes(query),
    );
  }, [library, libraryQuery]);

  const routePositions = routeResult?.positions ?? [];
  const activeFilmImage = activeLocation?.backdrop && activeLocation?.backdropVerified
    ? activeLocation.backdrop
    : (filmImageState.locationId === activeLocation?.id ? filmImageState.url : null);
  const activeFilmImageStatus = activeLocation?.backdrop && activeLocation?.backdropVerified
    ? "ready"
    : filmImageState.locationId === activeLocation?.id
      ? filmImageState.status
      : activeLocation?.filmTmdbId ? "loading" : "unavailable";
  const activeFilmImageSource = filmImageState.locationId === activeLocation?.id
    ? filmImageState.sourceUrl
    : null;
  const activeNarration = aiTour?.stops?.find(
    (stop) => stop.locationId === activeLocation?.id,
  )?.narration;

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
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8_000 },
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
    setAiTour(null);
    setAiTourError("");
    setTimedTour(null);
    setTimedTourStatus("idle");
    setTimedTourMessage("");
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

  function selectConnector(connector) {
    setPendingConnector(connector);
    setImportMessage("");
    if (connectorInputRef.current) {
      connectorInputRef.current.accept = connector === "letterboxd"
        ? ".zip,.csv,application/zip,text/csv"
        : ".csv,text/csv";
      connectorInputRef.current.click();
    }
  }

  async function signInWithProvider(provider) {
    if (!supabase) {
      setCloudStatus("Supabase Auth is not configured.");
      return;
    }

    setAccountStatus("authorizing");
    setCloudStatus(`Opening ${provider === "google" ? "Google" : "Facebook"}…`);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });

    if (error) {
      setAccountStatus("signed_out");
      setCloudStatus("Sign-in could not be started. Please try again.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    setCloudStatus("Signing out…");
    const { error } = await supabase.auth.signOut();
    if (error) setCloudStatus("Sign-out failed. Please try again.");
  }

  async function importLibrary(event) {
    const file = event.target.files?.[0];
    if (!file || !pendingConnector) return;

    try {
      const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
      if (isZip && pendingConnector !== "letterboxd") {
        throw new Error("ZIP imports are supported for Letterboxd exports only.");
      }

      const imported = isZip
        ? await parseLetterboxdArchive(await file.arrayBuffer(), file.size)
        : parseMediaCsv(await file.text(), pendingConnector);
      const nextLibrary = mergeLibraries(library, imported);
      const mappedCount = films.filter((film) => workIsInLibrary(film, nextLibrary)).length;
      setLibrary(nextLibrary);
      setLibraryMapOnly(true);
      setImportMessage(`${imported.length} movies imported from ${pendingConnector === "imdb" ? "IMDb" : "Letterboxd"}${isZip ? " ZIP" : ""}. ${mappedCount} mapped ${mappedCount === 1 ? "title" : "titles"} shown in ${cityName}.`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "The file could not be imported.");
    } finally {
      event.target.value = "";
      setPendingConnector(null);
    }
  }

  function clearLibrary() {
    setLibrary([]);
    setLibraryMapOnly(false);
    setImportMessage("Your local movie list was cleared.");
  }

  async function requestWalkingRoute(stops) {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stops: stops.map((stop) => stop.position) }),
    });
    const payload = await response.json().catch(() => ({}));

    if (
      !response.ok ||
      !Array.isArray(payload?.positions) ||
      payload.positions.length < 2 ||
      !Number.isFinite(payload?.distanceKm) ||
      !Number.isFinite(payload?.durationMinutes)
    ) {
      throw new Error(payload?.error || "Walking route response is invalid");
    }

    return payload;
  }

  async function buildRoute(stops = routeStops) {
    const requestId = routeRequestId.current + 1;
    routeRequestId.current = requestId;
    setRouteResult(null);
    setRouteStatus("loading");
    setRouteMessage("");

    try {
      const payload = await requestWalkingRoute(stops);

      if (requestId !== routeRequestId.current) return;

      setRouteResult(payload);
      setRouteStatus("ready");
    } catch {
      if (requestId !== routeRequestId.current) return;

      setRouteResult(makeFallbackRoute(stops));
      setRouteStatus("fallback");
      setRouteMessage(
        "Walking directions are unavailable, so the stops are connected directly.",
      );
    }
  }

  async function buildTimedTour() {
    const candidates = createTimedTourCandidates(
      visibleLocations,
      browseCenter,
      tourBudget,
    );

    if (candidates.length === 0) {
      setTimedTour(null);
      setTimedTourStatus("error");
      setTimedTourMessage(
        "Select films with at least three nearby locations for this time budget.",
      );
      return;
    }

    setTimedTour(null);
    setTimedTourStatus("loading");
    setTimedTourMessage("Checking nearby walking routes...");

    let selectedPlan = null;
    let plannedRoute = null;
    let usedRouteFallback = false;

    try {
      const routeCandidates = [5, 4, 3].flatMap((stopCount) =>
        candidates
          .filter((candidate) => candidate.stops.length === stopCount)
          .slice(0, 4),
      );

      for (const candidate of routeCandidates) {
        const candidateRoute = await requestWalkingRoute(candidate.stops);

        if (routeFitsBudget(candidateRoute, tourBudget)) {
          selectedPlan = candidate;
          plannedRoute = candidateRoute;
          break;
        }
      }

      if (!selectedPlan) {
        setTimedTourStatus("error");
        setTimedTourMessage(
          `No three-stop walk fits ${tourBudget} minutes near this location. Try a larger budget.`,
        );
        return;
      }
    } catch {
      selectedPlan = candidates[0];
      plannedRoute = makeFallbackRoute(selectedPlan.stops);
      usedRouteFallback = true;

      if (!routeFitsBudget(plannedRoute, tourBudget)) {
        setTimedTourStatus("error");
        setTimedTourMessage(
          `No three-stop walk fits ${tourBudget} minutes near this location. Try a larger budget.`,
        );
        return;
      }
    }

    const fallbackGuide = createFallbackGuide({
      city: cityName,
      budgetMinutes: tourBudget,
      stops: selectedPlan.stops,
    });
    let guide = fallbackGuide;
    let usedAiFallback = false;

    setTimedTourMessage("Writing short stories for the selected stops...");

    try {
      const response = await fetch("/api/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: cityName,
          durationMinutes: tourBudget,
          preserveOrder: true,
          locations: selectedPlan.stops.map(
            ({ id, place, scene, description, film }) => ({
              id,
              place,
              scene,
              description,
              film,
            }),
          ),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const expectedIds = selectedPlan.stops.map((stop) => stop.id);
      const returnedIds = payload?.stops?.map((stop) => stop.locationId);

      if (
        !response.ok ||
        !Array.isArray(returnedIds) ||
        returnedIds.some((id, index) => id !== expectedIds[index])
      ) {
        throw new Error(payload.error || "The AI guide returned an invalid route.");
      }

      guide = payload;
    } catch {
      usedAiFallback = true;
    }

    setTimedTour({
      budgetMinutes: tourBudget,
      guide,
      route: plannedRoute,
      stops: selectedPlan.stops,
      usedAiFallback,
      usedRouteFallback,
    });
    setTimedTourStatus("ready");
    setTimedTourMessage(
      [
        usedAiFallback ? "AI was unavailable, so verified location descriptions were used." : null,
        usedRouteFallback ? "Walking directions were estimated because the router was unavailable." : null,
      ].filter(Boolean).join(" "),
    );
  }

  async function startTimedTour() {
    if (!timedTour) return;

    const filmIds = [...new Set(
      timedTour.stops.flatMap((stop) => stop.filmIds ?? [stop.filmId]),
    )];
    setSelectedFilms(filmIds);
    setRouteStops(timedTour.stops);
    setActiveLocation(timedTour.stops[0]);
    setAiTour({ ...timedTour.guide, timed: true });
    setAiTourStatus("success");
    setAiTourError("");
    await buildRoute(timedTour.stops);
  }

  async function buildAiTour() {
    const film = films.find((item) => item.id === tourFilmId);
    const filmLocations = sourceLocations
      .filter((location) => location.filmId === tourFilmId)
      .slice(0, 5);

    if (!film || filmLocations.length === 0) {
      setAiTourStatus("error");
      setAiTourError("No verified locations are available for this story yet.");
      return;
    }

    setAiTour(null);
    setAiTourStatus("loading");
    setAiTourError("");

    try {
      const response = await fetch("/api/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: cityName,
          film: {
            id: film.id,
            title: film.title,
            year: film.year ?? null,
            kind: film.kind ?? "film",
          },
          locations: filmLocations.map(({ id, place, scene, description }) => ({
            id,
            place,
            scene,
            description,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Could not build the AI tour.");
      }

      const locationsById = new Map(filmLocations.map((location) => [location.id, location]));
      const orderedStops = payload.stops.map((stop) => locationsById.get(stop.locationId));

      if (orderedStops.some((stop) => !stop)) {
        throw new Error("The AI returned an unknown route stop.");
      }

      setSelectedFilms([tourFilmId]);
      setRouteStops(orderedStops);
      setActiveLocation(orderedStops[0]);
      setAiTour(payload);
      setAiTourStatus("success");

      if (orderedStops.length > 1) {
        await buildRoute(orderedStops);
      } else {
        invalidateRoute();
      }
    } catch (error) {
      setAiTour(null);
      setAiTourStatus("error");
      setAiTourError(error instanceof Error ? error.message : "Could not build the AI tour.");
    }
  }

  function selectTourArea(center, name, { radiusKm = 15, wikidataId = null } = {}) {
    preserveViewportContext.current = false;
    setMapCenter(center);
    setBrowseCenter(center);
    setBrowseRadius(Math.min(radiusKm, 10));
    setCityName(name);
    setCityRadius(radiusKm);
    setCityWikidataId(wikidataId);
    setWorkQuery("");
    setLiveLocations([]);
    setActiveLocation(null);
    setRouteStops([]);
    setAiTour(null);
    setAiTourStatus("idle");
    setAiTourError("");
    setTimedTour(null);
    setTimedTourStatus("idle");
    setTimedTourMessage("");
    setLocationsStatus(`Finding mapped ${workKind} locations in ${name}…`);
    invalidateRoute();
  }

  function refreshVisibleMap({ center, radiusKm }) {
    preserveViewportContext.current = true;
    setBrowseCenter(center);
    setBrowseRadius(radiusKm);
    setWorkQuery("");
  }

  function changeWorkKind(nextKind) {
    preserveViewportContext.current = false;
    setWorkKind(nextKind);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setCitySearchStatus("Location access is unavailable in this browser");
      return;
    }

    setCitySearchStatus("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPosition([coords.latitude, coords.longitude]);
        setUserIsDemo(false);
        setNearbyStatus("ready");
        setNearbyMessage("");
        setCityQuery("");
        selectTourArea([coords.latitude, coords.longitude], "Your location");
        setCitySearchStatus("");
      },
      () => setCitySearchStatus("Location access was not granted"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }

  async function searchWork(event) {
    event.preventDefault();
    const query = workQuery.trim();
    if (!query) {
      setLocationsStatus("Enter a film, series, or book title.");
      return;
    }

    const requestId = locationRequestId.current + 1;
    locationRequestId.current = requestId;
    setLocationsStatus(`Finding every mapped place for “${query}” in ${cityName}…`);

    try {
      const params = new URLSearchParams({
        q: query,
        kind: workKind,
        lat: String(mapCenter[0]),
        lng: String(mapCenter[1]),
        radius: String(cityRadius),
        limit: "30",
      });
      if (cityWikidataId) params.set("exclude", cityWikidataId);
      const response = await fetch(`/api/locations?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Location search failed");
      if (requestId !== locationRequestId.current) return;

      const nextLocations = locationsFromApi(payload.locations ?? []);
      const matchedWork = payload.matched_work;
      const matchedTitle = matchedWork?.label ?? nextLocations[0]?.film ?? query;
      applyLocationResults(nextLocations);
      if (nextLocations.length) {
        setLocationsStatus(
          `${nextLocations.length} verified ${nextLocations.length === 1 ? "place" : "places"} for ${matchedTitle} in ${cityName}.`,
        );
      } else {
        setLocationsStatus(`No verified ${workKind} locations for “${query}” were found inside ${cityName}.`);
      }

      if (!matchedWork || nextLocations.length >= 3) return;

      setLocationsStatus(
        `${nextLocations.length || "No"} Wikidata ${nextLocations.length === 1 ? "place" : "places"}; checking cited web sources for more…`,
      );
      const discoveryResponse = await fetch("/api/locations/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: {
            name: cityName,
            lat: mapCenter[0],
            lng: mapCenter[1],
            radiusKm: cityRadius,
          },
          work: {
            id: matchedWork.id,
            title: matchedTitle,
            kind: workKind,
          },
          existingLocations: nextLocations.map((location) => ({
            place: location.place,
            lat: location.position[0],
            lng: location.position[1],
          })),
        }),
      });
      const discovery = await discoveryResponse.json().catch(() => ({}));
      if (requestId !== locationRequestId.current) return;
      if (!discoveryResponse.ok) {
        setLocationsStatus(nextLocations.length
          ? `${nextLocations.length} verified ${nextLocations.length === 1 ? "place" : "places"} for ${matchedTitle}. More research is unavailable right now.`
          : `No verified places for ${matchedTitle} in ${cityName}; more research is unavailable right now.`);
        return;
      }

      const researchedLocations = locationsFromApi(discovery.locations ?? []);
      const merged = [...nextLocations];
      for (const location of researchedLocations) {
        const duplicate = merged.some((known) =>
          known.place.toLowerCase() === location.place.toLowerCase()
          || (Math.abs(known.position[0] - location.position[0]) < 0.0005
            && Math.abs(known.position[1] - location.position[1]) < 0.0005),
        );
        if (!duplicate) merged.push(location);
      }
      applyLocationResults(merged);
      setLocationsStatus(merged.length > nextLocations.length
        ? `${merged.length} sourced places for ${matchedTitle}: Wikidata plus cited web research.`
        : `${nextLocations.length || "No"} verified places for ${matchedTitle}; no additional sourced places were found.`);
    } catch (error) {
      if (requestId !== locationRequestId.current) return;
      setLocationsStatus(error instanceof Error ? error.message : "Location search failed");
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

      setUserPosition(null);
      setUserIsDemo(false);
      setNearbyStatus("idle");
      setNearbyMessage("");
      selectTourArea([city.lat, city.lng], city.name, {
        radiusKm: city.radius_km ?? 15,
        wikidataId: city.wikidata_id ?? null,
      });
      setCitySearchStatus("");
    } catch {
      setCitySearchStatus("City not found");
    }
  }

  return (
    <main className="scene-shell">
      <section className="map-stage" aria-label="GloryMap locations map">
        <MapContainer center={mapCenter} zoom={12} minZoom={11} maxZoom={17} zoomControl={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <RecenterOnSelection center={mapCenter} position={activeLocation?.position} />
          <FitRoute positions={routePositions} />
          <FlyToUser position={userPosition} radius={nearbyRadius} />
          <RefreshLocationsOnDrag onViewportChange={refreshVisibleMap} />
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
                location.kind,
              )}
              eventHandlers={{
                click: () => setActiveLocation(location),
              }}
            >
              <Popup>
                <span className={`work-kind kind-${location.kind}`}>{kindLabel(location.kind)}</span>{" "}
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

      <aside className="command-panel" aria-label="Story selection">
        <div className="brand-row">
          <div className="brand-mark">
            <Clapperboard size={22} />
          </div>
          <div>
            <p className="eyebrow">GloryMap</p>
            <h1>Stories on the map · {cityName}</h1>
          </div>
          <button className="account-button" type="button" onClick={() => setAccountOpen(true)}>
            <User size={18} />
            My movies
          </button>
        </div>

        <div className="place-controls">
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
          <button className="use-location-button" type="button" onClick={useCurrentLocation}>
            <LocateFixed size={16} />
            Use my location
          </button>
        </div>
        {citySearchStatus && <p className="eyebrow city-search-status">{citySearchStatus}</p>}

        <form className="work-search" onSubmit={searchWork}>
          <select
            aria-label="Work type"
            value={workKind}
            onChange={(event) => changeWorkKind(event.target.value)}
          >
            <option value="film">Film</option>
            <option value="series">Series</option>
            <option value="book">Book</option>
          </select>
          <input
            aria-label="Film, series, or book title"
            onChange={(event) => setWorkQuery(event.target.value)}
            placeholder="Film, series, or book"
            type="search"
            value={workQuery}
          />
          <button aria-label="Find story locations" className="ghost-button" type="submit">
            <Search size={17} />
          </button>
        </form>
        {locationsStatus && <p className="location-search-status" role="status">{locationsStatus}</p>}

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
                  No screen or story locations loaded for this city yet.
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

        <div className="film-grid" aria-label="Selected stories">
          {mapFilms.map((film) => {
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
                  <small>
                    <span className={`work-kind kind-${film.kind}`}>{kindLabel(film.kind)}</span>
                    {film.year ? ` · ${film.year}` : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>

        <section className="timed-tour-card" aria-labelledby="timed-tour-title">
          <div className="timed-tour-heading">
            <span className="timed-tour-icon" aria-hidden="true"><Clock3 size={18} /></span>
            <div>
              <p className="eyebrow">Area · {cityName}</p>
              <strong id="timed-tour-title">Tour by time and place</strong>
            </div>
          </div>
          <div className="budget-options" role="group" aria-label="Tour time budget">
            {TOUR_BUDGETS.map((minutes) => (
              <button
                className={tourBudget === minutes ? "is-selected" : ""}
                key={minutes}
                type="button"
                aria-pressed={tourBudget === minutes}
                disabled={timedTourStatus === "loading"}
                onClick={() => {
                  setTourBudget(minutes);
                  setTimedTour(null);
                  setTimedTourStatus("idle");
                  setTimedTourMessage("");
                }}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <button
            className="timed-tour-button"
            type="button"
            onClick={buildTimedTour}
            disabled={timedTourStatus === "loading" || visibleLocations.length < 3}
          >
            {timedTourStatus === "loading" ? (
              <LoaderCircle className="loading-icon" size={17} />
            ) : (
              <Clock3 size={17} />
            )}
            {timedTourStatus === "loading" ? "Planning..." : "Generate nearby tour"}
          </button>
          {timedTourMessage && (
            <p
              className={`timed-tour-message${timedTourStatus === "error" ? " is-error" : ""}`}
              role={timedTourStatus === "error" ? "alert" : "status"}
            >
              {timedTourMessage}
            </p>
          )}
          {timedTour && (
            <div className="timed-tour-result" aria-live="polite">
              <div>
                <strong>{timedTour.guide.title}</strong>
                <p>{timedTour.guide.intro}</p>
              </div>
              <div className="timed-tour-metrics">
                <span>{timedTour.route.distanceKm.toFixed(1)} km</span>
                <span>{timedTour.route.durationMinutes} min</span>
                <span>{timedTour.stops.length} stops</span>
              </div>
              <ol>
                {timedTour.stops.map((stop) => (
                  <li key={stop.id}>
                    <strong>{stop.place}</strong>
                    <span>{stop.film}</span>
                  </li>
                ))}
              </ol>
              <button className="start-tour-button" type="button" onClick={startTimedTour}>
                <Route size={17} />
                Start tour
              </button>
            </div>
          )}
        </section>

        <div className="ai-tour-card">
          <div className="ai-tour-heading">
            <span className="ai-tour-icon" aria-hidden="true">
              <Sparkles size={17} />
            </span>
            <div>
              <p className="eyebrow">AI guide</p>
              <strong>Tour by work</strong>
            </div>
          </div>
          <div className="ai-tour-controls">
            <label>
              <span className="sr-only">Work for the AI tour</span>
              <select
                value={tourFilmId}
                onChange={(event) => {
                  setTourFilmId(event.target.value);
                  setAiTour(null);
                  setAiTourError("");
                }}
                disabled={aiTourStatus === "loading" || mapFilms.length === 0}
              >
                {mapFilms.map((film) => (
                  <option key={film.id} value={film.id}>{film.title}</option>
                ))}
              </select>
            </label>
            <button
              className="ai-tour-button"
              type="button"
              onClick={buildAiTour}
              disabled={aiTourStatus === "loading" || !tourFilmId}
            >
              {aiTourStatus === "loading" ? (
                <LoaderCircle className="loading-icon" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              {aiTourStatus === "loading" ? "Building..." : "Create tour"}
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

        <div className="location-list" aria-label="Map locations">
          <div className="section-row">
            <p className="eyebrow">Locations</p>
            <span>{visibleLocations.length} in {cityName}</span>
          </div>
          {visibleLocations.map((location) => (
            <div className="location-row" key={location.id}>
              <button type="button" onClick={() => setActiveLocation(location)}>
                <strong>{location.place}</strong>
                <span>
                  <span className={`work-kind kind-${location.kind}`}>{kindLabel(location.kind)}</span>{" "}
                  {location.film}
                </span>
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
            className={`primary-button${routeResult ? " is-complete" : ""}`}
            disabled={routeStops.length < 3 || routeStatus !== "idle"}
            onClick={() => buildRoute()}
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

        {aiTour && (
          <section className="ai-tour-result" aria-live="polite">
            <p className="eyebrow">Stories at each stop</p>
            <ol>
              {aiTour.stops.map((stop) => {
                const location = sourceLocations.find((item) => item.id === stop.locationId);

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
                <button className="icon-button" type="button" onClick={() => removeRouteStop(stop.id)} aria-label="Remove stop">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {routeStatus === "loading" && (
          <p className="route-summary" role="status">
            Building a walking route through {cityName}...
          </p>
        )}

        {routeResult && (
          <div
            className={`route-summary${routeResult.source === "fallback" ? " is-fallback" : ""}`}
            role="status"
          >
            <strong>
              {routeResult.distanceKm.toFixed(1)} km on foot · {routeResult.durationMinutes} min
            </strong>
            {routeResult.source === "fallback" ? (
              <span>{routeMessage}</span>
            ) : (
              <span>
                {aiTour?.timed
                  ? "Nearby planner chose the stops · "
                  : aiTour
                    ? "AI chose the stop order · "
                    : ""}
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
            {(activeFilmImage ?? activeLocation.now) && (
              <img
                src={activeFilmImage ?? activeLocation.now}
                alt=""
                onError={(event) => event.currentTarget.remove()}
              />
            )}
            <div>
              <p><span className={`work-kind kind-${activeLocation.kind}`}>{kindLabel(activeLocation.kind)}</span>{" "}{activeLocation.film}</p>
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
            <VoiceGuide location={activeLocation} story={activeNarration} />
            <div className="comparison-grid">
              <figure>
                {activeFilmImage ? (
                  <img
                    src={activeFilmImage}
                    alt={`Matched film scene for ${activeLocation.film} at ${activeLocation.place}`}
                    onError={() => {
                      filmImageCache.current.delete(filmLocationImageKey(
                        activeLocation.filmTmdbId,
                        activeLocation.locationId ?? activeLocation.id,
                      ));
                      setFilmImageState({
                        locationId: activeLocation.id,
                        url: null,
                        sourceUrl: null,
                        status: "error",
                      });
                    }}
                  />
                ) : (
                  <div className="image-placeholder" role="status">
                    <span>{filmImagePlaceholderLabel(activeFilmImageStatus)}</span>
                    {activeFilmImageStatus === "error" && (
                      <button
                        className="image-placeholder-retry"
                        onClick={() => {
                          filmImageCache.current.delete(filmLocationImageKey(
                            activeLocation.filmTmdbId,
                            activeLocation.locationId ?? activeLocation.id,
                          ));
                          setFilmImageRetry((value) => value + 1);
                        }}
                        type="button"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
                <figcaption>
                  {activeFilmImage && activeFilmImageSource ? (
                    <a href={activeFilmImageSource} target="_blank" rel="noopener noreferrer">
                      AI-matched scene · TMDB
                    </a>
                  ) : "scene reference"}
                </figcaption>
              </figure>
              <figure>
                {activeLocation.now ? (
                  <img src={activeLocation.now} alt={`${activeLocation.place} today`} />
                ) : (
                  <div className="image-placeholder">Place photo unavailable</div>
                )}
                <figcaption>the place today</figcaption>
              </figure>
            </div>
            <button
              aria-haspopup="dialog"
              className="wide-button recreate-launch"
              disabled={!activeFilmImage}
              onClick={() => setRecreateLocation({ ...activeLocation, backdrop: activeFilmImage })}
              title={activeFilmImage ? undefined : "A reference image is required to recreate this shot"}
              type="button"
            >
              <Clapperboard size={18} />
              Recreate this shot
            </button>
            {activeLocation.sourceUrl && (
              <a className="source-link" href={activeLocation.sourceUrl} target="_blank" rel="noopener noreferrer">
                {activeLocation.sourceTitle ?? (activeLocation.evidenceSource === "web_search" ? "Research source" : "Wikidata source")}
                <ExternalLink size={14} />
              </a>
            )}
            <a className="ghost-button image-search-link" href={makeImageSearchUrl(activeLocation)} target="_blank" rel="noopener noreferrer">
              <Search size={18} />
              Find place images
              <ExternalLink size={15} />
            </a>
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
                <p className="eyebrow">Personal account</p>
                <h2 id="account-title">My library</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setAccountOpen(false)} aria-label="Close movie library">
                <X size={18} />
              </button>
            </div>

            <p className="account-copy">
              Import your official account export. Sign in to keep the normalized movie list in your private account and access it on another device.
            </p>

            <div className="account-auth">
              {accountUser ? (
                <div className="account-session">
                  <span className="account-user-mark">{(accountUser.user_metadata?.name || accountUser.email || "U").slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{accountUser.user_metadata?.name || "Signed in"}</strong>
                    <small>{accountUser.email}</small>
                  </span>
                  <button type="button" onClick={signOut}><LogOut size={16} />Sign out</button>
                </div>
              ) : (
                <div className="oauth-buttons">
                  <button type="button" onClick={() => signInWithProvider("google")} disabled={accountStatus === "authorizing" || accountStatus === "loading"}>
                    <span className="oauth-logo is-google">G</span>
                    Login with Google
                  </button>
                  <button type="button" onClick={() => signInWithProvider("facebook")} disabled={accountStatus === "authorizing" || accountStatus === "loading"}>
                    <span className="oauth-logo is-facebook">f</span>
                    Login with Facebook
                  </button>
                </div>
              )}
              <p className={accountUser && cloudReady ? "cloud-status is-synced" : "cloud-status"} role="status">
                {accountStatus === "loading" || accountStatus === "authorizing" ? <LoaderCircle className="spin" size={15} /> : <Cloud size={15} />}
                {cloudStatus}
              </p>
            </div>

            <input
              ref={connectorInputRef}
              type="file"
              accept={pendingConnector === "letterboxd" ? ".zip,.csv,application/zip,text/csv" : ".csv,text/csv"}
              hidden
              onChange={importLibrary}
            />

            <div className="connector-list">
              <button className="connector-card" type="button" onClick={() => selectConnector("letterboxd")}>
                <span className="connector-logo is-letterboxd"><Film size={20} /></span>
                <span><strong>Letterboxd</strong><small>Upload the complete ZIP export or a CSV</small></span>
                <Link2 size={18} />
              </button>
              <button className="connector-card" type="button" onClick={() => selectConnector("imdb")}>
                <span className="connector-logo is-imdb">IMDb</span>
                <span><strong>IMDb</strong><small>Ratings, Check-ins or list CSV</small></span>
                <Link2 size={18} />
              </button>
            </div>

            {importMessage && <p className="import-message" role="status"><CheckCircle2 size={16} />{importMessage}</p>}

            <div className="library-toolbar">
              <div className="film-search">
                <Search size={16} />
                <input aria-label="Search my movies" placeholder="Search my movies" type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
              </div>
              {library.length > 0 && (
                <button className="clear-library" type="button" onClick={clearLibrary}><Trash2 size={15} />Clear</button>
              )}
            </div>

            <div className="library-summary">
              <span>{library.length} movies</span>
              <span>{library.filter((movie) => movie.rating !== null).length} rated</span>
              <button
                type="button"
                className={libraryMapOnly ? "is-selected" : ""}
                onClick={() => setLibraryMapOnly((current) => !current)}
                disabled={library.length === 0}
                aria-pressed={libraryMapOnly}
              >
                {libraryMapOnly ? `${libraryFilmIds.size} mapped on map` : "Show library on map"}
              </button>
            </div>

            <div className="movie-library" aria-live="polite">
              {filteredLibrary.map((movie) => (
                <article className="library-movie" key={movie.id}>
                  <span className="library-poster">{movie.title.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{movie.title}</strong>
                    <span>{movie.year ?? "Year unknown"} · {(movie.sources ?? []).map((source) => source === "imdb" ? "IMDb" : "Letterboxd").join(" + ")}</span>
                  </div>
                  {movie.rating !== null && <span className="movie-rating"><Star size={14} />{movie.rating}</span>}
                </article>
              ))}
              {library.length === 0 && (
                <div className="empty-library"><Film size={28} /><strong>Your movie list is empty</strong><span>Connect Letterboxd or IMDb to import it.</span></div>
              )}
              {library.length > 0 && filteredLibrary.length === 0 && <p className="empty-library">No movies match your search.</p>}
            </div>

            <div className="account-privacy"><CheckCircle2 size={17} /><span>The ZIP or CSV is processed locally and is never uploaded. When you sign in, only the normalized movie list is stored under your account.</span></div>
          </section>
        </div>
      )}

      {recreateLocation && (
        <RecreateShot location={recreateLocation} onClose={() => setRecreateLocation(null)} />
      )}
    </main>
  );
}
