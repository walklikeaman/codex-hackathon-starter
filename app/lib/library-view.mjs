// How a list of works is ordered and narrowed by what the reader has already seen.
//
// **The rating we have is the reader's own.** Measured 10.09.2026 against production:
// `work_ratings` holds **32 rows across 12 works** out of 7,063, and of the 1,642 works
// with a Los Angeles row exactly **one** carries a rating. A real IMDb ratings export
// holds 2,798, every one of them scored. So "sort by rating" can only mean one thing here,
// and pretending otherwise would sort 1,641 films by a field that is null.
//
// That has a consequence worth stating plainly: **this is all decided in the browser.**
// The library lives in localStorage and never reaches the server ([[personal-library]]),
// so no endpoint can order by it — the server hands over what is in the viewport and this
// module decides what the reader sees and in what order.
//
// Related: [[personal-library]], [[studio-lots]], [[directory]].

import { libraryEntryFor, libraryRating } from "./media-library.mjs";

export const SORT = Object.freeze({
  // What the reader thought of it. Only offered once there is a library to read it from.
  rating: "rating",
  // How much we hold. The old default and still the honest one for a stranger: it orders
  // by what there is to go and see rather than by anybody's opinion.
  places: "places",
  title: "title",
});

export const DEFAULT_SORT = SORT.places;

export function isSortMode(mode) {
  return Object.values(SORT).includes(mode);
}

export const NO_MINIMUM = 0;

// IMDb is out of ten, and the useful range is narrower than the scale. Measured over the
// works with a Los Angeles row, 11.09:
//
//   5.0 → 1,397    7.0 →  622    8.5 →  44
//   6.0 → 1,139    7.5 →  355    9.0 →   5
//   6.5 →   888    8.0 →  160
//
// **Below 5 it is barely a filter and above 9 there is nothing left** — five films in the
// whole city. So the slider runs 5 to 9, in tenths, which is the precision IMDb publishes.
// A fixed list of half-points was the first shape and it was too coarse: "somewhere around
// eight" is a real request and 7.5 / 8.0 is not a fine enough answer to it.
export const IMDB_MIN = 5;
export const IMDB_MAX = 9;
export const IMDB_STEP = 0.1;

// Kept for the tests and for anything that wants sensible presets rather than a range.
export const IMDB_STEPS = Object.freeze([6, 6.5, 7, 7.5, 8, 8.5]);

// A slider reports a string and a float, and 7.300000000000001 is what you get from
// stepping by 0.1. Rounded to one decimal so the filter compares — and the label prints —
// the number the reader actually chose.
export function clampImdb(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= NO_MINIMUM) return NO_MINIMUM;
  return Math.round(Math.min(IMDB_MAX, Math.max(IMDB_MIN, score)) * 10) / 10;
}

// The reader's own rating, on the same ten points the public score uses. The library
// normalises every service to that scale on import ([[personal-library]],
// `RATING_SCALE`), so this bar means one thing whether the list came from IMDb or
// Letterboxd.
//
// **Whole numbers, because IMDb has no halves.** Measured on a real IMDb ratings export of
// 2,798 titles, every one of them scored — the export lists only what you rated, so unlike
// a Letterboxd list there is no watched-and-unrated tail:
//
//   1 →   10     5 →  283     9 →  44
//   2 →    6     6 →  985    10 →   9
//   3 →   19     7 → 1079
//   4 →   57     8 →  306
//
// and read as a filter, "this and up":
//
//   5 → 96.7%    7 → 51.4%    9 →  1.9%
//   6 → 86.6%    8 → 12.8%   10 →  0.3%
//
// The range is the WHOLE scale rather than the narrowed 5–9 the public bar uses, and the
// reason is the off position. Zero sits one step to the left of the range, so the control
// reads as one line from "everything" to "only the best" — and one step below 1 is exactly
// 0. Starting at 6 would put the off position on 5, which is a real rating a reader could
// not then ask for. It costs little: 1 through 4 is 92 of 2,798 films, a bar almost
// nobody will set, and it is the honest shape of a ten-point scale.
export const MINE_MIN = 1;
export const MINE_MAX = 10;
export const MINE_STEP = 1;

// Kept for the tests and for anything that wants sensible presets rather than a range:
// the thresholds that actually divide this list.
export const MINE_STEPS = Object.freeze([6, 7, 8, 9, 10]);

