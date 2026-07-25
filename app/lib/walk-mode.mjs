// Walk mode — keeping a tour alive while someone is actually walking it.
//
// The problem it solves is physical, not cosmetic: with the screen off, browsers
// throttle `watchPosition` badly, so the geo-triggers that start a narration stop
// firing and the guide goes silent exactly when it is needed. A Wake Lock keeps the
// page foregrounded so the position keeps updating.
//
// Everything here is pure. The Wake Lock itself is a browser API, but WHEN to hold it,
// WHEN to release it and what the walker is told are decisions worth testing without
// a browser.

import { haversineKm, isLatLng } from "./geo.mjs";
import { finiteOrNull } from "./numbers.mjs";

// Real walking, not map-measuring: a tourist stopping to look is slower than the
// 4.6 km/h the route planner assumes, and an ETA that runs ahead of the walker is
// worse than no ETA.
export const WALKING_SPEED_KMH = 4.2;

// Inside this radius we call it "arrived" rather than counting down metres that GPS
// noise makes meaningless.
export const ARRIVAL_RADIUS_M = 35;

export function metresBetween(from, to) {
  if (!isLatLng(from) || !isLatLng(to)) return null;
  return Math.round(haversineKm(from, to) * 1000);
}

// Minutes of walking for a distance. Rounded to NEAREST with a floor of one, not up:
// ceil turns an 80 m stroll into "2 min", which is double, and an ETA that is
// obviously wrong stops being read. The floor keeps it from claiming "0 min" while
// there is still a block to walk.
export function walkingMinutes(metres) {
  const distance = finiteOrNull(metres);
  if (distance === null || distance <= 0) return 0;
  return Math.max(1, Math.round((distance / 1000 / WALKING_SPEED_KMH) * 60));
}

export function formatDistance(metres) {
  const distance = finiteOrNull(metres);
  if (distance === null) return null;
  if (distance < 1000) return `${Math.round(distance / 10) * 10} m`;
  return `${(distance / 1000).toFixed(distance < 10000 ? 1 : 0)} km`;
}

// The next stop the walker has not reached yet, with distance and ETA. Stops are
// followed IN ORDER — a walking tour is a sequence, and jumping to whichever stop is
// nearest would send people back and forth.
export function nextStop(stops, position, { visitedIds = [] } = {}) {
  const list = Array.isArray(stops) ? stops : [];
  const visited = new Set(visitedIds);

  for (const stop of list) {
    if (visited.has(stop?.id)) continue;
    const metres = metresBetween(position, stop?.position);
    return {
      stop,
      distance_m: metres,
      distance_label: formatDistance(metres),
      eta_minutes: metres === null ? null : walkingMinutes(metres),
      arrived: metres !== null && metres <= ARRIVAL_RADIUS_M,
    };
  }
  return null;
}

// What the banner says. Deliberately short: someone reading this is walking, and a
// paragraph is a hazard.
export function walkBanner(next) {
  if (!next) return { title: "Tour complete", detail: "Every stop visited." };
  const name = next.stop?.place ?? next.stop?.name ?? "the next stop";
  if (next.arrived) return { title: `You're at ${name}`, detail: "Listening starts on its own." };
  if (next.distance_m === null) {
    return { title: `Next: ${name}`, detail: "Waiting for your position…" };
  }
  return {
    title: `Next: ${name}`,
    detail: `${next.distance_label} · about ${next.eta_minutes} min`,
  };
}

// Shown once when walk mode starts. The guide plays hands-free, so the only thing
// asked of the walker is to look up.
export const ROAD_SAFETY_REMINDER =
  "Keep your eyes on the road — the guide plays on its own, no tapping needed.";

// Should the lock be held right now? Only while walking AND the page is visible:
// holding it in a background tab is refused by the browser anyway, and asking for it
// wastes battery.
export function shouldHoldLock({ walking, visible }) {
  return Boolean(walking) && Boolean(visible);
}

// Wake Lock is released by the browser whenever the page is hidden, so returning to
// the tab must RE-acquire it. Without this, walk mode silently stops working after
// the first glance at another app — the exact failure the feature exists to prevent.
export function lockAction(previous, next) {
  const want = shouldHoldLock(next);
  const had = shouldHoldLock(previous ?? { walking: false, visible: false });
  if (want && !had) return "acquire";
  if (!want && had) return "release";
  return "none";
}

// Is the API available at all? Safari on iOS only shipped it in 16.4, so the UI must
// be able to say "your browser will dim the screen" rather than silently failing.
export function wakeLockSupported(navigatorLike) {
  return Boolean(navigatorLike?.wakeLock?.request);
}
