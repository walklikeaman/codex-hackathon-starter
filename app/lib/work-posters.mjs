// Poster lookup for the LIVE map path.
//
// `/api/enrich/artwork` already fills `works.poster_path` for works in our graph, and
// the graph layer renders those. But the film chips people actually see are built from
// the live Wikidata path, which can return any film in any city — most of them not in
// our table — so those chips fell back to two-letter initials and looked like
// unfinished placeholders.
//
// The live payload already carries `film_tmdb_id`, so no Wikidata round-trip is
// needed here. This module turns TMDB ids into poster URLs, in the cheap order:
// our own table first (free, instant, already enriched), TMDB only for the rest.
//
// Posters are studio art served by TMDB under their API terms — never scraped from
// IMDb — and image.tmdb.org needs no key, so only the path is stored.

import { POSTER_SIZES } from "./work-artwork.mjs";
import { parseTmdbMovieId, tmdbImageUrl } from "./tmdb-images.mjs";

// TMDB uses different endpoints for films and series, and the same integer can be a
// valid id in both. Keying by kind keeps "movie 1399" and "tv 1399" apart.
const TMDB_PATH_BY_KIND = Object.freeze({ film: "movie", series: "tv" });

// One request paints one screenful of chips; anything beyond this is not a UI need.
export const MAX_POSTER_LOOKUPS = 24;

export function posterKey(kind, tmdbId) {
  const id = parseTmdbMovieId(tmdbId);
  if (!id || !TMDB_PATH_BY_KIND[kind]) return null;
  return `${kind}:${id}`;
}

// `?film=170,78&series=19885` → [{kind, tmdbId, key}], deduplicated and bounded.
// Unparseable ids are dropped rather than rejected: one bad id in a list should cost
// that poster, not the whole screen's worth.
export function parsePosterQuery(searchParams) {
  const wanted = [];
  const seen = new Set();

  for (const kind of Object.keys(TMDB_PATH_BY_KIND)) {
    const raw = searchParams?.get?.(kind);
    if (!raw) continue;
    for (const candidate of String(raw).split(",")) {
      const key = posterKey(kind, candidate.trim());
      if (!key || seen.has(key)) continue;
      seen.add(key);
      wanted.push({ kind, tmdbId: parseTmdbMovieId(candidate.trim()), key });
      if (wanted.length >= MAX_POSTER_LOOKUPS) return wanted;
    }
  }
  return wanted;
}

// Both sizes, because the chip wants a thumbnail and the card wants a larger one, and
// re-deriving the URL on the client would mean shipping the base URL and size rules there.
export function posterEntry(posterPath) {
  const thumb = tmdbImageUrl(posterPath, POSTER_SIZES.thumb);
  const card = tmdbImageUrl(posterPath, POSTER_SIZES.card);
  return thumb && card ? { thumb, card } : null;
}

// Rows from our own `works` table → the response shape. Rows without a poster are
// skipped so a work we know about but have not enriched yet still falls through to
// TMDB rather than being cached as "no poster".
export function postersFromRows(rows) {
  const found = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = posterKey(row?.kind, row?.tmdb_id);
    const entry = key ? posterEntry(row?.poster_path) : null;
    if (key && entry) found[key] = entry;
  }
  return found;
}

export function tmdbDetailUrl(kind, tmdbId, { apiKey } = {}) {
  const path = TMDB_PATH_BY_KIND[kind];
  const id = parseTmdbMovieId(tmdbId);
  if (!path || !id) return null;
  const endpoint = new URL(`https://api.themoviedb.org/3/${path}/${id}`);
  if (apiKey) endpoint.searchParams.set("api_key", apiKey);
  return endpoint.toString();
}
