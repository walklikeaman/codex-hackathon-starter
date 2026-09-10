// Every place that has an address, enumerated (#129 step 4, for the sitemap of #158).
//
// The sitemap's one rule is that a URL it prints cannot be a URL the app would 404: works
// come from `/api/directory/films` and cities from the gazetteer, and both are turned into
// paths by the very functions the pages parse. Places shipped with a page and no such
// enumeration — `/api/place` answers ONE place by uuid — so this is the missing half.
//
// **A place row is not the same thing as a place page.** The page is `place_facts_at()`,
// which 404s a place with no facts, while `/api/resolve` writes `places` and the links that
// make facts in two separate statements — and has been observed to fail between them (see
// the 42P10 note there). That leaves a place row no page can be built from. Measured 10.09:
// 70 place rows and all 70 carry a fact, so the filter below drops nothing today. It exists
// so that the day it does drop something, the sitemap loses a URL instead of gaining a 404.
//
// A database function would say that in one `exists (select 1 from place_facts ...)`, which
// is the shape `catalogue_letter` already uses. It is two bounded reads instead, because
// PostgREST cannot do the join from here: `place_facts` is a `union all` view and carries no
// foreign key it can infer, so asking for the embed answers PGRST200. The join would have to
// be a new migration, and a migration that reaches production later than the code turns this
// route into a 502 and the sitemap into a silently empty one. Two reads over 70 rows is the
// cheaper mistake.

import { createClient } from "@supabase/supabase-js";

import { paginate } from "../../../lib/directory.mjs";

export const runtime = "nodejs";

// A place changes about as often as a building does, same as the card itself.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

// The whole graph is 70 places on 10.09, so one page answers everything today. The number
// is here anyway because PostgREST caps a response at 1,000 rows: an unpaged listing does
// not fail at the cap, it silently returns the first thousand, and a sitemap that silently
// stops enumerating is indistinguishable from one that has nothing left to enumerate.
export const PLACES_PER_PAGE = 200;

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    // Ordered by id, and the arbitrariness is the point: paging needs a total order that
    // cannot move between two pages, and a place's name is exactly the column a correction
    // rewrites. The same argument the fact order settled on `fact_id` in 20260902081645.
    async loadPlaces({ limit, offset }) {
      const { data, error, count } = await client
        .from("places")
        .select("id, name", { count: "exact" })
        .order("id")
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`places load failed: ${error.message}`);
      return { places: data ?? [], total: count ?? 0 };
    },
    // Which of those ids the graph has a fact for. Asked about the page in hand rather than
    // about the whole view, so the cost stays tied to the page size as the graph grows.
    async loadFactPlaceIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client.from("place_facts").select("place_id").in("place_id", ids);
      if (error) throw new Error(`place facts load failed: ${error.message}`);
      return (data ?? []).map((row) => row.place_id).filter(Boolean);
    },
  };
}

export function createDirectoryPlacesHandler({
  env = process.env,
  createReader,
  perPage = PLACES_PER_PAGE,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const params = new URL(request.url).searchParams;

    const reader = makeReader(env);
    if (!reader) {
      return Response.json({ error: "The directory is not configured" }, { status: 503, headers: noStoreHeaders });
    }

    try {
      const requested = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
      const { places, total } = await reader.loadPlaces({ limit: perPage, offset: (requested - 1) * perPage });
      // A page past the end is empty here and is NOT re-asked at page 1, which is the one
      // place this route departs from `/api/directory/films`. That rule protects a reader
      // from a link of ours that looks like lost data; the only reader here is a crawler
      // walking pages 1..n, and handing it the first page again would enumerate the same
      // URLs twice under a different page number.
      const page = paginate({ total, page: requested, perPage });

      const withFacts = new Set(await reader.loadFactPlaceIds(places.map((place) => place.id)));

      return Response.json(
        {
          places: places
            .filter((place) => withFacts.has(place.id))
            .map((place) => ({ id: place.id, name: place.name })),
          page,
        },
        { headers: cacheHeaders },
      );
    } catch (error) {
      logError("directory-places", error);
      return Response.json({ error: "The directory is unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  };
}

export const GET = createDirectoryPlacesHandler();
