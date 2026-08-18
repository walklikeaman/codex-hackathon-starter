// GET /api/cities/suggest?q=lond — the city half of the one search box (#145).
//
// Separate from `/api/cities` on purpose, and not a mode of it: the two answer different
// questions from different services. This one lists places somebody might mean, from
// Wikidata, on every keystroke; `/api/cities` resolves one submitted name through
// Nominatim, once, when the user asks for it explicitly. See [[search-box]].

import {
  buildCitySuggestQuery,
  cityCandidatesFromBindings,
  formatCitySuggestions,
  MAX_CITY_SUGGESTIONS,
  prepareCityQuery,
  rankCitySuggestions,
} from "../../../lib/city-search.mjs";
import { WIKIDATA_SPARQL } from "../../../lib/geocode-wikidata.mjs";
import { USER_AGENT } from "../../../lib/wikipedia-source.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// The same few prefixes get typed over and over, and Wikidata's answer for "lond"
// changes about as often as London moves. Cached hard at the edge, so the second person
// to type it pays nothing.
const cacheHeaders = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
};

// Long enough for WDQS on a bad day, short enough that the box never feels stuck. The
// film half has already painted by then, which is the whole point of not awaiting them
// together.
const TIMEOUT_MS = 6000;

export function createCitySuggestHandler({
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  logError = (...args) => console.error(...args),
} = {}) {
  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const prepared = prepareCityQuery(params.get("q"), {
      limit: params.get("limit") ?? MAX_CITY_SUGGESTIONS,
    });
    if (!prepared) {
      return Response.json({ query: "", suggestions: [] }, { headers: noStoreHeaders });
    }

    const query = buildCitySuggestQuery(prepared);
    try {
      const response = await fetchImpl(WIKIDATA_SPARQL, {
        method: "POST",
        headers: {
          // WDQS refuses anonymous clients outright.
          "User-Agent": USER_AGENT,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`WDQS responded with ${response.status}`);

      const payload = await response.json();
      const ranked = rankCitySuggestions(cityCandidatesFromBindings(payload), prepared);
      return Response.json(
        { query: prepared.query, suggestions: formatCitySuggestions(ranked, prepared.query) },
        { headers: cacheHeaders },
      );
    } catch (error) {
      // A gazetteer that is down must not fail the box around it. The film half is
      // unaffected, and the empty city group offers the one-request Nominatim lookup —
      // so this degrades into the search that existed before #145 rather than into an
      // error nobody can act on.
      logError("City suggestions failed", { message: error?.message });
      return Response.json(
        { query: prepared.query, suggestions: [], unavailable: true },
        { headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createCitySuggestHandler();