export function clampMine(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= NO_MINIMUM) return NO_MINIMUM;
  // Snapped to a whole point, because there is no such IMDb rating as 7.5.
  return Math.round(Math.min(MINE_MAX, Math.max(MINE_MIN, score)));
}

export function imdbLabel(score) {
  if (!Number.isFinite(score)) return null;
  return `${Number(score.toFixed(1))}`;
}

// Does this film clear the public bar?
//
// **An unrated film fails a minimum, and that is deliberate** — the same rule the reader's
// own rating follows. 123 of the 1,642 Los Angeles works have no IMDb rating at all, and
// letting them through a "7.5 and up" filter would put unknown films among the ones the
// reader asked for. Null is not a score.
export function passesImdbFilter(film, minImdb = NO_MINIMUM) {
  const bar = Number(minImdb) || NO_MINIMUM;
  if (bar <= NO_MINIMUM) return true;
  const score = Number(film?.imdb);
  return Number.isFinite(score) && score >= bar;
}

export function ratingLabel(rating) {
  if (!Number.isFinite(rating)) return null;
  // "7/10", not "7★". The denominator is the whole point of the change: a bare star next
  // to a 7 reads as seven stars out of five. It also keeps the reader's bar visibly the
  // same kind of number as the IMDb bar beside it, which is now true.
  //
  // Never "7.0/10" — a trailing zero claims a precision the scale does not have. A half
  // survives the print if one ever arrives from a converted Letterboxd row.
  return `${Number(rating.toFixed(1))}/${MINE_MAX}`;
}

// A minimum rating is a statement about films the reader has rated, so it can only ever
// describe a subset of their list. Said here rather than left for the interface to
// remember, because a filter that silently drops every film NOT in the library — which is
// most of the map — would read as an outage.
export function impliesLibraryOnly(minRating) {
  return Number(minRating) > NO_MINIMUM;
}

// Does this work survive the reader's filters?
//
// `minRating` above zero means "rated at least this", and an UNRATED film fails it. That
// is the intended reading — "show me my 4-star films" is not a request to also see the
// ones I never scored — and it is why the control says "rated" rather than "at least".
export function passesLibraryFilter(work, {
  library = [],
  mineOnly = false,
  minRating = NO_MINIMUM,
} = {}) {
  const wantsRating = impliesLibraryOnly(minRating);
  if (!mineOnly && !wantsRating) return true;

  const entry = libraryEntryFor(work, library);
  if (!entry) return false;
  if (!wantsRating) return true;

  const rating = Number.isFinite(entry.rating) ? entry.rating : null;
  return rating !== null && rating >= Number(minRating);
}

// How many places we hold for a work, under whichever of the several names the callers
// use. The map's chips, the city page and a candidate all count the same thing and none
// of them spell it the same way.
function placeCount(work) {
  for (const key of ["place_count", "placeCount", "places", "la_rows"]) {
    const value = work?.[key];
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

// Sorted, and STABLE: every comparison falls through to the title, so a list does not
// reshuffle itself when two films tie. Two of them tie constantly — 39.8% of works hold
// exactly one place, and 7 is the single most common score in a real export — 1,079 of
// 2,798 titles, with 6 a close second at 985.
export function sortWorks(works, { by = DEFAULT_SORT, library = [] } = {}) {
  const list = Array.isArray(works) ? [...works] : [];
  const byTitle = (a, b) => String(a?.title ?? "").localeCompare(String(b?.title ?? ""));

  if (by === SORT.title) return list.sort(byTitle);

  if (by === SORT.rating) {
    return list.sort((a, b) => {
      const left = libraryRating(a, library);
      const right = libraryRating(b, library);
      // An unrated film sinks below every rated one rather than being treated as a zero.
      // Sorting it as 0 would put "watched, never scored" underneath a film the reader
      // actively disliked, which says something they did not.
      if (left === null && right === null) return placeCount(b) - placeCount(a) || byTitle(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || placeCount(b) - placeCount(a) || byTitle(a, b);
    });
  }

  return list.sort((a, b) => placeCount(b) - placeCount(a) || byTitle(a, b));
}

// What the control says it is doing, so the order on screen is never a mystery. It names
// the tie-breaker too: a reader who sorts by rating and sees two 8/10 films in a row is
// owed the reason one is above the other.
export function sortLabel(by) {
  if (by === SORT.rating) return "Your rating, then how much we hold";
  if (by === SORT.title) return "A–Z";
  return "How much we hold";
}
