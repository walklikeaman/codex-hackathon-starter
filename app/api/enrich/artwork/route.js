import { createClient } from "@supabase/supabase-js";

import { buildWikidataEntitiesUrl } from "../../../lib/location-search.mjs";
import {
  artworkCandidates,
  artworkFromTmdb,
  artworkUpdates,
  tmdbIdFromEntity,
} from "../../../lib/work-artwork.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)";
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const MAX_WORKS = 60;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultCreateWriter(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async loadWorks(limit) {
      // Only what still needs artwork, so re-running is cheap and idempotent.
      const { data, error } = await client
        .from("works")
        .select("id, kind, title, wikidata_id, tmdb_id, poster_path")
        .is("poster_path", null)
        .limit(limit);
      if (error) throw new Error(`works load failed: ${error.message}`);
      return data ?? [];
    },
    async saveArtwork(rows) {
      let saved = 0;
      for (const row of rows) {
        const { error } = await client
          .from("works")
          .update({
            tmdb_id: row.tmdb_id,
            poster_path: row.poster_path,
            backdrop_path: row.backdrop_path,
            artwork_updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) throw new Error(`artwork update failed: ${error.message}`);
        saved += 1;
      }
      return saved;
    },
  };
}

// POST /api/enrich/artwork — fill in cover art for works that have none.
//
// Chain: work.wikidata_id → P4947 (film) / P4983 (series) → tmdb_id → poster_path.
// Posters are TMDB's, the licensed official source; nothing here scrapes IMDb.
// Only the path is stored — image.tmdb.org serves the file publicly with no key.
export function createArtworkEnrichHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  createWriter,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeWriter = createWriter ?? (() => defaultCreateWriter(env));

  return async function POST(request) {
    const tmdbToken = env.TMDB_API_READ_ACCESS_TOKEN;
    const tmdbKey = env.TMDB_API_KEY;
    if (!tmdbToken && !tmdbKey) return jsonError("TMDB is not configured", 503);

    const writer = makeWriter(env);
    if (!writer) return jsonError("Enrichment is not configured", 503);

    try {
      const works = await writer.loadWorks(MAX_WORKS);
      const candidates = artworkCandidates(works);
      if (candidates.length === 0) {
        return Response.json(
          { checked: works.length, enriched: 0, skipped: works.length },
          { headers: noStoreHeaders },
        );
      }

      // One batched Wikidata call for every work still missing its TMDB id.
      const needIds = candidates.filter((candidate) => !candidate.tmdbId);
      if (needIds.length > 0) {
        const entitiesUrl = buildWikidataEntitiesUrl(needIds.map((c) => c.wikidataId));
        const response = await fetchImpl(entitiesUrl, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) throw new Error(`Wikidata responded with ${response.status}`);
        const payload = await response.json();
        for (const candidate of needIds) {
          candidate.tmdbId = tmdbIdFromEntity(payload?.entities?.[candidate.wikidataId], candidate.kind);
        }
      }

      const results = [];
      for (const candidate of candidates) {
        if (!candidate.tmdbId) continue; // no TMDB entry — recorded by writing nothing
        const segment = candidate.kind === "series" ? "tv" : "movie";
        const endpoint = new URL(`${TMDB_API_BASE_URL}/${segment}/${candidate.tmdbId}`);
        if (tmdbKey) endpoint.searchParams.set("api_key", tmdbKey);

        const response = await fetchImpl(endpoint, {
          headers: tmdbToken
            ? { Accept: "application/json", Authorization: `Bearer ${tmdbToken}` }
            : { Accept: "application/json" },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) continue; // one missing title must not fail the whole pass

        results.push({
          workId: candidate.workId,
          tmdb_id: candidate.tmdbId,
          ...artworkFromTmdb(await response.json()),
        });
      }

      const updates = artworkUpdates(results);
      const saved = updates.length > 0 ? await writer.saveArtwork(updates) : 0;

      return Response.json(
        {
          checked: works.length,
          enriched: saved,
          with_poster: updates.filter((row) => row.poster_path).length,
          skipped: works.length - saved,
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Artwork enrichment failed", { message: error?.message });
      return jsonError("Could not enrich artwork", 502);
    }
  };
}

export const POST = createArtworkEnrichHandler();
