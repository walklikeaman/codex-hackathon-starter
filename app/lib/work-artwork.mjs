// Cover art for works — pure helpers for the poster pipeline.
//
// Source policy: posters come from TMDB, the licensed official API. They are NOT
// scraped from IMDb: IMDb's terms forbid extraction, its poster art is studio-licensed,
// and any third-party scraper breaks the moment their markup changes. TMDB serves the
// same artwork legally, and image.tmdb.org delivers the file with no key at all —
// only the path is secret-free data we can store and hand to the browser.
//
// The chain is: work.wikidata_id → (P4947 film / P4983 series) → tmdb_id → poster_path.
// Every one of our 12 films/series had a TMDB id in Wikidata, so this is not a
// best-effort path for the common case.

import { entityClaimValues, isWikidataId } from "./location-search.mjs";
import { tmdbImageUrl } from "./tmdb-images.mjs";

// TMDB external-id properties, the same allow-list the cross-walk uses in reverse.
const TMDB_PROPERTY_BY_KIND = Object.freeze({
  film: "P4947",   // TMDb movie id
  series: "P4983", // TMDb TV series id
});

// Sizes chosen for what the UI actually renders; TMDB rejects anything else.
export const POSTER_SIZES = Object.freeze({ thumb: "w185", card: "w500", full: "original" });

export function tmdbPropertyForKind(kind) {
  return TMDB_PROPERTY_BY_KIND[kind] ?? null;
}

// The IMDb id (P345) and Rotten Tomatoes path (P1258) — the two identifiers that make
// a rating clickable back to its source. External-id claims are plain strings.
export function externalIdsFromEntity(entity) {
  const first = (property, pattern) => {
    for (const value of entityClaimValues(entity, property)) {
      const id = typeof value === "string" ? value : value?.id ?? value?.value;
      if (typeof id === "string" && pattern.test(id)) return id;
    }
    return null;
  };
  return {
    imdb_id: first("P345", /^tt\d{7,10}$/),   // titles only; nm*/co* are people/companies
    rt_path: first("P1258", /^(?:m|tv)\/[A-Za-z0-9_-]+$/),
  };
}

// A TMDB id read off a Wikidata entity. Values arrive as plain strings for external
// identifiers (unlike item claims, which are {id: "Q..."}), so take the first that is
// a positive integer and ignore anything malformed rather than guessing.
export function tmdbIdFromEntity(entity, kind) {
  const property = tmdbPropertyForKind(kind);
  if (!property) return null;
  for (const value of entityClaimValues(entity, property)) {
    const id = typeof value === "string" ? value : value?.id ?? value?.value;
    if (typeof id === "string" && /^[1-9]\d*$/.test(id)) return id;
  }
  return null;
}

// Which works still need enrichment, and what to ask Wikidata for. A work without a
// wikidata_id or with an unsupported kind is simply not a candidate — books have no
// TMDB entry at all, and pretending otherwise would burn quota on guaranteed misses.
export function artworkCandidates(works) {
  return (Array.isArray(works) ? works : [])
    .filter((work) => isWikidataId(work?.wikidata_id) && tmdbPropertyForKind(work?.kind))
    .map((work) => ({
      workId: String(work.id),
      wikidataId: work.wikidata_id,
      kind: work.kind,
      tmdbId: /^[1-9]\d*$/.test(String(work.tmdb_id ?? "")) ? String(work.tmdb_id) : null,
    }));
}

const TMDB_PATH = /^\/[A-Za-z0-9._-]+$/;

// Pull the artwork paths out of a TMDB movie/tv payload. Rejects anything that isn't a
// canonical path so a malformed value can never reach an <img src>.
export function artworkFromTmdb(payload) {
  const poster = payload?.poster_path;
  const backdrop = payload?.backdrop_path;
  return {
    poster_path: typeof poster === "string" && TMDB_PATH.test(poster) ? poster : null,
    backdrop_path: typeof backdrop === "string" && TMDB_PATH.test(backdrop) ? backdrop : null,
  };
}

// The public image URL for a stored path. No API key is involved — image.tmdb.org is
// a plain CDN — so this is safe to build on the client too.
export function posterUrl(posterPath, size = POSTER_SIZES.card) {
  return tmdbImageUrl(posterPath, size);
}

// The rows to write back, dropping works whose lookup found nothing so a failed pass
// never overwrites good artwork with nulls.
export function artworkUpdates(results) {
  return (Array.isArray(results) ? results : [])
    .filter((row) => row && row.workId && (row.poster_path || row.tmdb_id))
    .map((row) => ({
      id: row.workId,
      tmdb_id: row.tmdb_id ?? null,
      poster_path: row.poster_path ?? null,
      backdrop_path: row.backdrop_path ?? null,
    }));
}
