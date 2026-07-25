import { fetchCommonsAttribution } from "../../lib/commons-metadata.mjs";

export const runtime = "nodejs";

const MAX_URLS = 20;

// GET /api/attribution?url=<a>&url=<b>
// Author and licence for Commons images, which are licensed PER FILE — knowing an
// image came from Commons is not permission to publish it. Without this the UI's
// fail-safe (app/lib/attribution.mjs isDisplayable) has to hide every Commons photo,
// because it has no credit to show.
//
// Public and cacheable: file metadata changes very rarely and contains nothing private.
export function createAttributionHandler({
  fetchImpl = (...args) => fetch(...args),
  logError = (...args) => console.error(...args),
} = {}) {
  return async function GET(request) {
    // Repeated `url` params, NOT a comma-separated list: Commons filenames routinely
    // contain commas ("Trafalgar Square, London 2 - Jun 2009.jpg"), so splitting on
    // one tears the URL in half and the lookup silently returns nothing.
    const urls = new URL(request.url).searchParams
      .getAll("url")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_URLS);

    if (urls.length === 0) {
      return Response.json({ attributions: {} }, { headers: { "Cache-Control": "no-store" } });
    }

    try {
      const byUrl = await fetchCommonsAttribution(urls, { fetchImpl, signal: request.signal });
      return Response.json(
        { attributions: Object.fromEntries(byUrl) },
        { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
      );
    } catch (error) {
      logError("Attribution lookup failed", { message: error?.message });
      // An empty map is the safe answer: the client keeps the image hidden rather
      // than showing it uncredited.
      return Response.json(
        { attributions: {}, error: "Could not load attribution" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createAttributionHandler();
