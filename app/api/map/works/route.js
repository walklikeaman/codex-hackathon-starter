import { createClient } from "@supabase/supabase-js";

import { graphFailureReason } from "../points/route.js";
import { parseKindsParam } from "../../../lib/map-points.mjs";
import { posterUrl, POSTER_SIZES } from "../../../lib/work-artwork.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    works: async (kinds) => {
      const { data, error } = await client.rpc("map_works", { p_kinds: kinds ?? null });
      if (error) throw new Error(`map_works failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// GET /api/map/works?kinds=film,book
// The works that actually have at least one mappable place, so the "this work" filter
// offers real choices instead of dead ends. A work whose only places are fictional
// (The Lord of the Rings, say) is correctly absent — there is nothing to fly to.
export function createMapWorksHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const kinds = parseKindsParam(new URL(request.url).searchParams.get("kinds"));
    if (kinds?.error) {
      return Response.json({ error: kinds.error }, { status: 400, headers: noStoreHeaders });
    }

    const reader = makeReader(env);
    if (!reader) {
      return Response.json(
        { error: "Map graph is not configured" },
        { status: 503, headers: noStoreHeaders },
      );
    }

    try {
      const rows = await reader.works(kinds?.value ?? null);
      return Response.json(
        {
          works: rows.map((row) => ({
            work_id: row.work_id,
            title: row.title,
            kind: row.kind,
            place_count: row.place_count ?? 0,
            // Two sizes from one stored path: a thumbnail for the picker, a larger
            // one for a card. image.tmdb.org needs no key, so these are plain URLs.
            poster_url: posterUrl(row.poster_path, POSTER_SIZES.card),
            poster_thumb_url: posterUrl(row.poster_path, POSTER_SIZES.thumb),
          })),
        },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
      );
    } catch (error) {
      logError("Map works request failed", { message: error?.message });
      return Response.json(
        { error: "Could not load works", reason: graphFailureReason(error) },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createMapWorksHandler();
