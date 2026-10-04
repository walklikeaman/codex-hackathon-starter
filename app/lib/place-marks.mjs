// What a reader marks on a place: "want to visit", and "I'm here" (#23).
//
// Both live in this browser and nowhere else, like the walk (walk-store.mjs): they are a
// person's own plans and footsteps, and there is no account they would have agreed to
// share them with.
//
// "I'm here" is a claim about a footstep, so it is checked, not taken on trust. A position
// from the GPS must be within CHECK_IN_RADIUS_M of the place and precise enough to say so
// (the accuracy gate the walk's arrival trigger uses). The demo location is somebody else's
// position and never checks anyone in. A check-in that fails says how far off it was, so
// the reader knows whether to walk on or to wait for a better fix.

import { isUsableFix } from "./geo-trigger.mjs";
import { formatDistance, metresBetween } from "./walk-mode.mjs";

export const MARKS_KEY = "scenemap-place-marks";

// GPS in a city street is good to a few tens of metres, and a place is a building, a
// square, a bridge — somebody on its far side is still there.
export const CHECK_IN_RADIUS_M = 150;

// A hand-edited or very old localStorage is not allowed to grow the page without bound.
const MAX_MARKS = 500;

export function placeKey(location) {
  return String(location?.locationId ?? location?.id ?? "") || null;
}

function positionOf(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lat, lng] = value.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

// Only what is needed to list the place again without the network.
function markOf(location, at) {
  return { place: location?.place ?? null, film: location?.film ?? null, position: positionOf(location?.position), at };
}

function cleanMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, mark]) => key && mark && Number.isFinite(mark.at))
    .slice(-MAX_MARKS));
}

export function emptyMarks() {
  return { want: {}, visited: {} };
}

export function loadMarks(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MARKS_KEY) ?? "null");
    return { want: cleanMap(parsed?.want), visited: cleanMap(parsed?.visited) };
  } catch {
    return emptyMarks();
  }
}

export function saveMarks(storage, marks) {
  try {
    storage?.setItem(MARKS_KEY, JSON.stringify(marks));
  } catch {
    // Storage full or refused (private mode): the mark lasts for this visit only.
  }
}

export function isWanted(marks, location) {
  const key = placeKey(location);
  return Boolean(key && marks?.want?.[key]);
}

export function visitOf(marks, location) {
  const key = placeKey(location);
  return (key && marks?.visited?.[key]) || null;
}

export function toggleWant(marks, location, now = Date.now()) {
  const key = placeKey(location);
  if (!key) return marks;
  const want = { ...marks.want };
  if (want[key]) delete want[key];
  else want[key] = markOf(location, now);
  return { ...marks, want };
}

// fix: { coords: [lat, lng], accuracy } as the walk's watcher builds it.
export function checkIn(marks, location, fix, { isDemo = false, now = Date.now() } = {}) {
  const key = placeKey(location);
  const target = positionOf(location?.position);
  if (!key || !target) return { marks, result: { status: "no_place" } };
  if (isDemo) return { marks, result: { status: "demo_position" } };
  if (!positionOf(fix?.coords)) return { marks, result: { status: "no_position" } };
  if (!isUsableFix(fix)) return { marks, result: { status: "too_vague", accuracy: Math.round(fix.accuracy) } };

  const metres = metresBetween(fix.coords, target);
  if (metres > CHECK_IN_RADIUS_M) return { marks, result: { status: "too_far", metres } };

  // Being here is also no longer wanting to be here.
  const want = { ...marks.want };
  delete want[key];
  return {
    marks: { want, visited: { ...marks.visited, [key]: { ...markOf(location, now), metres } } },
    result: { status: "checked_in", metres },
  };
}

// What the card says after the reader taps "I'm here".
export function checkInMessage(result) {
  switch (result?.status) {
    case "checked_in": return "Checked in — you were here.";
    case "too_far": return `Not yet: your phone puts you ${formatDistance(result.metres)} away.`;
    case "too_vague": return `Your position is only good to ${result.accuracy} m — try again in the open.`;
    case "demo_position": return "The demo location is not where you are. Use your own location to check in.";
    case "no_position": return "Your position is not available, so nothing was recorded.";
    default: return null;
  }
}

// "1.2 km from you" — or from the demo location, said as such.
export function distanceFromYou(position, location, { isDemo = false } = {}) {
  const metres = metresBetween(positionOf(position), positionOf(location?.position));
  if (metres === null) return null;
  return `${formatDistance(metres)} from ${isDemo ? "the demo location" : "you"}`;
}
