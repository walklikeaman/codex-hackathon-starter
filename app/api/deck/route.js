// The interests deck for the first run (#15): the best-known works the map can show,
// those with a place near the map's centre first, with a poster sized for the card.
// Read-only and the same for everyone at a place, so cached — the centre is rounded to
// a tenth of a degree (~11 km), which keeps one city on one cached answer.

import { createClient } from "@supabase/supabase-js";

import { tmdbUrlForSurface } from "../../lib/tmdb-images.mjs";

export const runtime = "nodejs";

const cacheHeaders = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async deck(limit, center) {
      const { data, error } = await client.rpc("onboarding_deck", {
        p_limit: limit, p_lat: center?.lat ?? null, p_lng: center?.lng ?? null, p_radius_km: 25,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  };
}

export function deckCards(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year ?? null,
    kind: row.kind,
    places: row.places ?? 0,
    nearby: row.nearby ?? 0,
    poster: row.poster_path ? tmdbUrlForSurface(row.poster_path, "deckCard") : null,
  }));
}

// The map's centre, rounded, or null — a bad or missing pair deals the world's deck.
export function deckCenter(searchParams) {
  const lat = Number(searchParams?.get("lat"));
  const lng = Number(searchParams?.get("lng"));
  if (!searchParams?.has("lat") || !searchParams?.has("lng")) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10 };
}

export function createDeckHandler({ env = process.env, createReader = defaultCreateReader, logError = console.error } = {}) {
  return async function GET(request) {
    const reader = createReader(env);
    if (!reader) return Response.json({ error: "The deck is not configured" }, { status: 503 });
    try {
      const center = deckCenter(request ? new URL(request.url).searchParams : null);
      return Response.json({ cards: deckCards(await reader.deck(60, center)) }, { headers: cacheHeaders });
    } catch (error) {
      logError("onboarding deck failed", { message: error?.message });
      return Response.json({ error: "The deck is unavailable" }, { status: 502 });
    }
  };
}

export const GET = createDeckHandler();
