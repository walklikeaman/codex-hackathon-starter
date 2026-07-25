import { createClient } from "@supabase/supabase-js";

import { graphFailureReason } from "../map/points/route.js";
import { clampProgress, progressSummary, shapeScenes } from "../../lib/spoiler-safety.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async scenes({ workId, progress }) {
      // The RPC is what enforces the hiding: unreached scenes come back stripped of
      // their chapter, beat and coordinates before they ever leave the database.
      const { data, error } = await client.rpc("work_scenes", {
        p_work_id: workId,
        p_progress: progress,
      });
      if (error) throw new Error(`work_scenes failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// GET /api/scenes?workId=<uuid>&progress=<chapter or episode reached>
//
// Scenes of a work, revealed only up to the reader's progress. `progress` defaults to
// the SAFE floor, so a caller who forgets it gets the spoiler-free view rather than
// the whole plot — the safe state is the default, not an option.
export function createScenesHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const workId = params.get("workId");
    if (!workId || !UUID.test(workId)) {
      return Response.json(
        { error: "workId must be a uuid" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const progress = clampProgress(params.get("progress"));

    const reader = makeReader(env);
    if (!reader) {
      return Response.json(
        { error: "Scenes are not configured" },
        { status: 503, headers: noStoreHeaders },
      );
    }

    try {
      const scenes = shapeScenes(await reader.scenes({ workId, progress }), progress);
      return Response.json(
        { progress, scenes, summary: progressSummary(scenes) },
        // Private: the response depends on how far THIS reader has got, so a shared
        // cache must never hand one reader's revealed scenes to another.
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Scenes request failed", { message: error?.message });
      return Response.json(
        { error: "Could not load scenes", reason: graphFailureReason(error) },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createScenesHandler();
