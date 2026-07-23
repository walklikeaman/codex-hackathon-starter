// Content graph — pure helpers that turn imported library items into canonical
// `works` rows + `user_library_items`, deduped, ready for a service-role upsert.
// See ARCHITECTURE.md §3/§5. The DB write lives in the import route; this module
// is pure and unit-tested.

// Canonical title normalization for dedup (works.title_norm, pg_trgm) when there
// is no external id: NFKD, strip accents, fold to a-z0-9. Stricter than the older
// media-library.mjs variant (which kept accents) so cross-source titles match.
export function normalizeWorkTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents so "Amélie" === "Amelie"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A stable natural key so library items can be joined to their work row before
// the DB has assigned a uuid: prefer an external id, else normalized title+year.
export function workNaturalKey({ tmdb_id, imdb_id, title_norm, year }) {
  if (tmdb_id) return `tmdb:${tmdb_id}`;
  if (imdb_id) return `imdb:${imdb_id}`;
  return `title:${title_norm}:${year ?? ""}`;
}

// Map parsed Letterboxd film records → canonical works rows.
export function worksFromLetterboxd(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.title && item.tmdbId)
    .map((item) => {
      const title = String(item.title).trim();
      return {
        kind: "film",
        tmdb_id: String(item.tmdbId),
        imdb_id: null,
        title,
        title_norm: normalizeWorkTitle(title),
        year: Number.isInteger(item.year) ? item.year : null,
      };
    })
    .filter((row) => row.title_norm.length > 0);
}

// Deduplicate work rows by natural key (external id, else title+year), keeping the
// first occurrence — one row per real work even when a library lists it twice.
export function dedupWorkRows(rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = workNaturalKey(row);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

// Build the per-user library entries keyed by natural key, carrying the source and
// an optional rating. The route resolves natural key → work uuid after the works
// upsert, then writes user_library_items.
export function libraryItemsFromLetterboxd(items, { source = "letterboxd" } = {}) {
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.tmdbId) continue;
    const key = `tmdb:${item.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      naturalKey: key,
      source,
      rating: Number.isFinite(item.rating) ? item.rating : null,
    });
  }
  return entries;
}
