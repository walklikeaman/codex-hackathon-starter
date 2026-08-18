// The directory's arithmetic and its sentences (#158). No I/O, no framework.
//
// The rule this module exists to keep is the one the issue asks for in its last line:
// **be honest about coverage rather than padded**. Our distribution is thin by nature —
// 2,667 of the 6,392 works we hold a place for hold exactly ONE, measured 18.08 — so every
// count here is printed as it is, a city with two pins says two, and nothing rounds up or
// says "many". A directory that oversells its thin half is the one nobody trusts on the
// half that is good.

export const WORKS_PER_PAGE = 100;
export const CITY_WORKS_PER_PAGE = 48;

// '#' collects everything that does not begin with a Latin letter — a numeral ("1917",
// "28 Weeks Later") or another alphabet. It is a real bucket with real works in it, not
// an error state.
export const OTHER_LETTER = "#";
export const DIRECTORY_LETTERS = Object.freeze([
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  OTHER_LETTER,
]);

// Bucketed on `title_norm` with its leading article removed — the mirror of
// `directory_sort_key()` in the database, and the two must not drift.
//
// Our sources disagree about articles: movie-locations ships "Caper of the Golden Bulls,
// The" while TMDB ships "The Dark Knight". Filing on the raw column put 1,427 of 6,392
// works under T, measured on 18.08 before this rule. Stripping only a LEADING article
// fixes the titles that carry one and leaves the comma-inverted ones alone, because
// theirs already sits at the end: T fell to 330 and S became the largest letter at 640.
const LEADING_ARTICLE = /^(the|an|a) /;

export function directorySortKey(titleNorm) {
  return String(titleNorm ?? "").trim().toLowerCase().replace(LEADING_ARTICLE, "");
}

export function letterBucket(titleNorm) {
  const first = directorySortKey(titleNorm).charAt(0);
  return first >= "a" && first <= "z" ? first : OTHER_LETTER;
}

export function isDirectoryLetter(letter) {
  return DIRECTORY_LETTERS.includes(String(letter ?? "").toLowerCase());
}

// The letter as it travels in a URL. '#' cannot: it is the fragment delimiter, and a link
// to /directory/films/# reaches the server as /directory/films/ with everything after the
// hash never sent at all.
export const OTHER_LETTER_SLUG = "other";

export function letterToSlug(letter) {
  return letter === OTHER_LETTER ? OTHER_LETTER_SLUG : letter;
}

export function letterFromSlug(slug) {
  const text = String(slug ?? "").toLowerCase();
  if (text === OTHER_LETTER_SLUG) return OTHER_LETTER;
  return isDirectoryLetter(text) && text !== OTHER_LETTER ? text : null;
}

// A page number is whatever a stranger types into a query string, so it is clamped rather
// than trusted: a negative offset is an error from PostgREST and page 900 of a 4-page list
// should be the last page, not an empty one that looks like we lost the data.
export function paginate({ total = 0, page = 1, perPage = WORKS_PER_PAGE } = {}) {
  const size = Math.max(1, Math.floor(perPage));
  const count = Math.max(0, Math.floor(total));
  const pages = Math.max(1, Math.ceil(count / size));
  const requested = Number.parseInt(page, 10);
  const current = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const offset = (current - 1) * size;
  return {
    page: current,
    pages,
    perPage: size,
    offset,
    total: count,
    // Inclusive, 1-based, and empty when there is nothing: "0 of 0" is a sentence a reader
    // can act on, "1–0 of 0" is not.
    from: count === 0 ? 0 : offset + 1,
    to: Math.min(offset + size, count),
    hasPrev: current > 1,
    hasNext: current < pages,
  };
}

// Only the words this module actually prints. A general pluraliser is a library nobody
// asked for; "citys" is what happens without the exception.
const PLURALS = { city: "cities" };

function plural(n, word) {
  return `${n} ${n === 1 ? word : PLURALS[word] ?? `${word}s`}`;
}

// What a city page says under its title. It states the radius because the radius is what
// the page MEANS: these are not the films made in the city's administrative boundary, they
// are the films we hold a place for within 20 km of a measured centre.
export function cityCoverage({ works = 0, points = 0, radiusKm = 20 } = {}) {
  if (works === 0) {
    return `No places recorded within ${radiusKm} km of here yet.`;
  }
  return `${plural(works, "film")} with ${plural(points, "place")} recorded within ${radiusKm} km of the centre.`;
}

// The line under a work in a city list. Printed even at one place, deliberately: a work we
// hold a single pin for is not a tour and the directory should not imply otherwise.
export function cityWorkLine({ place_count: count = 0, places = [] } = {}) {
  const names = (Array.isArray(places) ? places : []).filter(Boolean);
  const shown = names.slice(0, 3).join(" · ");
  const rest = count - Math.min(names.length, 3);
  if (!shown) return plural(count, "place");
  return rest > 0 ? `${shown} — and ${rest} more` : shown;
}

// Countries ordered by what we actually hold, cities inside them likewise. An alphabetical
// country list would open the directory on Bulgaria.
export function groupByCountry(cities = []) {
  const groups = new Map();
  for (const city of cities) {
    const country = city?.country || "Elsewhere";
    if (!groups.has(country)) groups.set(country, []);
    groups.get(country).push(city);
  }
  return [...groups.entries()]
    .map(([country, list]) => ({
      country,
      cities: [...list].sort((a, b) => (b.works ?? 0) - (a.works ?? 0) || a.name.localeCompare(b.name)),
      works: list.reduce((sum, city) => sum + (city.works ?? 0), 0),
    }))
    .sort((a, b) => b.works - a.works || a.country.localeCompare(b.country));
}

// The index's headline. `citiesWorks` cannot be summed into `works` and presented as a
// share — the discs do not overlap, but they do not cover everything either, and most of
// what we hold is nowhere near any of these cities.
export function directorySummary({ works = 0, points = 0, cities = 0 } = {}) {
  return `${plural(works, "film")} with ${plural(points, "place")} between them, and ${plural(cities, "city")} with enough to browse.`;
}
