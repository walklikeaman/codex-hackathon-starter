import { createClient } from "@supabase/supabase-js";

import {
  buildMapResponse,
  CLUSTER_BELOW_ZOOM,
  MAX_MAP_POINTS,
  parseMapQuery,
} from "../../../lib/map-points.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// Classify a graph failure for the response. Deliberately coarse — enough to point an
// operator at the cause (credentials vs schema vs upstream), never enough to expose
// the key, the SQL, or row data.
export function graphFailureReason(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("api key") || message.includes("jwt") || message.includes("unauthorized")) {
    return "graph_auth_rejected";
  }
  if (message.includes("could not find") || message.includes("does not exist") || message.includes("schema cache")) {
    return "graph_schema_mismatch";
  }
  return "graph_query_failed";
}

// Public read: the content graph is public-read under RLS, so the anon key is enough
// and no user session is required to look at the map.
function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const call = async (fn, params) => {
    const { data, error } = await client.rpc(fn, params);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data ?? [];
  };

  return {
    points: (params) => call("map_points_in_view", params),
    clusters: (params) => call("map_clusters_in_view", params),
    fictional: ({ workId, kinds }) =>
      call("fictional_places", { p_work_id: workId ?? null, p_kinds: kinds ?? null }),
  };
}

// GET /api/map/points?west&south&east&north&z&workId&kinds
// The map's read path: it serves the persistent graph, not a live SPARQL query, so a
// viewport costs one indexed query. Zoomed out it returns grid clusters; zoomed in,
// individual places carrying their grounding fields (place_class, confidence,
// precision, shot_on_set) so the UI can be honest about what each pin is.
export function createMapPointsHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const query = parseMapQuery(new URL(request.url).searchParams);
    if (query.error) return jsonError(query.error, 400);

    const reader = makeReader(env);
    if (!reader) return jsonError("Map graph is not configured", 503);

    const params = {
      p_west: query.west,
      p_south: query.south,
      p_east: query.east,
      p_north: query.north,
      p_zoom: query.zoom,
      p_work_id: query.workId,
      p_kinds: query.kinds,
    };

    try {
      const [rows, fictional] = await Promise.all([
        query.clustered
          ? reader.clusters({ ...params, p_max_clusters: MAX_MAP_POINTS })
          : reader.points({ ...params, p_max_points: MAX_MAP_POINTS, p_cluster_below_zoom: CLUSTER_BELOW_ZOOM }),
        // Same work/kind filters as the map, so the strip always describes the same query.
        reader.fictional({ workId: query.workId, kinds: query.kinds }),
      ]);

      return Response.json(buildMapResponse(query, rows, fictional), {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    } catch (error) {
      logError("Map points request failed", { message: error?.message });
      // A bare "could not load" is undiagnosable in a deployed environment: a wrong
      // anon key, a missing grant and a real outage all look identical. The reason
      // code names the class of failure without leaking the key or the SQL.
      return Response.json(
        { error: "Could not load map points", reason: graphFailureReason(error) },
        { status: 502, headers: noStoreHeaders },
      );
    }
  };
}

export const GET = createMapPointsHandler();
