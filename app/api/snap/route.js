// Snap places onto their OSM building footprints (#45).
//
// Overpass is a free service run on donated hardware and it rate-limits hard — live
// testing got a 429 on the request immediately following a successful one. So this
// route is deliberately unglamorous: a small batch, one request at a time with a
// pause between them, and a stored result so no place is ever asked about twice.
//
// The snap itself is persisted on the place row, which IS the cache: `osm_building_id`
// being set means this place has been resolved and will not be queried again.

import { createClient } from "@supabase/supabase-js";

import { MAX_SEARCH_RADIUS_M, resolveBuildingSnap } from "../../lib/building-snap.mjs";

export const runtime = "nodejs";
// Overpass calls are paced, so a batch takes real time.
export const maxDuration = 300;

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Small on purpose. Overpass fair use asks for modest, paced querying, and there is no
// deadline here — places get snapped over many runs rather than in one burst.
export const DEFAULT_BATCH = 5;
export const MAX_BATCH = 25;
export const PAUSE_BETWEEN_CALLS_MS = 1500;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultCreateStore(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    // Places worth trying: already located, not yet snapped, and not already known to
    // building precision. Vaguer places come first — they gain the most.
    async unsnapped(limit) {
      const { data, error } = await client
        .from("places")
        .select("id, name, lat, lng, geocode_precision")
        .is("osm_building_id", null)
        .not("lat", "is", null)
        .neq("geocode_precision", "building")
        .limit(limit);
      if (error) throw new Error(`places load failed: ${error.message}`);
      return data ?? [];
    },
    async loadPlace(placeId) {
      const { data, error } = await client
        .from("places")
        .select("id, name, lat, lng, geocode_precision")
        .eq("id", placeId)
        .maybeSingle();
      if (error) throw new Error(`place load failed: ${error.message}`);
      return data;
    },
    // The original coordinate is written into pre_snap_* in the same statement that
    // overwrites lat/lng, so the move can always be undone and always be shown.
    async saveSnap(place, snap) {
      const { error } = await client
        .from("places")
        .update({
          lat: snap.lat,
          lng: snap.lng,
          geocode_precision: snap.geocode_precision ?? place.geocode_precision,
          osm_building_id: snap.osm_building_id,
          footprint: snap.footprint,
          pre_snap_lat: place.lat,
          pre_snap_lng: place.lng,
          snapped_at: new Date().toISOString(),
        })
        .eq("id", place.id);
      if (error) throw new Error(`snap save failed: ${error.message}`);
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clampBatch(value) {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_BATCH;
  return Math.min(size, MAX_BATCH);
}

export function createSnapHandler({
  env = process.env,
  createStore = defaultCreateStore,
  resolveSnap = resolveBuildingSnap,
  pauseMs = PAUSE_BETWEEN_CALLS_MS,
  wait = sleep,
  logError = console.error,
} = {}) {
  return async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const store = createStore(env);
    if (!store) return jsonError("Place storage is not configured.", 503);

    const radiusM = Number.isFinite(body?.radius_m)
      ? Math.min(body.radius_m, MAX_SEARCH_RADIUS_M)
      : undefined;

    let places;
    try {
      places = body?.place_id
        ? [await store.loadPlace(body.place_id)].filter(Boolean)
        : await store.unsnapped(clampBatch(body?.limit));
    } catch (error) {
      logError("snap: load failed", error);
      return jsonError("Could not load places.", 502);
    }

    if (places.length === 0) {
      return Response.json({ snapped: 0, checked: 0, results: [] }, { headers: noStoreHeaders });
    }

    const results = [];
    for (const [index, place] of places.entries()) {
      // Serial, with a pause: parallel Overpass calls are exactly what gets a client
      // blocked, and there is nothing here worth being blocked for.
      if (index > 0) await wait(pauseMs);

      let snap;
      try {
        snap = await resolveSnap({ lat: place.lat, lng: place.lng, radiusM });
      } catch (error) {
        logError(`snap: overpass failed for ${place.id}`, error);
        results.push({ place_id: place.id, name: place.name, snapped: false, reason: "overpass_failed" });
        continue;
      }

      if (!snap.snapped) {
        // Nothing is written. A place that could not be resolved today stays in the
        // queue for a later run — Overpass being busy is not a verdict about the place.
        results.push({ place_id: place.id, name: place.name, snapped: false, reason: snap.reason });
        continue;
      }

      try {
        await store.saveSnap(place, snap);
      } catch (error) {
        logError(`snap: save failed for ${place.id}`, error);
        results.push({ place_id: place.id, name: place.name, snapped: false, reason: "save_failed" });
        continue;
      }

      results.push({
        place_id: place.id,
        name: place.name,
        snapped: true,
        reason: snap.reason,
        via: snap.via,
        moved_m: snap.moved_m,
        osm_building_id: snap.osm_building_id,
        building_name: snap.building_name,
        was: place.geocode_precision,
        now: snap.geocode_precision,
      });
    }

    return Response.json(
      { checked: places.length, snapped: results.filter((r) => r.snapped).length, results },
      { headers: noStoreHeaders },
    );
  };
}

export const POST = createSnapHandler();
