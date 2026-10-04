// What a reader marks on a place: "want to visit", and "I'm here" (#23), and what the
// visits add up to — Glory points, progress through a film's places, the first
// achievement (#19).
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
import { isDuplicatePlace } from "./place-dedup.mjs";
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

// A place reaches the map from several sources under several ids: Somerset House is
// Q1344889 on one film's row and a graph uuid on another's. So a mark is found by its key
// first and then by the rule that decides whether a researched place is already on the
// map — same entity, same name, or within 50 m (place-dedup.mjs). Without the second
// step a place visited for one film was unvisited for the next (measured 2026-10-04).
function asPlace(value) {
  const position = positionOf(value?.position);
  return { name: value?.place ?? null, lat: position?.[0], lng: position?.[1], wikidataId: null };
}

function keyOfMark(map, location) {
  const key = placeKey(location);
  if (!key) return null;
  if (map?.[key]) return key;
  const here = asPlace(location);
  return Object.keys(map ?? {}).find((other) => isDuplicatePlace(asPlace(map[other]), here)) ?? null;
}

export function isWanted(marks, location) {
  return Boolean(keyOfMark(marks?.want, location));
}

export function visitOf(marks, location) {
  const key = keyOfMark(marks?.visited, location);
  return key ? marks.visited[key] : null;
}

export function toggleWant(marks, location, now = Date.now()) {
  const key = placeKey(location);
  if (!key) return marks;
  const want = { ...marks.want };
  const existing = keyOfMark(want, location);
  if (existing) delete want[existing];
  else want[key] = markOf(location, now);
  return { ...marks, want };
}

function withoutWant(marks, location) {
  const want = { ...marks.want };
  const existing = keyOfMark(want, location);
  if (existing) delete want[existing];
  return want;
}

// fix: { coords: [lat, lng], accuracy } as the walk's watcher builds it.
export function checkIn(marks, location, fix, { isDemo = false, now = Date.now() } = {}) {
  const key = placeKey(location);
  const target = positionOf(location?.position);
  if (!key || !target) return { marks, result: { status: "no_place" } };
  // A second visit is a visit, not a second reward: nothing is rewritten, so the first
  // date and the points it earned stay what they were.
  if (visitOf(marks, location)) return { marks, result: { status: "already_visited" } };
  if (isDemo) return { marks, result: { status: "demo_position" } };
  if (!positionOf(fix?.coords)) return { marks, result: { status: "no_position" } };
  if (!isUsableFix(fix)) return { marks, result: { status: "too_vague", accuracy: Math.round(fix.accuracy) } };

  const metres = metresBetween(fix.coords, target);
  if (metres > CHECK_IN_RADIUS_M) return { marks, result: { status: "too_far", metres } };

  // Being here is also no longer wanting to be here.
  return {
    marks: { want: withoutWant(marks, location), visited: { ...marks.visited, [key]: { ...markOf(location, now), metres } } },
    result: { status: "checked_in", metres },
  };
}

// The stage demo (#19): with the demo location switched on, a place can be checked into
// without standing at it — and the visit says so for ever after. It is the only way a
// visit is recorded without a position, and it is never mistaken for a real one.
export function demoCheckIn(marks, location, { now = Date.now() } = {}) {
  const key = placeKey(location);
  if (!key) return { marks, result: { status: "no_place" } };
  if (visitOf(marks, location)) return { marks, result: { status: "already_visited" } };
  return {
    marks: { want: withoutWant(marks, location), visited: { ...marks.visited, [key]: { ...markOf(location, now), demo: true } } },
    result: { status: "checked_in", demo: true },
  };
}

// What the visits add up to. Derived, never stored: points kept in a counter could drift
// from the visits they were paid for, and a visit is keyed by its place, so the same
// place can never pay twice.
export const GLORY_PER_VISIT = 50;

export function gloryOf(marks) {
  return Object.keys(marks?.visited ?? {}).length * GLORY_PER_VISIT;
}

export const ACHIEVEMENTS = Object.freeze([
  { id: "first-place", title: "First place", earnedBy: (visits) => visits.length >= 1 },
]);

export function achievementsOf(marks) {
  const visits = Object.values(marks?.visited ?? {}).sort((left, right) => left.at - right.at);
  return ACHIEVEMENTS.filter((achievement) => achievement.earnedBy(visits))
    .map(({ id, title }) => ({ id, title, at: visits[0].at }));
}

// "Visited X of Y" over a set of places — the film's, on the card — counted by place,
// so two rows of one place are one place.
export function progressOf(marks, locations) {
  const places = [];
  for (const location of Array.isArray(locations) ? locations : []) {
    if (!placeKey(location)) continue;
    if (places.some((other) => placeKey(other) === placeKey(location) || isDuplicatePlace(asPlace(other), asPlace(location)))) continue;
    places.push(location);
  }
  const visited = places.filter((location) => visitOf(marks, location)).length;
  return { visited, total: places.length, percent: places.length ? Math.round((100 * visited) / places.length) : 0 };
}

// What the card says after the reader taps "I'm here".
export function checkInMessage(result) {
  switch (result?.status) {
    case "checked_in": return result.demo
      ? `Demo check-in recorded · +${GLORY_PER_VISIT} Glory.`
      : `Checked in — you were here · +${GLORY_PER_VISIT} Glory.`;
    case "already_visited": return "Already visited — a place counts once.";
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

// A level every three places (#22). Like the points, it is read off the visits.
export const GLORY_PER_LEVEL = GLORY_PER_VISIT * 3;

export function levelOf(glory) {
  const points = Math.max(0, Number(glory) || 0);
  const level = 1 + Math.floor(points / GLORY_PER_LEVEL);
  return { level, toNext: level * GLORY_PER_LEVEL - points };
}

// The collection screen (#22): what the reader wants to see and what they have seen,
// newest first, and the works those visits were for.
export function collectionOf(marks) {
  const list = (map) => Object.entries(map ?? {})
    .map(([key, mark]) => ({ key, ...mark }))
    .sort((left, right) => right.at - left.at);
  const visited = list(marks?.visited);
  return {
    want: list(marks?.want),
    visited,
    works: [...new Set(visited.map((visit) => visit.film).filter(Boolean))],
  };
}
