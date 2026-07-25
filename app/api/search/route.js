import { createClient } from "@supabase/supabase-js";

import { graphFailureReason } from "../map/points/route.js";
import { formatSuggestions, MAX_SUGGESTIONS, prepareSearchQuery } from "../../lib/work-search.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Public read: the graph is public-read under RLS, so search needs no session.
function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async search({ query, limit }) {
      const { data, error } = await client.rpc("search_works", {
        p_query: query,
        p_limit: limit,
      });
      if (error) throw new Error(`search_works failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// GET /api/search?q=sky&limit=8
// Type-ahead over the graph. Answers from the persistent graph, so it returns as fast
// as an index lookup — the live Wikidata search stays on the form's submit for titles
// we have not grounded yet.
export function createSearchHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const prepared = prepareSearchQuery(params.get("q"), {
      limit: params.get("limit") ?? MAX_SUGGESTIONS,
    });

    // Too short to be worth a query — an empty result, not an error: the user is
    // simply still typing.
    if (!prepared) {
      return Response.json({ query: "", suggestions: [] }, { headers: noStoreHeaders });
    }

    const reader = makeReader(env);
    if (!reader) {
      return Response.json(
        { error: "Search is not configured" },
        { status: 503, headers: noStoreHeaders },
      );
    }

    try {
      const rows = await reader.search(prepared);
      return Response.json(
        { query: prepared.query, suggestions: formatSuggestions(rows, prepared.query) },
        // Short shared cache: the same few prefixes get typed constantly, and the
        // graph changes far slower than people type.
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
      );
    } catch (error) {
      logError("Work search failed", { message: error?.message });
      return Response.json(
        { error: "Could not search works", reason: graphFailureReason(error) },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createSearchHandler();
