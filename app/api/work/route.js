// The film profile (#107, #110): one work, everything we can say about it.
//
// Keyed by TMDB id rather than by our own uuid, because the film chips people click
// come from the LIVE Wikidata path and most of those works are not in our graph at
// all. A work we hold gets its places and ratings; one we do not still gets a poster,
// its stills and its external links, instead of an empty page.

import { createClient } from "@supabase/supabase-js";

import {
  MAX_PROFILE_STILLS,
  parseProfileQuery,
  placeTally,
  profilePlaces,
  profileRatings,
  sourceLinks,
} from "../../lib/work-profile.mjs";
import { posterUrl, POSTER_SIZES } from "../../lib/work-artwork.mjs";
import { selectTmdbBackdrops, tmdbImageUrl } from "../../lib/tmdb-images.mjs";

export const runtime = "nodejs";

// A profile is opened deliberately and its contents barely change, so it may be
// cached hard. Nothing in it is user-specific.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };

export const TMDB_TIMEOUT_MS = 4000;
const TMDB_PATH = Object.freeze({ film: "movie", series: "tv" });

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    async loadWork(query) {
      const columns = "id, title, kind, year, tmdb_id, imdb_id, wikidata_id, poster_path, backdrop_path, rt_path, mc_path";
      const builder = query.workId
        ? client.from("works").select(columns).eq("id", query.workId)
        : client.from("works").select(columns).eq("tmdb_id", String(query.tmdbId)).eq("kind", query.kind);
      const { data, error } = await builder.maybeSingle();
      if (error) throw new Error(`work load failed: ${error.message}`);
      return data;
    },
    async loadRatings(workId) {
      const { data, error } = await client
        .from("work_ratings")
        .select("source, score, display, votes, source_url")
        .eq("work_id", workId);
      if (error) throw new Error(`ratings load failed: ${error.message}`);
      return data ?? [];
    },
    // Verdicts from /api/enrich/stills. Present means the gallery has been looked at;
    // absent means it has not, and the caller must say so rather than imply it has.
    async loadClassifiedImages(workId) {
      const { data, error } = await client
        .from("work_images")
        .select("file_path, is_frame, width, height")
        .eq("work_id", workId);
      if (error) throw new Error(`images load failed: ${error.message}`);
      return data ?? [];
    },
    // Tier A: frames matched to a specific place, each carrying the evidence that
    // justified the claim.
    async loadPlaceFrames(workId) {
      const { data, error } = await client
        .from("place_frames")
        .select("place_id, file_path, evidence")
        .eq("work_id", workId);
      if (error) throw new Error(`place frames load failed: ${error.message}`);
      return data ?? [];
    },
    // The join that makes the studio distinction possible: place_class comes from the
    // resolver's P31 ancestry walk, relation_kind from the edge.
    async loadPlaces(workId) {
      const { data, error } = await client
        .from("work_place_links")
        .select(`relation_kind, confidence,
                 places ( id, name, city, country, lat, lng, place_class,
                          geocode_precision, confidence, wikidata_id, osm_building_id )`)
        .eq("work_id", workId);
      if (error) throw new Error(`places load failed: ${error.message}`);
      return (data ?? [])
        .filter((row) => row.places)
        .map((row) => ({ ...row.places, relation_kind: row.relation_kind }));
    },
  };
}

// TMDB's "backdrops" mix two different things: photographic frames from the film and
// promotional key art — gun-barrel silhouettes, title treatments, cast montages.
//
// This drops images with text baked in, which TMDB marks with a language code. It
// helps, but it is NOT the separation we want, and Skyfall proves it: its gun-barrel
// art and its title card both come back with `iso_639_1: null` and survive untouched.
// A silhouette genuinely has no text — it is simply not a frame from the film. That
// is a semantic distinction, and no metadata field carries it.
//
// The real separation is the vision check the scene matcher already performs
// (`isPhotographicFrame` / `hasProminentTitleOrLogo` in scene-image-match.mjs). Until
// that runs here, the caption says what these images actually are rather than
// promising frames we have not verified.
export function textlessBackdrops(backdrops) {
  const all = Array.isArray(backdrops) ? backdrops : [];
  const textless = all.filter((image) => !image?.iso_639_1);
  return textless.length > 0 ? textless : all;
}

