// Story order or walking order: the same stops of a story trail, walked two ways (#73).
//
// The story trail is honest about the plot, and the plot does not care about legs: Dorian
// Gray's five London stops, taken in the order the story reaches them, cross the river
// and come back. Some walkers want exactly that — the film, in sequence. Others want the
// places, and a short afternoon. Both are the same stops; only the order differs, so the
// choice is one switch, and the switch never adds or removes a stop.
//
// The walking order is the shortest open path through the stops — any start, any end —
// measured as the crow flies. The street route between them is then asked of the same
// router every other walk uses; this only decides the order.

import { haversineKm, isFinitePair } from "./geo.mjs";

export const TRAIL_ORDER = Object.freeze({ story: "story", walk: "walk" });

// The story order is called a detour when it is this much longer than the walking order.
// Below it the difference is a street or two, and saying "doubles back" would be noise.
export const DOUBLES_BACK_RATIO = 1.25;

// A leg longer than this is not a walk between scenes; at 4.6 km/h it is 40 minutes of
// walking, and the story trail can jump across a city in one cut (#73: city chapters).
export const LONG_LEG_KM = 3;

function legKm(from, to) {
  return isFinitePair(from?.position) && isFinitePair(to?.position)
    ? haversineKm(from.position, to.position)
    : Number.POSITIVE_INFINITY;
}

export function pathKm(stops) {
  const list = Array.isArray(stops) ? stops : [];
  let total = 0;
  for (let index = 1; index < list.length; index += 1) total += legKm(list[index - 1], list[index]);
  return total;
}

// Nearest neighbour from every starting stop, each improved by 2-opt (reversing a stretch
// whenever that shortens the path), and the shortest kept. A trail holds a handful of
// walkable stops — at most MAX_TRAIL_STOPS — so this is instant, and on paths this small
// it lands on the optimum.
export function walkingOrder(stops) {
  const list = (Array.isArray(stops) ? stops : []).filter((stop) => isFinitePair(stop?.position));
  if (list.length < 3) return list;

  let best = null;
  for (const start of list) {
    const path = [start];
    const left = list.filter((stop) => stop !== start);
    while (left.length > 0) {
      let nearest = 0;
      for (let index = 1; index < left.length; index += 1) {
        if (legKm(path.at(-1), left[index]) < legKm(path.at(-1), left[nearest])) nearest = index;
      }
      path.push(left.splice(nearest, 1)[0]);
    }

    for (let improved = true; improved;) {
      improved = false;
      for (let from = 0; from < path.length - 1; from += 1) {
        for (let to = from + 1; to < path.length; to += 1) {
          const candidate = [...path.slice(0, from), ...path.slice(from, to + 1).reverse(), ...path.slice(to + 1)];
          if (pathKm(candidate) < pathKm(path) - 1e-9) { path.splice(0, path.length, ...candidate); improved = true; }
        }
      }
    }

    if (!best || pathKm(path) < pathKm(best)) best = path;
  }
  return best;
}

// The stops in the chosen order. The story order is the plot's sequence; the walking
// order renumbers nothing — each stop keeps its sequence_index, which is still its place
// in the story, and gains walk_index, its place in the walk.
export function orderTrail(stops, order) {
  const story = [...(Array.isArray(stops) ? stops : [])].sort((left, right) => left.sequence_index - right.sequence_index);
  const ordered = order === TRAIL_ORDER.walk ? walkingOrder(story) : story;
  return ordered.map((stop, index) => ({ ...stop, walk_index: index + 1 }));
}

const km = (value) => `${value < 10 ? value.toFixed(1) : Math.round(value)} km`;

export function longLegs(stops) {
  const list = Array.isArray(stops) ? stops : [];
  let count = 0;
  for (let index = 1; index < list.length; index += 1) if (legKm(list[index - 1], list[index]) > LONG_LEG_KM) count += 1;
  return count;
}

// One line under the switch. Measured on the 12 London films with 3+ walkable stops
// (2026-10-02), a story trail is rarely one walk: ten of them have a leg over 3 km and
// the longest trail runs 61 km. So the line says what the switch saves, and how many legs of
// the chosen order need a ride — not that the walk is pleasant, which it often is not.
// Distances are straight lines; the street route is the router's answer, shown with it.
export function trailOrderNote(stops, order) {
  const story = orderTrail(stops, TRAIL_ORDER.story);
  if (story.length < 2) return null;
  const walk = orderTrail(stops, TRAIL_ORDER.walk);
  const storyKm = pathKm(story);
  const walkKm = pathKm(walk);

  const saving = walkKm > 0 && storyKm / walkKm >= DOUBLES_BACK_RATIO
    ? `${km(storyKm)} in story order, ${km(walkKm)} in walking order`
    : `Story order is already the short way: ${km(storyKm)}`;
  const rides = longLegs(order === TRAIL_ORDER.walk ? walk : story);
  return rides === 0 ? `${saving}.` : `${saving} · ${rides === 1 ? "1 leg needs" : `${rides} legs need`} a ride.`;
}

// The walk, cut where it stops being a walk. Each run is a stretch of stops joined by legs
// a person walks, and is asked of the street router as one route; between runs are the
// rides, drawn as what they are. The router takes 2 to 5 stops, so a longer run is asked
// in pieces that share their end stop.
export const ROUTER_MAX_STOPS = 5;

export function walkRuns(stops) {
  const list = Array.isArray(stops) ? stops : [];
  const runs = [];
  const rides = [];
  let run = list.length > 0 ? [list[0]] : [];
  for (let index = 1; index < list.length; index += 1) {
    if (legKm(list[index - 1], list[index]) > LONG_LEG_KM) {
      rides.push([list[index - 1], list[index]]);
      runs.push(run);
      run = [list[index]];
    } else {
      run.push(list[index]);
    }
  }
  if (run.length > 0) runs.push(run);

  const pieces = [];
  for (const whole of runs.filter((each) => each.length >= 2)) {
    for (let from = 0; from < whole.length - 1; from += ROUTER_MAX_STOPS - 1) {
      pieces.push(whole.slice(from, from + ROUTER_MAX_STOPS));
    }
  }
  return { runs: pieces, rides };
}

// What the router said, added up over the runs: the walking a walker actually does. The
// rides are not in it — they are a different trip, and timing them would be a guess.
export function onFootNote(routes) {
  const list = (Array.isArray(routes) ? routes : []).filter((route) => Number.isFinite(route?.distanceKm));
  if (list.length === 0) return null;
  const distance = list.reduce((sum, route) => sum + route.distanceKm, 0);
  const minutes = Math.round(list.reduce((sum, route) => sum + (route.durationMinutes ?? 0), 0));
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const straight = list.some((route) => route.source === "fallback");
  return `On foot: ${km(distance)}, about ${time}${straight ? " (straight lines; the street router did not answer)" : ""}.`;
}
