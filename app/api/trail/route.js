import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createClient } from "@supabase/supabase-js";

import {
  normalizeTrail,
  normalizeTrailPlace,
  storyTrailInstructions,
  storyTrailSchema,
} from "../../lib/story-trail.mjs";
import { enrichGuard } from "../../lib/enrich-auth.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async loadWork(workId) {
      const { data, error } = await client
        .from("works")
        .select("id, title, kind, year")
        .eq("id", workId)
        .maybeSingle();
      if (error) throw new Error(`work load failed: ${error.message}`);
      return data;
    },
    // The places we already hold for this work. Handed to the model so it picks a
    // known place rather than naming one the story uses ("Notting Hill Bookshop"),
    // which is right for a story and unmappable for us.
    async workPlaces(workId) {
      const { data, error } = await client
        .from("work_place_links")
        .select("place_id, places ( id, name, lat, lng )")
        .eq("work_id", workId)
        .is("scene_id", null);
      if (error) throw new Error(`work places load failed: ${error.message}`);
      return (data ?? [])
        .map((row) => row.places)
        .filter((place) => place && place.lat !== null && place.lng !== null);
    },
    // The scene→place edge. `work_place_links.scene_id` is where this belongs —
    // the schema already modelled it, and the spoiler-safe RPC already reads it.
    async linkScenes(workId, links) {
      if (links.length === 0) return 0;
      const { error } = await client.from("work_place_links").insert(
        links.map((link) => ({
          work_id: workId,
          place_id: link.place_id,
          scene_id: link.scene_id,
          relation_kind: "narrative_location",
          narrative_order: link.sequence_index,
        })),
      );
      if (error) throw new Error(`scene link insert failed: ${error.message}`);
      return links.length;
    },
    // The cache IS the scenes table: if a work already has a trail, there is nothing
    // to extract and no model call to pay for.
    async existingScenes(workId) {
      const { data, error } = await client
        .from("scenes")
        .select("id, sequence_index, act_or_chapter, plot_beat, safe_teaser, spoiler_tier, is_fictional_setting")
        .eq("work_id", workId)
        .order("sequence_index", { ascending: true });
      if (error) throw new Error(`scenes load failed: ${error.message}`);
      return data ?? [];
    },
    async saveScenes(workId, scenes) {
      const rows = scenes.map((scene) => ({
        work_id: workId,
        sequence_index: scene.sequence_index,
        act_or_chapter: scene.place_name,
        plot_beat: scene.plot_beat,
        safe_teaser: scene.safe_teaser,
        spoiler_tier: scene.spoiler_tier,
        is_fictional_setting: scene.is_fictional_setting,
      }));
      const { data, error } = await client.from("scenes").insert(rows).select("id, sequence_index");
      if (error) throw new Error(`scenes insert failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// POST /api/trail { work_id }
//
// Extract the ordered sequence of places a story visits, so the map can be walked in
// STORY order rather than by geographic convenience.
//
// The model proposes place NAMES; it is given no field for a coordinate, and the
// resolver turns names into points from sources afterwards. Extraction is cached in
// the scenes table — the story does not change, so a second request costs nothing.
export function createTrailHandler({
  env = process.env,
  createOpenAIClient = (apiKey) => new OpenAI({ apiKey }),
  createStore,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeStore = createStore ?? (() => defaultCreateStore(env));

  return async function POST(request) {
    // Before anything is read, parsed, or paid for.
    const refusal = enrichGuard(request, env);
    if (refusal) return refusal;

    const body = await request.json().catch(() => null);
    const workId = body?.work_id;
    if (!workId || !UUID.test(workId)) return jsonError("Provide a work_id", 400);

    const store = makeStore(env);
    if (!store) return jsonError("Trail extraction is not configured", 503);

    try {
      const cached = await store.existingScenes(workId);
      if (cached.length > 0) {
        return Response.json(
          { work_id: workId, cached: true, scenes: cached },
          { headers: noStoreHeaders },
        );
      }

      const work = await store.loadWork(workId);
      if (!work) return jsonError("No such work", 404);
      if (!env.OPENAI_API_KEY) return jsonError("The OpenAI API key is not configured.", 503);

      // The list the model must choose from. Loaded before the call, because grounding
      // the extraction beats trying to match free-text place names afterwards.
      const knownPlaces = await store.workPlaces(workId);

      const openai = createOpenAIClient(env.OPENAI_API_KEY);
      const response = await openai.responses.parse({
        model: env.OPENAI_MODEL || "gpt-5.6-terra",
        store: false,
        max_output_tokens: 1600,
        reasoning: { effort: "low" },
        instructions: storyTrailInstructions(knownPlaces),
        input: [{
          role: "user",
          content: `Work: ${work.title}${work.year ? ` (${work.year})` : ""}. Kind: ${work.kind}.`,
        }],
        text: { format: zodTextFormat(storyTrailSchema, "story_trail") },
      });

      if (response.status !== "completed" || !response.output_parsed) {
        throw new Error("Trail extraction was incomplete or refused");
      }

      const scenes = normalizeTrail(response.output_parsed);
      if (scenes.length === 0) {
        // Nothing usable is an honest answer for a work whose story we cannot place;
        // it is not an error, and it must not be cached as if it were a trail.
        return Response.json(
          { work_id: workId, cached: false, scenes: [], reason: "no_extractable_trail" },
          { headers: noStoreHeaders },
        );
      }

      const saved = await store.saveScenes(workId, scenes);

      // Link the scenes the model tied to a place we hold. `known_place` is only ever
      // a KEY into our own list — a value that is not in it finds nothing and the
      // scene simply has no place, which is a normal outcome.
      const placeByKey = new Map(
        knownPlaces.map((place) => [normalizeTrailPlace(place.name), place.id]),
      );
      const sceneIdByIndex = new Map(saved.map((row) => [row.sequence_index, row.id]));
      const links = scenes
        .map((scene) => ({
          place_id: placeByKey.get(normalizeTrailPlace(scene.known_place)),
          scene_id: sceneIdByIndex.get(scene.sequence_index),
          sequence_index: scene.sequence_index,
        }))
        .filter((link) => link.place_id && link.scene_id);

      let linked = 0;
      try {
        linked = await store.linkScenes(workId, links);
      } catch (error) {
        // The scenes are saved and useful on their own; a failed link is a missing
        // pin, not a reason to lose the extraction.
        logError("trail: scene linking failed", error);
      }

      return Response.json(
        { work_id: workId, cached: false, extracted: saved.length, linked, scenes },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Trail extraction failed", { message: error?.message });
      return jsonError("Could not extract the story trail", 502);
    }
  };
}

export const POST = createTrailHandler();
