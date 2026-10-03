// City chapters: a story trail that crosses countries, walked one city at a time (#74).
//
// Sherlock Holmes (2009) is filmed in London, Manchester and Liverpool; Skyfall in London,
// Istanbul, Shanghai and Glencoe. Drawn as one trail, the story line ran from Westminster
// to Shanghai, and the walk asked someone in London to head for Manchester next. Nobody
// walks a film across countries. They walk the part of it in the city they are in.
//
// So a trail is cut into chapters, and a chapter is a PLACE, not a stretch of the plot:
// stops within CHAPTER_GAP_KM of one another (chained, so a city's spread does not split
// it) are one chapter, whatever the story does in between. A plot that goes London →
// Manchester → London is two chapters, not three, because the walker in London walks all
// of London's scenes — in the order the story reaches them. Chapters are ordered by the
// first scene each holds, so the first chapter is where the story starts.

import { haversineKm, isFinitePair } from "./geo.mjs";

// Further apart than this is another city, or another country. A London trail reaches
// from Heathrow to Thurrock, 51 km, and chains through the city into one chapter;
// Bourne Woods, 57 km out by Farnham, is a day trip of its own; Manchester is 260 km away.
export const CHAPTER_GAP_KM = 50;

// How near a gazetteer city must be to name the chapter. Its disc is 20 km; a chapter's
// centre can sit a little off it and still be that city.
export const NAMING_RADIUS_KM = 40;

function centreOf(stops) {
  const lat = stops.reduce((sum, stop) => sum + stop.position[0], 0) / stops.length;
  const lng = stops.reduce((sum, stop) => sum + stop.position[1], 0) / stops.length;
  return [lat, lng];
}

// A chapter is called by the city it is in when the gazetteer knows one near enough, and
// otherwise by its first scene's place — "Manchester Town Hall" says where to go as well
// as a city name would, and invents nothing.
function nameOf(stops, cities) {
  const centre = centreOf(stops);
  let best = null;
  for (const city of Array.isArray(cities) ? cities : []) {
    const km = haversineKm(centre, [city.lat, city.lng]);
    if (km <= NAMING_RADIUS_KM && (!best || km < best.km)) best = { name: city.name, km };
  }
  return best?.name ?? stops[0].place ?? stops[0].name ?? "Elsewhere";
}

export function trailChapters(stops, { cities = [] } = {}) {
  const placed = (Array.isArray(stops) ? stops : [])
    .filter((stop) => isFinitePair(stop?.position))
    .sort((left, right) => left.sequence_index - right.sequence_index);

  // Single linkage: a stop joins every chapter it is near, and chapters it bridges merge.
  const groups = [];
  for (const stop of placed) {
    const near = groups.filter((group) => group.some((other) => haversineKm(other.position, stop.position) <= CHAPTER_GAP_KM));
    const merged = [stop, ...near.flat()];
    for (const group of near) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }

  return groups
    .map((group) => group.sort((left, right) => left.sequence_index - right.sequence_index))
    .sort((left, right) => left[0].sequence_index - right[0].sequence_index)
    .map((group, index) => ({ index, name: nameOf(group, cities), stops: group, centre: centreOf(group) }));
}

// Which chapter to open on: the one with the most stops a person can walk to, the
// earliest of those on a tie. Opening on a chapter with nothing walkable would show a
// walk control with nothing to walk.
export function defaultChapter(chapters, isWalkable = () => true) {
  let best = 0;
  let most = -1;
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const count = chapter.stops.filter(isWalkable).length;
    if (count > most) { most = count; best = chapter.index; }
  }
  return best;
}
