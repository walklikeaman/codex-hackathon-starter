// Posters for the live map path (#100-adjacent): TMDB id → poster URL.
//
// Deliberately NOT part of /api/locations. Poster art is decoration; the map and its
// pins are the product. Blocking the locations response on TMDB would make the whole
// map wait for artwork, so the client loads pins first and fills posters in after —
// and a poster that never arrives simply leaves the existing initials tile in place.

import { createClient } from "@supabase/supabase-js";

import {
  MAX_POSTER_LOOKUPS,
  parsePosterQuery,
  posterEntry,
  postersFromRows,
  tmdbDetailUrl,
} from "../../lib/work-posters.mjs";
import { artworkFromTmdb } from "../../lib/work-artwork.mjs";

export const runtime = "nodejs";

// Posters for a released title do not change; a day of caching costs nothing and
// removes almost all TMDB traffic. Public, because no part of this is user-specific.
const cacheHeaders = { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    // Our own table is the first and cheapest source: /api/enrich/artwork has already
    // filled poster_path for everything in the graph.
    async postersByTmdbId(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from("works")
        .select("kind, tmdb_id, poster_path")
        .in("tmdb_id", ids)
        .not("poster_path", "is", null);
      if (error) throw new Error(`works poster load failed: ${error.message}`);
      return data ?? [];
    },
  };
}

async function posterFromTmdb({ kind, tmdbId }, { env, fetchImpl }) {
  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!token && !apiKey) return null;

  const url = tmdbDetailUrl(kind, tmdbId, { apiKey: token ? null : apiKey });
  if (!url) return null;

  const response = await fetchImpl(url, {
    headers: token
      ? { Accept: "application/json", Authorization: `Bearer ${token}` }
      : { Accept: "application/json" },
  });
  if (!response?.ok) return null;

  const { poster_path: posterPath } = artworkFromTmdb(await response.json());
  return posterEntry(posterPath);
}

export function createArtworkHandler({
  env = process.env,
  createStore = defaultCreateStore,
  fetchImpl = fetch,
  logError = console.error,
} = {}) {
  return async function GET(request) {
    const wanted = parsePosterQuery(new URL(request.url).searchParams);
    if (wanted.length === 0) {
      return Response.json({ posters: {} }, { headers: cacheHeaders });
    }

    const posters = {};

    const store = createStore(env);
    if (store) {
      try {
        const rows = await store.postersByTmdbId(wanted.map((item) => String(item.tmdbId)));
        Object.assign(posters, postersFromRows(rows));
      } catch (error) {
        // A poster is decoration; losing the cheap source just means paying TMDB.
        logError("artwork: works lookup failed", error);
      }
    }

    const missing = wanted.filter((item) => !posters[item.key]);
    const fetched = await Promise.all(missing.map(async (item) => {
      try {
        return [item.key, await posterFromTmdb(item, { env, fetchImpl })];
      } catch (error) {
        logError(`artwork: tmdb lookup failed for ${item.key}`, error);
        return [item.key, null];
      }
    }));
    for (const [key, entry] of fetched) {
      if (entry) posters[key] = entry;
    }

    // Keys with no poster are simply absent — the client keeps its initials tile, and
    // an empty object is a valid, cacheable answer rather than an error.
    return Response.json({ posters, requested: wanted.length, limit: MAX_POSTER_LOOKUPS },
      { headers: cacheHeaders });
  };
}

export const GET = createArtworkHandler();
