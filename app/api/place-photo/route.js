import { fetchCommonsNearby } from "../../lib/commons-metadata.mjs";
import { fetchMapillaryNearby } from "../../lib/mapillary.mjs";
import { inRangeOrNull } from "../../lib/numbers.mjs";
import {
  choosePlacePhoto,
  clampRadius,
  DEFAULT_RADIUS_M,
  streetViewEmbedUrl,
} from "../../lib/place-photo.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Absent coordinates must not become 0,0 — see app/lib/numbers.mjs for why this has
// its own module.

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
    const lat = inRangeOrNull(params.get("lat"), { min: -90, max: 90 });
    const lng = inRangeOrNull(params.get("lng"), { min: -180, max: 180 });
    if (lat === null || lng === null) {
      return Response.json(
        { error: "Provide a valid lat and lng" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const radius = clampRadius(params.get("radius") ?? DEFAULT_RADIUS_M);
    const heading = inRangeOrNull(params.get("heading"), { min: -360, max: 360 });

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
