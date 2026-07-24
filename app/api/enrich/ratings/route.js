import { createClient } from "@supabase/supabase-js";

import { buildWikidataEntitiesUrl, isWikidataId } from "../../../lib/location-search.mjs";
import { externalIdsFromEntity } from "../../../lib/work-artwork.mjs";
import { ratingRows, ratingsFromOmdb } from "../../../lib/work-ratings.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)";
const OMDB_BASE_URL = "https://www.omdbapi.com/";
const MAX_WORKS = 40;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// The graph is public-read, so a dry run needs no privileged key.
async function loadWorksAnon(env, fetchImpl, limit) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured");

  const endpoint = new URL(`${url}/rest/v1/works`);
  endpoint.searchParams.set("select", "id,kind,title,wikidata_id,imdb_id,rt_path,mc_path");
  endpoint.searchParams.set("kind", "in.(film,series)"); // OMDb has no books
  endpoint.searchParams.set("limit", String(limit));

  const response = await fetchImpl(endpoint, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`works read failed with ${response.status}`);
  return response.json();
}

function defaultCreateWriter(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async loadWorks(limit) {
      const { data, error } = await client
        .from("works")
        .select("id, kind, title, wikidata_id, imdb_id, rt_path, mc_path")
        .in("kind", ["film", "series"])
        .limit(limit);
      if (error) throw new Error(`works load failed: ${error.message}`);
      return data ?? [];
    },
    async saveIdentifiers(rows) {
      for (const row of rows) {
        const { error } = await client
          .from("works")
          .update({ imdb_id: row.imdb_id, rt_path: row.rt_path, mc_path: row.mc_path })
          .eq("id", row.id);
        if (error) throw new Error(`identifier update failed: ${error.message}`);
      }
    },
    async saveRatings(rows) {
      if (rows.length === 0) return 0;
      // Re-running refreshes the score in place rather than piling up history.
      const { error } = await client
        .from("work_ratings")
        .upsert(rows.map((row) => ({ ...row, retrieved_at: new Date().toISOString() })),
          { onConflict: "work_id, source" });
      if (error) throw new Error(`ratings upsert failed: ${error.message}`);
      return rows.length;
    },
  };
}

// POST /api/enrich/ratings — IMDb / Rotten Tomatoes / Metacritic scores for films and
// series, with a link back to each source.
//
// Chain: work.wikidata_id → P345 (imdb id) + P1258 (RT path) → OMDb → ratings.
// OMDb is a licensed aggregator; nothing here scrapes IMDb or Rotten Tomatoes, whose
// terms forbid it. Books are skipped — OMDb has no entry for them (issue #110 tracks
// Open Library for those).
export function createRatingsEnrichHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  createWriter,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeWriter = createWriter ?? (() => defaultCreateWriter(env));

  return async function POST(request) {
    const omdbKey = env.OMDB_API_KEY;
    if (!omdbKey) return jsonError("OMDb is not configured", 503);

    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const writer = makeWriter(env);
    if (!writer && !dryRun) return jsonError("Enrichment is not configured", 503);

    try {
      const works = writer
        ? await writer.loadWorks(MAX_WORKS)
        : await loadWorksAnon(env, fetchImpl, MAX_WORKS);

      // One batched Wikidata call for whatever identifiers are still missing.
      const needIds = works.filter(
        (work) => isWikidataId(work.wikidata_id) && (!work.imdb_id || !work.rt_path || !work.mc_path),
      );
      const learned = [];
      if (needIds.length > 0) {
        const entitiesUrl = buildWikidataEntitiesUrl(needIds.map((work) => work.wikidata_id));
        const response = await fetchImpl(entitiesUrl, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) throw new Error(`Wikidata responded with ${response.status}`);
        const payload = await response.json();
        for (const work of needIds) {
          const ids = externalIdsFromEntity(payload?.entities?.[work.wikidata_id]);
          work.imdb_id = work.imdb_id ?? ids.imdb_id;
          work.rt_path = work.rt_path ?? ids.rt_path;
          work.mc_path = work.mc_path ?? ids.mc_path;
          if (ids.imdb_id || ids.rt_path || ids.mc_path) {
            learned.push({
              id: work.id, imdb_id: work.imdb_id, rt_path: work.rt_path, mc_path: work.mc_path,
            });
          }
        }
      }

      const allRatings = [];
      const perWork = [];
      for (const work of works) {
        if (!work.imdb_id) continue; // no imdb id — OMDb has nothing to look up
        const endpoint = new URL(OMDB_BASE_URL);
        endpoint.searchParams.set("i", work.imdb_id);
        endpoint.searchParams.set("apikey", omdbKey);

        const response = await fetchImpl(endpoint, {
          headers: { Accept: "application/json" },
          signal: request.signal,
          next: { revalidate: 86400 },
        });
        if (!response.ok) continue; // one failure must not sink the pass

        const rows = ratingRows(work.id, ratingsFromOmdb(await response.json(), {
          imdbId: work.imdb_id,
          rtPath: work.rt_path,
          mcPath: work.mc_path,
        }));
        if (rows.length === 0) continue;
        allRatings.push(...rows);
        perWork.push({ title: work.title, ratings: rows.map((r) => `${r.source} ${r.display}`) });
      }

      if (dryRun) {
        return Response.json(
          { dry_run: true, checked: works.length, rated: perWork.length, ratings: allRatings, perWork },
          { headers: noStoreHeaders },
        );
      }

      if (learned.length > 0) await writer.saveIdentifiers(learned);
      const saved = await writer.saveRatings(allRatings);

      return Response.json(
        { checked: works.length, rated: perWork.length, ratings_saved: saved },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Ratings enrichment failed", { message: error?.message });
      return jsonError("Could not enrich ratings", 502);
    }
  };
}

export const POST = createRatingsEnrichHandler();
