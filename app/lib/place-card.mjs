// The place card's own arithmetic (#160): what to copy, what to count, and what to say.
//
// Three things taken from lostfoundations' place card, and one deliberately not. The card
// we have is a single scroll holding the sentence, the precision badge, the evidence, the
// voice guide, two images, "Recreate this shot", three external links and "Add to route" —
// a lot of unrelated things in one column. What is here is the part of that split which is
// arithmetic and sentences rather than layout, so it can be tested without a browser.
//
// **Not taken: their 1-5 safety score.** It exists because their readers climb into
// derelict buildings; ours walk to a café on a public street. We already carry the two
// badges that matter here — precision and evidence — and both are better calibrated than a
// number nobody could source.

import { finiteOrNull } from "./numbers.mjs";

// ---------- the coordinate somebody standing in the street wants ----------

// Six decimals is ~11 cm, which is past the point of meaning for a place we located from a
// gazetteer, and four is ~11 m, which is a doorway. The card already printed four; this is
// what gets COPIED, and it is the same number, because a copy button that hands over more
// precision than the page displayed is inventing digits.
export const COORDINATE_DECIMALS = 4;

export function formatCoordinate(lat, lng, { decimals = COORDINATE_DECIMALS } = {}) {
  const latitude = finiteOrNull(lat);
  const longitude = finiteOrNull(lng);
  if (latitude === null || longitude === null) return null;
  // Null Island is not a place. Four incidents in this project, all from `Number("")`
  // being 0 and 0 being finite — a copy button is the last place to hand one on.
  if (latitude === 0 && longitude === 0) return null;
  return `${latitude.toFixed(decimals)}, ${longitude.toFixed(decimals)}`;
}

// "41.65313, 41.68309" is what every maps app, every phone and every messaging app accepts
// when pasted, so the copied text is exactly what the card shows — no label, no name, no
// degree signs. A person pastes this into Google Maps, not into an essay.
export function coordinateToCopy(location) {
  return formatCoordinate(location?.position?.[0], location?.position?.[1]);
}

// ---------- how many places are on screen, and how many films that is ----------

// The two numbers are different and the panel never said so. Ours lists FILMS in view
// without stating how many PLACES that is, which makes "we hold little here" and "you are
// zoomed too far out" look identical — the reader cannot tell a thin catalogue from a
// wrong viewport.

function within(value, low, high) {
  return value >= low && value <= high;
}

// Longitude wraps and latitude does not. A viewport across the antimeridian arrives with
// `west` greater than `east`, and a naive between-test returns zero places for the whole
// Pacific — which would read as "we have nothing there" rather than "the test is wrong".
function longitudeWithin(lng, west, east) {
  return west <= east ? within(lng, west, east) : lng >= west || lng <= east;
}

// A box with no height is not a viewport, it is a map that has not been laid out yet.
// Leaflet answers `getBounds()` on a zero-sized container with a degenerate box, and
// treating that as the truth prints "No places in view" over a map drawing five pins —
// observed on the first paint before the container had a size.
export function isUsableBounds(bounds) {
  if (!bounds) return false;
  const { north, south, east, west } = bounds;
  if ([north, south, east, west].some((edge) => finiteOrNull(edge) === null)) return false;
  return Math.abs(north - south) > 0 && east !== west;
}

export function isInView(location, bounds) {
  const lat = finiteOrNull(location?.position?.[0]);
  const lng = finiteOrNull(location?.position?.[1]);
  if (lat === null || lng === null || !isUsableBounds(bounds)) return false;
  const { north, south, east, west } = bounds;
  return within(lat, Math.min(south, north), Math.max(south, north))
    && longitudeWithin(lng, west, east);
}

// With no usable bounds — the first paint, before the map has been laid out or moved —
// everything is in view. An empty answer there would flash "0 places" over a map full of
// pins.
export function filterInView(locations, bounds) {
  const all = Array.isArray(locations) ? locations : [];
  return isUsableBounds(bounds) ? all.filter((location) => isInView(location, bounds)) : all;
}

