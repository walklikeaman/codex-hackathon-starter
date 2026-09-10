// How a list of works is ordered and narrowed by what the reader has already seen.
//
// **The rating we have is the reader's own.** Measured 10.09.2026 against production:
// `work_ratings` holds **32 rows across 12 works** out of 7,063, and of the 1,642 works
// with a Los Angeles row exactly **one** carries a rating. A real Letterboxd export holds
// 2,407 ratings for 2,422 films. So "sort by rating" can only mean one thing here, and
// pretending otherwise would sort 1,641 films by a field that is null.
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

// Letterboxd rates in half-stars. These are the only thresholds offered, because a
// free-number input invites 3.7 and there is no such rating.
export const RATING_STEPS = Object.freeze([3, 3.5, 4, 4.5, 5]);
export const NO_MINIMUM = 0;

export function ratingLabel(rating) {
  if (!Number.isFinite(rating)) return null;
  // "4★", "4.5★" — never "4.0★". A trailing zero reads as a precision Letterboxd does
  // not have.
  return `${Number(rating.toFixed(1))}★`;
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
// exactly one place, and a 3.5★ rating is the single most common score in a real export.
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
// the tie-breaker too: a reader who sorts by rating and sees two 4★ films in a row is
// owed the reason one is above the other.
export function sortLabel(by) {
  if (by === SORT.rating) return "Your rating, then how much we hold";
  if (by === SORT.title) return "A–Z";
  return "How much we hold";
}
