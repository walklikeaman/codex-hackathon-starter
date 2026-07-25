import { fetchCommonsNearby } from "../../lib/commons-metadata.mjs";
import { fetchMapillaryNearby } from "../../lib/mapillary.mjs";
import {
  choosePlacePhoto,
  clampRadius,
  DEFAULT_RADIUS_M,
  streetViewEmbedUrl,
} from "../../lib/place-photo.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Number(null) and Number("") are both 0, so an ABSENT coordinate would sail through
// as a valid 0,0 and we would go looking for photos in the Gulf of Guinea. Reject
// missing values before converting — the same trap already fixed in the resolver and
// in the map viewport parser.
function coordinate(value, limit) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

// GET /api/place-photo?lat&lng&radius&heading
// "The place today", picked from a cascade ordered by what we may legally keep:
// Mapillary (CC BY-SA, storable) → Wikimedia Commons (per-file, storable) →
// Street View (LIVE EMBED ONLY — its terms forbid caching or storing the imagery).
//
// Street View is therefore never returned as an image URL, only as an embed URL the
// browser loads directly, and the response says plainly whether the result may be
// stored so a before/after composition cannot accidentally include it.
export function createPlacePhotoHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  logError = (...args) => console.error(...args),
} = {}) {
  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const lat = coordinate(params.get("lat"), 90);
    const lng = coordinate(params.get("lng"), 180);
    if (lat === null || lng === null) {
      return Response.json(
        { error: "Provide a valid lat and lng" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const radius = clampRadius(params.get("radius") ?? DEFAULT_RADIUS_M);
    const heading = Number.isFinite(Number(params.get("heading")))
      ? Number(params.get("heading"))
      : null;

    try {
      // Both free sources are queried together; the cascade decides which wins, and a
      // source that is down or unconfigured simply contributes nothing.
      const [mapillary, wikimedia] = await Promise.all([
        fetchMapillaryNearby({ lat, lng, radius, limit: 12 }, {
          fetchImpl, token: env.MAPILLARY_TOKEN, signal: request.signal,
        }).catch((error) => {
          logError("Mapillary lookup failed", { message: error?.message });
          return [];
        }),
        fetchCommonsNearby({ lat, lng, radius, limit: 10 }, {
          fetchImpl, signal: request.signal,
        }).catch((error) => {
          logError("Commons geosearch failed", { message: error?.message });
          return [];
        }),
      ]);

      const chosen = choosePlacePhoto({ mapillary, wikimedia }, { heading });

      if (chosen) {
        return Response.json(
          {
            photo: {
              source: chosen.source,
              image_url: chosen.image_url,
              image_id: chosen.image_id ?? null, // Mapillary URLs expire; the id does not
              storable: chosen.storable,
              attribution: chosen.attribution,
              page_url: chosen.page_url ?? chosen.attribution?.source_url ?? null,
            },
            candidates: { mapillary: mapillary.length, wikimedia: wikimedia.length },
          },
          { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
        );
      }

      // Nothing storable and creditable — offer Street View, but only as a live embed.
      const embed = streetViewEmbedUrl({ lat, lng, heading, key: env.GOOGLE_MAPS_EMBED_KEY });
      return Response.json(
        {
          photo: null,
          // `storable:false` is the contract: never save or proxy this, per Google's terms.
          street_view: embed ? { embed_url: embed, storable: false } : null,
          candidates: { mapillary: mapillary.length, wikimedia: wikimedia.length },
          reason: embed ? "live_street_view_only" : "no_creditable_photo",
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Place photo lookup failed", { message: error?.message });
      return Response.json(
        { error: "Could not load a photo for this place" },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createPlacePhotoHandler();
