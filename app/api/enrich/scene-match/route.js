// Match verified frames to the real places they were shot at (#57 tier A).
//
// Runs AFTER /api/enrich/stills, and only on what that left behind: promotional art
// never reaches this stage, so the model is choosing among real frames instead of
// being asked whether a gun-barrel poster shows Trafalgar Square.
//
// One call per PLACE, showing every candidate frame at once. Asking per pair invites a
// model to agree with each one separately; asking it to choose forces a comparison —
// and lets it choose nothing, which is the expected answer for most places.

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createClient } from "@supabase/supabase-js";

import {
  buildMatchContent,
  isMatchablePlace,
  matchInstructions,
  matchRow,
  sceneFrameMatchSchema,
} from "../../../lib/scene-frame-match.mjs";
import { buildWikidataEntitiesUrl, entityClaimValues } from "../../../lib/location-search.mjs";
import { tmdbImageUrl } from "../../../lib/tmdb-images.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// This is the expensive stage — one model call per place — so the batch is small and
// there is no deadline. Coverage grows over runs.
export const DEFAULT_PLACE_LIMIT = 12;
export const MAX_PLACE_LIMIT = 40;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// Commons serves a thumbnail straight from the file name, no API call needed.
export function commonsThumbUrl(filename, width = 800) {
  if (typeof filename !== "string" || !filename.trim()) return null;
  const encoded = encodeURIComponent(filename.trim().replace(/ /g, "_"));
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    // Places worth asking about: linked to a work that HAS verified frames, precise
    // enough for the question to mean something, and not already answered.
    async pendingPairs(limit) {
      const { data, error } = await client
        .from("work_place_links")
        .select(`work_id, relation_kind,
                 works!inner ( id, title, kind, tmdb_id ),
                 places!inner ( id, name, place_class, geocode_precision,
                                wikidata_id, osm_building_id )`)
        .limit(600);
      if (error) throw new Error(`pairs load failed: ${error.message}`);

      const [{ data: frames }, { data: done }] = await Promise.all([
        client.from("work_images").select("work_id, file_path, is_frame").eq("is_frame", true),
        client.from("place_frames").select("work_id, place_id"),
      ]);

      const framesByWork = new Map();
      for (const row of frames ?? []) {
        if (!framesByWork.has(row.work_id)) framesByWork.set(row.work_id, []);
        framesByWork.get(row.work_id).push({ file_path: row.file_path });
      }
      const answered = new Set((done ?? []).map((row) => `${row.work_id}:${row.place_id}`));

      return (data ?? [])
        .map((row) => ({
          work: row.works,
          place: { ...row.places, relation_kind: row.relation_kind },
          frames: framesByWork.get(row.work_id) ?? [],
        }))
        .filter((pair) => pair.frames.length > 0)
        .filter((pair) => isMatchablePlace(pair.place))
        .filter((pair) => !answered.has(`${pair.work.id}:${pair.place.id}`))
        .slice(0, limit);
    },
    async saveMatch(row) {
      const { error } = await client
        .from("place_frames")
        .upsert(row, { onConflict: "work_id,place_id" });
      if (error) throw new Error(`match save failed: ${error.message}`);
    },
  };
}

// The place's own photograph, from Wikidata P18. Without it the model would be judging
// a name, which is exactly the failure mode this whole stage exists to avoid.
async function referenceImageFor(place, { fetchImpl }) {
  try {
    const response = await fetchImpl(buildWikidataEntitiesUrl([place.wikidata_id]), {
      headers: { Accept: "application/json", "User-Agent": "GloryMap/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    const entity = payload?.entities?.[place.wikidata_id];
    return commonsThumbUrl(entityClaimValues(entity, "P18")[0]);
  } catch {
    return null;
  }
}

export function createSceneMatchHandler({
  env = process.env,
  createStore = defaultCreateStore,
  createOpenAIClient = (apiKey) => new OpenAI({ apiKey }),
  fetchImpl = fetch,
  logError = console.error,
} = {}) {
  return async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (!env.OPENAI_API_KEY) return jsonError("Vision is not configured.", 503);
    const store = createStore(env);
    if (!store) return jsonError("Storage is not configured.", 503);

    const limit = Math.min(
      Number.parseInt(body?.limit, 10) || DEFAULT_PLACE_LIMIT,
      MAX_PLACE_LIMIT,
    );

    let pairs;
    try {
      pairs = await store.pendingPairs(limit);
    } catch (error) {
      logError("scene-match: load failed", error);
      return jsonError("Could not load places.", 502);
    }

    if (pairs.length === 0) {
      return Response.json({ matched: 0, checked: 0, results: [] }, { headers: noStoreHeaders });
    }

    const openai = createOpenAIClient(env.OPENAI_API_KEY);
    const results = [];

    for (const pair of pairs) {
      const reference = await referenceImageFor(pair.place, { fetchImpl });
      if (!reference) {
        // No photograph of the place means no basis for a visual claim. Skipped, not
        // guessed — and not stored, so it can be retried when Wikidata gains an image.
        results.push({ place: pair.place.name, work: pair.work.title, reason: "no_reference_photo" });
        continue;
      }

      let parsed;
      try {
        const response = await openai.responses.parse({
          model: env.OPENAI_VISION_MODEL || "gpt-5-nano",
          store: false,
          max_output_tokens: 3000,
          reasoning: { effort: "low" },
          instructions: matchInstructions(),
          input: [{
            role: "user",
            content: buildMatchContent({
              placeName: pair.place.name,
              referenceImageUrl: reference,
              frameUrls: pair.frames.map((frame) => tmdbImageUrl(frame.file_path, "w780")),
            }),
          }],
          text: { format: zodTextFormat(sceneFrameMatchSchema, "scene_frame_match") },
        }, { timeout: 60_000 });

        if (response.status !== "completed" || !response.output_parsed) {
          throw new Error(`vision responded ${response.status}`);
        }
        parsed = response.output_parsed;
      } catch (error) {
        logError(`scene-match: vision failed for ${pair.place.id}`, error);
        results.push({ place: pair.place.name, work: pair.work.title, reason: "vision_failed" });
        continue;
      }

      const row = matchRow({
        workId: pair.work.id, placeId: pair.place.id, frames: pair.frames, result: parsed,
      });
      if (!row) {
        // "No frame shows this place" is the expected outcome and a perfectly good
        // answer. It is not stored: a later run with more frames may find one.
        results.push({ place: pair.place.name, work: pair.work.title, reason: "no_match" });
        continue;
      }

      try {
        await store.saveMatch(row);
      } catch (error) {
        logError(`scene-match: save failed for ${pair.place.id}`, error);
        results.push({ place: pair.place.name, work: pair.work.title, reason: "save_failed" });
        continue;
      }

      results.push({
        place: pair.place.name,
        work: pair.work.title,
        matched: true,
        file_path: row.file_path,
        evidence: row.evidence,
      });
    }

    return Response.json(
      { checked: pairs.length, matched: results.filter((row) => row.matched).length, results },
      { headers: noStoreHeaders },
    );
  };
}

export const POST = createSceneMatchHandler();
