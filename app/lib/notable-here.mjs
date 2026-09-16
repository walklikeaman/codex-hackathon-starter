// What is worth seeing in the part of the map you are looking at (#201).
//
// The panel could say how MANY films are in view and never which ones mattered. "994 films
// · 2,480 places" is a quantity, and the question a visitor actually arrives with is
// "what is this place famous for" — which nothing answered.
//
// ---------------------------------------------------------------------------------------
//
// **Famous is not the same as highly rated, and conflating them produces a wrong list.**
//
// IMDb's rating alone puts a 9.2 with 300 votes above Forrest Gump. That film is not
// famous; it is obscure and liked by the few who found it. Vote count alone has the
// opposite fault: it ranks by how many people watched, so a bad film everybody saw beats a
// great one most did not.
//
// So the score multiplies the two, with the votes on a log scale because fame is
// multiplicative — the step from 1,000 to 10,000 voters means far more than 1,000,000 to
// 1,010,000. Worked on real rows from the Los Angeles set:
//
//   Forrest Gump      8.8 × log10(2,532,967) = 8.8 × 6.40 = 56.3
//   The Big Lebowski  8.1 × log10(  924,249) = 8.1 × 5.97 = 48.4
//   90210             6.2 × log10(   47,724) = 6.2 × 4.68 = 29.0
//   Fred & Vinnie     5.9 × log10(      165) = 5.9 × 2.22 = 13.1
//
// which is the order a person would give if asked what Los Angeles is known for.

// Below this the rating is not a measurement, it is a handful of opinions. 165 voters
// decide a score to one decimal place, and that score should not be allowed to rank
// anything. Excluded outright rather than down-weighted: a list called "worth seeing"
// should not quietly include something nobody has seen.
export const MIN_VOTES = 1000;

// `Number(null)` is 0 and `Number.isFinite(0)` is true, so a film with NO rating scored a
// perfectly valid zero and stayed in the list. It would sort last — until a view held fewer
// than five rated works, and then an unrated one would be presented as worth seeing. The
// absence of a rating is not a low rating, and this is where the two stop being confused.
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function notability(film) {
  const rating = numberOrNull(film?.imdb);
  const votes = numberOrNull(film?.imdb_votes);

  if (rating === null || votes === null) return null;
  if (votes < MIN_VOTES) return null;

  return rating * Math.log10(votes);
}

// The list itself. Ranked, capped, and honest about ties: two works with the same score
// fall back to the title so the order does not reshuffle as the map is nudged.
export function notableHere(films, { limit = 5 } = {}) {
  return (Array.isArray(films) ? films : [])
    .map((film) => ({ film, score: notability(film) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score
      || String(a.film.title ?? "").localeCompare(String(b.film.title ?? "")))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.film);
}

// Which places on the map have earned a name on the pin.
//
// Borrowed from how Airbnb draws a map: the listings most likely to matter get a full pin
// with a label, and everything else gets a small oval without one. A thousand labels is the
// same as none — they collide, they cover the streets, and the eye has nowhere to land. So
// the label is a scarce resource, spent on the places holding the best-known work.
//
// Keyed by coordinate because that is what the pin layer has; a place is a point, and two
// works at one address share a pin.
// The cap is on the LABELS, not on the films, and that distinction is the whole point. It
// used to cap the film list at eight and then label every place each of those films held —
// and one film holds up to 96 places at one address in this data set, so eight films could
// produce hundreds of labels. The number that had to stay small was the number of words
// drawn over the streets.
export function labelledPlaces(films, { limit = 8 } = {}) {
  const labels = new Map();
  const ceiling = Math.max(0, limit);
  if (ceiling === 0) return labels;

  // Ranked without a cap, so the eighth label can come from the twentieth film when the
  // best-known nineteen all sit at one address.
  for (const film of notableHere(films, { limit: Infinity })) {
    for (const place of Array.isArray(film.places) ? film.places : []) {
      if (!Number.isFinite(place?.lat) || !Number.isFinite(place?.lng)) continue;
      const key = `${place.lat},${place.lng}`;
      // First writer wins: the films arrive best-known first, so a place shared by two
      // works is named after the one people came for.
      if (!labels.has(key)) labels.set(key, film.title ?? "");
      if (labels.size >= ceiling) return labels;
    }
  }

  return labels;
}

// Why the list is empty, said out loud (#240).
//
// "Known for" was rendered only when it had rows, so an empty one UNMOUNTED — and the panel
// around it kept talking. Measured on the second design review: three of five loads over
// Los Angeles drew a black map, the section vanished, and the panel still read "3 places
// from 3 films in Los Angeles" while the console count degraded to the bare word "layers".
// Nothing anywhere said something was wrong. `?imdb=8` reproduced the same silence on a map
// that had drawn perfectly well.
//
// Those are five different situations with five different fixes, and an empty section
// cannot tell them apart. So the reason is decided here, in the order a reader could act
// on it, and the first one that holds is the one that is said.
export const EMPTY_REASON = Object.freeze({
  loading: "loading",
  queue_hidden: "queue_hidden",
  zoomed_out: "zoomed_out",
  filtered_out: "filtered_out",
  nothing_here: "nothing_here",
  unranked: "unranked",
});

export function notableEmptyReason({
  notable = [],
  filmsHere = [],
  summary = null,
  candidatesOn = true,
  activeFilters = 0,
} = {}) {
  if (Array.isArray(notable) && notable.length > 0) return null;

  // Checked first because every later answer is a claim about what the map DREW, and a map
  // that has not answered yet has drawn nothing — including on a failed tile load, which is
  // the case that used to look exactly like an empty city.
  if (!summary) {
    return { code: EMPTY_REASON.loading, text: "The map hasn't answered yet." };
  }
  if (!candidatesOn) {
    return {
      code: EMPTY_REASON.queue_hidden,
      text: "Unchecked places are hidden, and almost everything here is one.",
    };
  }
  if (summary.clustered) {
    return { code: EMPTY_REASON.zoomed_out, text: "Zoom in to see what this place is known for." };
  }

  const drawn = Array.isArray(filmsHere) ? filmsHere.length : 0;
  if (drawn === 0) {
    // A filter that emptied the map is a different sentence from a place we hold nothing
    // for — one is undone by a button, the other by moving the map.
    return activeFilters > 0
      ? { code: EMPTY_REASON.filtered_out, text: "Nothing here passes your filters." }
      : { code: EMPTY_REASON.nothing_here, text: "We hold nothing in this part of the map yet." };
  }

  // Films are drawn, and none of them has enough ratings to rank. Saying "nothing here"
  // would be false: the pins are on screen.
  return {
    code: EMPTY_REASON.unranked,
    text: `${drawn} ${drawn === 1 ? "film is" : "films are"} here, none rated by enough people to rank.`,
  };
}
