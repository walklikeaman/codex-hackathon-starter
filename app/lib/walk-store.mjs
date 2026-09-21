// The walk you are on, frozen where the network cannot take it away (#161).
//
// The service worker keeps what the phone has already fetched. It does not keep what the
// READER was doing: close the app in a dead zone, or let the tab be evicted while the phone
// is in a pocket, and the route came back as an empty map with a search box.
//
// So the route and the stops it names are written down at the moment the route is built —
// the one moment we know the reader committed to something — and offered back when the app
// opens without a network.
//
// ---------------------------------------------------------------------------------------
//
// **Only on an offline open.** A walk restored over a fresh online session would be the
// product deciding where somebody is; `?city=los-angeles` means Los Angeles even if the
// last walk was in Lisbon. Offline there is no other answer available, and the frozen walk
// is strictly better than an empty map.
//
// **It expires.** A route is a plan for an afternoon. Twelve hours later the reader is
// somewhere else and the stops on screen would be a claim about their day that nothing
// supports.
//
// **It holds no library and no token.** Stops carry a place, a film title and a coordinate
// — what is already on the map in front of anybody looking at the phone.

export const WALK_KEY = "scenemap-walk";
export const WALK_VERSION = 1;

// Twelve hours: long enough for a walk planned in the morning and taken after lunch, short
// enough that yesterday's route never reappears as today's.
export const WALK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// A route the product itself refuses to build past five stops (`timed-tour.mjs`), so this
// is a bound on nonsense arriving from a hand-edited localStorage, not on the reader.
const MAX_STOPS = 12;

function positionOf(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lat, lng] = value.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

// Only the fields the map needs to draw the walk again. Anything else a stop happens to
// carry — the voice guide's text, the images, a work id — is left behind: it can be fetched
// when there is a network, and it is not what stops a walk from surviving.
function frozenStop(stop) {
  const position = positionOf(stop?.position);
  if (!position) return null;
  return {
    id: stop.id ?? null,
    film: stop.film ?? null,
    kind: stop.kind ?? null,
    scene: stop.scene ?? null,
    place: stop.place ?? null,
    position,
    isCandidate: stop.isCandidate === true,
    display: stop.display ?? "point",
  };
}

export function freezeWalk({ stops, route, cityName, now = Date.now() } = {}) {
  const frozen = (Array.isArray(stops) ? stops : [])
    .map(frozenStop)
    .filter(Boolean)
    .slice(0, MAX_STOPS);
  // Two stops is the floor for a line on the map. One stop is a place, and the place card
  // already survives on its own.
  if (frozen.length < 2) return null;

  const positions = (route?.positions ?? [])
    .map(positionOf)
    .filter(Boolean);

  return {
    version: WALK_VERSION,
    savedAt: now,
    cityName: cityName ?? null,
    stops: frozen,
    route: route
      ? {
          positions,
          distanceKm: Number.isFinite(route.distanceKm) ? route.distanceKm : null,
          durationMinutes: Number.isFinite(route.durationMinutes) ? route.durationMinutes : null,
          // Kept, because the card says "route follows mapped streets" or "connected
          // directly" and the restored walk must not upgrade its own claim.
          source: route.source ?? null,
        }
      : null,
  };
}

export function saveWalk(storage, walk) {
  if (!storage || !walk) return false;
  try {
    storage.setItem(WALK_KEY, JSON.stringify(walk));
    return true;
  } catch {
    // A full or refused localStorage is not a reason to interrupt a walk being planned.
    return false;
  }
}

export function clearWalk(storage) {
  try { storage?.removeItem(WALK_KEY); } catch { /* nothing to undo */ }
}

// What was frozen, if it is still this walk. Anything unreadable, older than the window, or
// from a version that meant something else, is dropped rather than half-read.
export function loadWalk(storage, { now = Date.now(), maxAgeMs = WALK_MAX_AGE_MS } = {}) {
  let parsed = null;
  try {
    const raw = storage?.getItem(WALK_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed?.version !== WALK_VERSION) return null;
  if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > maxAgeMs) return null;

  const stops = (Array.isArray(parsed.stops) ? parsed.stops : [])
    .map(frozenStop)
    .filter(Boolean);
  if (stops.length < 2) return null;

  return { ...parsed, stops };
}

// How old the restored walk is, in the words the badge uses. Minutes under an hour, because
// "0 hours ago" is not how anybody says it.
export function walkAgeLabel(walk, { now = Date.now() } = {}) {
  const savedAt = Number(walk?.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const minutes = Math.max(0, Math.round((now - savedAt) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}