export function countInView(locations, bounds) {
  const shown = filterInView(locations, bounds);
  const films = new Set();
  for (const location of shown) {
    const id = location?.filmId ?? location?.film;
    if (id) films.add(id);
  }
  return { places: shown.length, films: films.size };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Places first, because places are what is drawn. The film count comes second and is
// phrased as a source of them — "12 places from 5 films" — rather than as a second total a
// reader has to work out the relationship of.
export function viewCountLabel({ places = 0, films = 0 } = {}) {
  if (places === 0) return "No places in view";
  return `${plural(places, "place")} from ${plural(films, "film")}`;
}

// ---------- the tabs ----------

// Details and Route. NOT Discussion: #157 is not built, and a tab that opens onto nothing
// is the padding this project keeps refusing elsewhere. The id is here so the day #157
// lands the tab is one line and the card does not have to be rearranged again.
export const PLACE_TABS = Object.freeze([
  { id: "details", label: "Details" },
  { id: "route", label: "Route" },
]);

export const DEFAULT_PLACE_TAB = "details";

export function isPlaceTab(id) {
  return PLACE_TABS.some((tab) => tab.id === id);
}

// The card reopens on Details whenever the place changes. Leaving it on Route means
// clicking a new pin shows route controls where the sentence about the place should be —
// which is exactly the "pushed off screen" the issue asks us to stop.
export function tabForLocation(currentTab, changed) {
  if (changed) return DEFAULT_PLACE_TAB;
  return isPlaceTab(currentTab) ? currentTab : DEFAULT_PLACE_TAB;
}

// What the Route tab says about THIS place, so the tab is worth opening even before
// anything has been added.
export function routeTabState({ location, stops = [], maxStops = 5 }) {
  const list = Array.isArray(stops) ? stops : [];
  const index = list.findIndex((stop) => stop.id === location?.id);
  const full = list.length >= maxStops;
  return {
    index,
    added: index !== -1,
    // A stop already on the route cannot be added again, and a full route cannot take
    // another. Both are the same button, and it says which of the two it is.
    canAdd: index === -1 && !full,
    full,
    count: list.length,
    maxStops,
    note: index !== -1
      ? `Stop ${index + 1} of ${list.length} on your route.`
      : full
        ? `Your route is full at ${maxStops} stops. Remove one to add this place.`
        : list.length === 0
          ? "Nothing on your route yet. This place can be the first stop."
          : `${plural(list.length, "stop")} so far. A route needs three before it can be built.`,
  };
}

// ---------- the page: what stands here, and how to tell two facts apart ----------

// Added for step 4 of #129, when the card stopped being a panel beside a map and became a
// page of its own. Both surfaces call these, which is the point: the panel and the page
// must not describe the same place differently.

// A film card's subjects are all one film, so it never has to name a kind. A place card's
// subjects are films, series, books and — when `creators` holds anything — people, and the
// reader has to know which before deciding whether a name is worth clicking.
const SUBJECT_NOUN = {
  film: ["film", "films"],
  series: ["series", "series"],
  book: ["book", "books"],
  person: ["person", "people"],
  // The fallback, and it has to be a real entry rather than a default buried in a lookup:
  // `works.kind` is a database enum that has grown once already, and an unmapped value must
  // print "1 work", not crash the page it was supposed to describe.
  work: ["work", "works"],
};

// A creator's kind is its subject_type, not its `subject_kind` — that column carries the
// kind of a WORK and is null for a person.
function subjectKind(fact) {
  if (fact?.subject_type === "creator") return "person";
  const kind = String(fact?.subject_kind ?? "");
  return kind in SUBJECT_NOUN ? kind : "work";
}

export function subjectNoun(fact, count = 1) {
  const pair = SUBJECT_NOUN[subjectKind(fact)];
  return count === 1 ? pair[0] : pair[1];
}

// English, not a comma-joined array. "4 films, 2 series and 2 books" is a sentence; "4
// films, 2 series, 2 books" is a debug print, and this line is the first thing read.
function sentenceList(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// One line under the place's name: how much is recorded here, and from how many different
// subjects. The two numbers differ whenever a subject has more than one fact at one place
// — London holds 11 facts from 8 subjects, four of them Skyfall — and a line that printed
// only the first would make a place look better covered than it is.
//
// Counted from the rows the page already received, never re-queried: a number computed
// twice from one source is a number that can disagree with itself, which is the reason
// `place_facts_at` returns no count of its own.
export function placeCoverage(facts) {
  const rows = Array.isArray(facts) ? facts : [];
  if (rows.length === 0) return null;

  const subjects = new Map();
  for (const fact of rows) {
    // A fact with no subject id is still a subject; keyed by name so it is not merged
    // into every other unidentified one.
    const key = fact?.subject_id ?? `name:${fact?.subject_name ?? ""}`;
    if (!subjects.has(key)) subjects.set(key, fact);
  }

  const byKind = new Map();
  for (const fact of subjects.values()) {
    const kind = subjectKind(fact);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }

  const kinds = [...byKind.entries()]
    .map(([kind, count]) => `${count} ${SUBJECT_NOUN[kind][count === 1 ? 0 : 1]}`);

  // "work" collects films, series and books; it stops being true the moment a person is
  // among them, and `creators` is empty only until the three unwired modules are wired.
  const anyone = byKind.has("person");
  const from = kinds.length === 1
    ? kinds[0]
    // More than one kind: state the total first, because otherwise the reader has to add
    // three numbers to learn how many things are actually recorded here.
    : `${plural(subjects.size, anyone ? "subject" : "work")} — ${sentenceList(kinds)}`;

  return `${plural(rows.length, "fact")} recorded here, from ${from}.`;
}

// What tells two otherwise identical facts apart.
//
// London holds three Skyfall narrative facts: same subject, same relation, no stated
// sentence, nothing in the row a reader can see. They are three different SCENES, and
// without saying so the page prints one line three times and reads as broken.
export function sceneLabel(fact) {
  if (Number.isInteger(fact?.narrative_order)) return `Scene ${fact.narrative_order}`;
  return fact?.scene_id ? "A scene" : null;
}

// What a studio's page has to say before anything else.
//
// Pinewood Studios is a real building at a real coordinate and three films were really shot
// there — and none of them are ABOUT Pinewood. A film card can leave that to a row label,
// because the reader arrived asking about the film. A place card cannot: the reader arrived
// asking about this address, and "3 facts recorded here" invites exactly the reading the
// grounding rule exists to prevent.
export function depictsElsewhereNote(facts) {
  const rows = Array.isArray(facts) ? facts : [];
  const elsewhere = rows.filter((fact) => fact?.depicts_elsewhere).length;
  if (elsewhere === 0) return null;
  return elsewhere === rows.length
    ? "The camera was here. What it filmed is set somewhere else."
    : `${elsewhere} of these ${elsewhere === 1 ? "was" : "were"} shot on a soundstage here, not in the place ${elsewhere === 1 ? "it shows" : "they show"}.`;
}
