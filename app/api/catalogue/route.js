// The catalogue index: every work we hold a located row for, small enough to download.
//
// It exists so a personal library can be matched WITHOUT being uploaded. The import panel
// promises "The ZIP or CSV is processed locally and is never uploaded", and a 2,422-title
// library posted to a server to be matched would break that for the one feature whose
// appeal is that it does not. So the catalogue travels instead.
//
// Measured: 6,075 works, 15 characters of title on average — a couple of hundred kilobytes
// of JSON before compression, fetched once and cached hard. The alternative, a request per
// title, is 2,422 round-trips.

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// It changes when an ingest runs, which is not often, and a stale index only ever
// understates what we hold. Cached at the edge for an hour and served stale for a day.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async loadCatalogue() {
      // PostgREST caps a response at 1,000 rows and says nothing about it, so a single
      // request would silently return a sixth of the catalogue and every library would
      // look mostly unheld. Paged deliberately.
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client
          .from("catalogue_index")
          .select("id, title_norm, year, kind, imdb_id, tmdb_id, place_count")
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw new Error(`catalogue load failed: ${error.message}`);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      return rows;
    },
  };
}

export function createCatalogueHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET() {
    const reader = makeReader(env);
    if (!reader) {
      return Response.json({ error: "The catalogue is not configured" }, { status: 503, headers: noStoreHeaders });
    }
    try {
      const works = await reader.loadCatalogue();
      return Response.json({ works, count: works.length }, { headers: cacheHeaders });
    } catch (error) {
      logError("catalogue", error);
      return Response.json({ error: "The catalogue is unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  };
}

export const GET = createCatalogueHandler();
