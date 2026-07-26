// Geo-triggered narration — the guide starts talking when you arrive.
//
// This is the genre's core move (Autio, VoiceMap): walk up to a place and it speaks,
// hands free. Three things make it work in a browser, and each is a decision rather
// than a detail:
//
// 1. **Autoplay is blocked until the user gestures.** A browser will not play audio a
//    page starts on its own, so the first tap has to unlock playback — otherwise the
//    walker reaches the first stop and hears silence, with nothing to tap because the
//    whole point is that no tapping is needed.
// 2. **Each stop speaks once.** Position updates arrive constantly and GPS jitters
//    across a radius boundary; without de-duplication the narration would restart
//    every few seconds while standing still.
// 3. **A trigger is a claim about where you are.** GPS accuracy varies wildly, so a
//    reading too vague to place the walker must not fire anything.

import { haversineKm, isLatLng } from "./geo.mjs";
import { finiteOrNull } from "./numbers.mjs";

// Close enough to be "here". Chosen to be forgiving of ordinary GPS error without
// firing from across the street.
export const DEFAULT_TRIGGER_RADIUS_M = 45;
export const MAX_TRIGGER_RADIUS_M = 250;

// A fix vaguer than this cannot honestly place someone within the radius, so it is
// ignored rather than guessed with.
export const MAX_ACCEPTABLE_ACCURACY_M = 120;

export function clampTriggerRadius(value) {
  const radius = finiteOrNull(value);
  if (radius === null || radius <= 0) return DEFAULT_TRIGGER_RADIUS_M;
  return Math.min(Math.round(radius), MAX_TRIGGER_RADIUS_M);
}

// Is this position good enough to act on? An absent accuracy is treated as usable —
// some browsers omit it — but a stated, poor accuracy is not.
export function isUsableFix(position) {
  if (!isLatLng(position?.coords ?? position)) return false;
  const accuracy = finiteOrNull(position?.accuracy ?? position?.coords?.accuracy);
  return accuracy === null || accuracy <= MAX_ACCEPTABLE_ACCURACY_M;
}

function coordsOf(position) {
  if (isLatLng(position)) return position;
  const coords = position?.coords;
  return isLatLng(coords) ? coords : null;
}

export function metresTo(position, target) {
  const from = coordsOf(position);
  if (!from || !isLatLng(target)) return null;
  return Math.round(haversineKm(from, target) * 1000);
}

// Which stop should speak now.
//
// Returns at most ONE stop: two narrations talking over each other is worse than a
// slightly late second one, and the walker cannot follow both. When several are in
// range the nearest wins.
export function triggeredStop(stops, position, {
  radiusM = DEFAULT_TRIGGER_RADIUS_M,
  playedIds = [],
} = {}) {
  if (!isUsableFix(position)) return null;

  const radius = clampTriggerRadius(radiusM);
  const played = new Set(playedIds);
  let best = null;

  for (const stop of Array.isArray(stops) ? stops : []) {
    if (!stop?.id || played.has(stop.id)) continue;      // spoken already
    const metres = metresTo(position, stop.position);
    if (metres === null || metres > radius) continue;
    if (!best || metres < best.distance_m) best = { stop, distance_m: metres };
  }
  return best;
}

// Advance the trigger state for one position update. Pure, so the whole lifecycle is
// testable without a browser or a moving human.
export function advanceTriggers(state, position, options = {}) {
  const previous = {
    playedIds: Array.isArray(state?.playedIds) ? state.playedIds : [],
    lastPosition: state?.lastPosition ?? null,
  };

  const hit = triggeredStop(options.stops, position, {
    radiusM: options.radiusM,
    playedIds: previous.playedIds,
  });

  const coords = coordsOf(position);
  const next = {
    playedIds: hit ? [...previous.playedIds, hit.stop.id] : previous.playedIds,
    lastPosition: coords ?? previous.lastPosition,
  };
  return { state: next, speak: hit?.stop ?? null, distance_m: hit?.distance_m ?? null };
}

// How far someone must move before another position update is worth processing.
// Standing still produces a stream of jittering fixes; acting on each one drains the
// battery for no new information.
export const MOVEMENT_THRESHOLD_M = 12;

export function hasMovedEnough(previous, current) {
  const from = coordsOf(previous);
  const to = coordsOf(current);
  if (!from) return true;   // the first fix is always worth processing
  if (!to) return false;
  return (metresTo(from, to) ?? 0) >= MOVEMENT_THRESHOLD_M;
}

// Playback cannot begin until the user has gestured at the page at least once. The UI
// asks for that tap up front, so the guide is silent by policy, never by surprise.
export function playbackState({ unlocked, walking }) {
  if (!walking) return "idle";
  return unlocked ? "armed" : "needs-unlock";
}

export const UNLOCK_PROMPT =
  "Tap once to start the guide — after that it plays by itself as you arrive.";
