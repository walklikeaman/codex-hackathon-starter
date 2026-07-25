// Type-ahead search — pure query shaping and result formatting.
//
// The query is normalised with the SAME function that produced `title_norm` on import
// (normalizeWorkTitle: NFKD, accents stripped, folded to a-z0-9). That single shared
// definition is what makes "amelie" find "Amélie" and "The Matrix!!" find "The Matrix";
// normalising separately on each side is how the two quietly drift apart.

import { normalizeWorkTitle } from "./content-graph.mjs";
import { posterUrl, POSTER_SIZES } from "./work-artwork.mjs";

export const MIN_QUERY_LENGTH = 1;
export const MAX_SUGGESTIONS = 8;

// Prepare a raw input for the search RPC. Returns null when there is nothing worth
// asking the database about, so the caller can skip the round-trip entirely.
export function prepareSearchQuery(raw, { limit = MAX_SUGGESTIONS } = {}) {
  const normalized = normalizeWorkTitle(raw);
  if (normalized.length < MIN_QUERY_LENGTH) return null;
  return {
    query: normalized,
    limit: Math.max(1, Math.min(Number(limit) || MAX_SUGGESTIONS, 25)),
  };
}

const KIND_LABELS = Object.freeze({
  film: "Film", series: "Series", book: "Book", track: "Track", album: "Album",
});

// Normalise a title while remembering, for every character of the result, which
// character of the ORIGINAL produced it. Rebuilding this map is what lets the UI
// highlight "Amélie" correctly for the query "amelie": the folded form and the
// displayed form no longer have the same length or the same indices.
//
// Done per character rather than by re-normalising growing prefixes, because the
// normaliser trims and collapses whitespace — so prefix lengths do not grow
// monotonically and cannot be used as offsets.
function normalizeWithIndex(title) {
  let normalized = "";
  const originIndex = [];

  for (let i = 0; i < title.length; i += 1) {
    const folded = normalizeWorkTitle(title[i]);
    // A character that folds away entirely (punctuation, a combining accent)
    // contributes nothing but must not shift the mapping.
    const piece = folded.length > 0 ? folded : (/\s/.test(title[i]) ? " " : "");
    for (const char of piece) {
      if (char === " " && (normalized.length === 0 || normalized.endsWith(" "))) continue;
      normalized += char;
      originIndex.push(i);
    }
  }
  return { normalized: normalized.trimEnd(), originIndex };
}

// Where the matched characters are, so the UI can highlight them the way IMDb does.
// Returns null when the match is not a visible prefix of a word — highlighting the
// wrong characters is worse than highlighting none.
export function matchRange(title, normalizedQuery) {
  if (typeof title !== "string" || !normalizedQuery) return null;

  const { normalized, originIndex } = normalizeWithIndex(title);
  const at = normalized.startsWith(normalizedQuery)
    ? 0
    : normalized.indexOf(` ${normalizedQuery}`) + 1;
  if (at < 1 && !normalized.startsWith(normalizedQuery)) return null;

  const start = originIndex[at];
  const lastMatched = originIndex[at + normalizedQuery.length - 1];
  if (start === undefined || lastMatched === undefined) return null;
  return { start, end: lastMatched + 1 };
}

export function formatSuggestions(rows, normalizedQuery) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    work_id: row.work_id,
    title: row.title,
    kind: row.kind,
    kind_label: KIND_LABELS[row.kind] ?? row.kind,
    year: Number.isInteger(row.year) ? row.year : null,
    place_count: row.place_count ?? 0,
    poster_thumb_url: posterUrl(row.poster_path, POSTER_SIZES.thumb),
    match: matchRange(row.title, normalizedQuery),
  }));
}