// Frames from the film. Tier B in the stills policy: these are real production
// images, but nothing has verified WHICH place any of them shows, so they are
// presented as belonging to the film and never pinned to a location.
async function stillsFromTmdb({ kind, tmdbId }, { env, fetchImpl, timeoutMs, logError }) {
  const path = TMDB_PATH[kind];
  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!path || (!token && !apiKey)) return [];

  const attempts = [];
  if (token) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${tmdbId}/images`,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  }
  if (apiKey) {
    attempts.push({
      url: `https://api.themoviedb.org/3/${path}/${tmdbId}/images?api_key=${encodeURIComponent(apiKey)}`,
      headers: { Accept: "application/json" },
    });
  }

  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response?.ok) {
        const payload = await response.json();
        return selectTmdbBackdrops(textlessBackdrops(payload?.backdrops), MAX_PROFILE_STILLS)
          .map((image) => ({
            url: tmdbImageUrl(image.file_path, "w780"),
            full: tmdbImageUrl(image.file_path, "original"),
            width: image.width ?? null,
            height: image.height ?? null,
          }))
          .filter((still) => still.url);
      }
      // Same lesson as /api/artwork: the two credential schemes are not
      // interchangeable, so a rejected one is worth retrying with the other.
      if (response?.status !== 401 && response?.status !== 403) break;
    } catch (error) {
      logError(`work: stills lookup failed for ${kind}/${tmdbId}`, error);
      break;
    }
  }
  return [];
}

export function createWorkProfileHandler({
  env = process.env,
  createStore = defaultCreateStore,
  fetchImpl = fetch,
  timeoutMs = TMDB_TIMEOUT_MS,
  logError = console.error,
} = {}) {
  return async function GET(request) {
    const query = parseProfileQuery(new URL(request.url).searchParams);
    if (!query) {
      return Response.json(
        { error: "Provide film=<tmdbId>, series=<tmdbId> or id=<uuid>" },
        { status: 400 },
      );
    }

    const store = createStore(env);
    let work = null;
    let ratings = [];
    let places = [];
    let classified = [];
    let placeFrames = [];

    if (store) {
      try {
        work = await store.loadWork(query);
        if (work) {
          [ratings, places, classified, placeFrames] = await Promise.all([
            store.loadRatings(work.id),
            store.loadPlaces(work.id),
            store.loadClassifiedImages(work.id),
            store.loadPlaceFrames(work.id),
          ]);
        }
      } catch (error) {
        // A profile without our own data is thin but still useful; failing the whole
        // page because one join broke would be worse than showing the stills.
        logError("work: graph load failed", error);
      }
    }

    // Addressed by uuid, the kind and TMDB id are only known once the row is loaded.
    const stillsKey = {
      kind: query.kind ?? work?.kind ?? null,
      tmdbId: query.tmdbId ?? work?.tmdb_id ?? null,
    };
    // The switch is "has this gallery been looked at", NOT "did we find frames". A
    // film judged to be entirely promotional shows nothing — falling back there would
    // display the exact art the classifier just rejected and quietly undo the check we
    // paid for. Only a film nobody has judged falls back to the raw list.
    const verified = classified.filter((row) => row.is_frame);
    const stills = classified.length > 0
      ? verified
        .map((row) => ({
          url: tmdbImageUrl(row.file_path, "w780"),
          full: tmdbImageUrl(row.file_path, "original"),
          width: row.width ?? null,
          height: row.height ?? null,
        }))
        .filter((still) => still.url)
        .slice(0, MAX_PROFILE_STILLS)
      : stillsKey.tmdbId
        ? await stillsFromTmdb(stillsKey, { env, fetchImpl, timeoutMs, logError })
        : [];

    // The caption has to match which of those two happened.
    const stillsVerified = classified.length > 0;
    // A matched frame belongs to its place, not to the gallery: this is the one
    // context where a frame IS a claim about where something happened.
    const frameByPlace = new Map(placeFrames.map((row) => [row.place_id, row]));
    const summarised = profilePlaces(places).map((place) => {
      const frame = frameByPlace.get(place.id);
      return frame
        ? {
          ...place,
          scene_frame: {
            url: tmdbImageUrl(frame.file_path, "w780"),
            full: tmdbImageUrl(frame.file_path, "original"),
            evidence: frame.evidence,
          },
        }
        : place;
    });

    return Response.json({
      work: {
        title: work?.title ?? null,
        kind: stillsKey.kind,
        year: work?.year ?? null,
        tmdb_id: stillsKey.tmdbId,
        imdb_id: work?.imdb_id ?? null,
        wikidata_id: work?.wikidata_id ?? null,
        poster: posterUrl(work?.poster_path, POSTER_SIZES.card),
        in_graph: Boolean(work),
      },
      links: sourceLinks({ ...work, kind: stillsKey.kind, tmdb_id: stillsKey.tmdbId }),
      ratings: profileRatings(ratings),
      places: summarised,
      tally: placeTally(summarised),
      stills,
      stills_verified: stillsVerified,
      // The caption states exactly which of the two cases this is. Promising verified
      // frames when nothing has looked at them would be the same class of mistake as
      // pinning an unmatched frame to a street.
      stills_note: stillsVerified
        ? "Frames from the film, checked one by one. Not matched to any location."
        : "From the film's image gallery — includes promotional art. Not matched to any location.",
    }, { headers: cacheHeaders });
  };
}

export const GET = createWorkProfileHandler();
