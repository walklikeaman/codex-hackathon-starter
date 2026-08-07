import { createClient } from "@supabase/supabase-js";

import { crosswalkWikidataIds } from "../../lib/connectors/wikidata-crosswalk.mjs";
import {
  linkKeyOf,
  missingEvidenceRows,
  resolveWorkPlaces,
} from "../../lib/location-resolver.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const MAX_WORK_IDS = 20; // one batch ≈ a handful of Wikidata round-trips
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultResolveUserId(env) {
  return async (request) => {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anonKey) return null;

    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error) return null;
    return data?.user?.id ?? null;
  };
}

// Service-role writer: the content graph is shared and public-read/service-write.
function defaultCreateWriter(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const failOn = (error, what) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };

  return {
    async loadWorks(ids) {
      const { data, error } = await client
        .from("works")
        .select("id, kind, title, wikidata_id, tmdb_id, imdb_id, isbn, mbid")
        .in("id", ids);
      failOn(error, "works load");
      return data ?? [];
    },
    async upsertPlaces(rows) {
      const { data, error } = await client
        .from("places")
        .upsert(rows, { onConflict: "wikidata_id" })
        .select("id, wikidata_id");
      failOn(error, "places upsert");
      return data ?? [];
    },
    // The conflict target must name every column of a unique index, and since
    // 20260808010100 that index is (work_id, place_id, relation_kind, scene_id, about).
    //
    // The three-column form this used to send has been raising 42P10 — "there is no
    // unique or exclusion constraint matching the ON CONFLICT specification" — since
    // 20260731234121 split the constraint into two PARTIAL indexes, which Postgres
    // cannot infer from a bare inference clause. This route is the only write path into
    // the canonical graph, and it failed here, after the Wikidata work had succeeded.
    async upsertLinks(rows) {
      const { data, error } = await client
        .from("work_place_links")
        .upsert(rows, { onConflict: "work_id,place_id,relation_kind,scene_id,about" })
        .select("id, work_id, place_id, relation_kind");
      failOn(error, "links upsert");
      return data ?? [];
    },
    // Chunked: `in()` becomes a GET query string, and a full batch's subject ids
    // would overflow the URL and fail *after* places and links were already written.
    async loadEvidence(subjectIds) {
      const rows = [];
      for (let i = 0; i < subjectIds.length; i += 100) {
        const { data, error } = await client
          .from("place_evidence")
          .select("subject_type, subject_id, method, source_ref")
          .in("subject_id", subjectIds.slice(i, i + 100));
        failOn(error, "evidence load");
        rows.push(...(data ?? []));
      }
      return rows;
    },
    async insertEvidence(rows) {
      const { error } = await client.from("place_evidence").insert(rows);
      failOn(error, "evidence insert");
    },
  };
}

function parseWorkIds(body) {
  const ids = body?.work_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_WORK_IDS) return null;
  const unique = [...new Set(ids)];
  return unique.every((id) => typeof id === "string" && UUID.test(id)) ? unique : null;
}

// POST /api/resolve — run the Location Resolution Engine (Stage 0 + 1) over a batch
// of works and write-through to places / work_place_links / place_evidence.
// Re-running is safe: places and links upsert on their unique keys, and evidence is
// inserted only where its deterministic identity is not already stored.
export function createResolveHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  resolveUserId,
  createWriter,
  resolvePlaces = resolveWorkPlaces,
  crosswalk = (works, options) => crosswalkWikidataIds(works, options),
  logError = (...args) => console.error(...args),
} = {}) {
  const resolveUser = resolveUserId ?? defaultResolveUserId(env);
  const makeWriter = createWriter ?? (() => defaultCreateWriter(env));

  return async function POST(request) {
    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const workIds = parseWorkIds(body);
    if (!workIds) {
      return jsonError(`Provide 1..${MAX_WORK_IDS} work ids`, 400);
    }

    const userId = await resolveUser(request);
    if (!userId) return jsonError("Sign in to resolve locations", 401);

    const writer = makeWriter(env);
    if (!writer) return jsonError("Resolve is not configured", 503);

    try {
      const works = await writer.loadWorks(workIds);
      if (works.length === 0) {
        return Response.json(
          { resolved: [], skipped: [], places_upserted: 0, links_upserted: 0, evidence_inserted: 0 },
          { headers: noStoreHeaders },
        );
      }

      const { plan } = await resolvePlaces(works, { fetchImpl, crosswalk, signal: request.signal });

      if (plan.places.length === 0) {
        return Response.json(
          {
            resolved: [],
            skipped: plan.skipped,
            flags: plan.flags,
            places_upserted: 0,
            links_upserted: 0,
            evidence_inserted: 0,
          },
          { headers: noStoreHeaders },
        );
      }

      // places → uuids, keyed by wikidata_id (the plan's place identity).
      const placeRows = await writer.upsertPlaces(plan.places);
      const placeIdByQid = new Map(placeRows.map((row) => [row.wikidata_id, row.id]));
      const qidByPlaceId = new Map(placeRows.map((row) => [row.id, row.wikidata_id]));

      const linkRowsToWrite = plan.links
        .map((link) => {
          const placeId = placeIdByQid.get(link.place_wikidata_id);
          if (!placeId) return null;
          return {
            work_id: link.workKey,
            place_id: placeId,
            relation_kind: link.relation_kind,
            confidence: link.confidence,
            // Written out rather than left to the column defaults, because these two are
            // the conflict target: a row that omits them is a row whose identity is
            // implied somewhere else.
            //
            // `about` is null and `statement` is not written at all: a P915 statement
            // says a work and a place are related and nothing more. The sentence belongs
            // to sources that state one — a plaque, a paragraph, a permit record.
            scene_id: null,
            about: null,
          };
        })
        .filter(Boolean);

      const linkRows = linkRowsToWrite.length > 0 ? await writer.upsertLinks(linkRowsToWrite) : [];
      // Rebuild each link's plan-side key so its evidence can find its uuid.
      const linkIdByKey = new Map(
        linkRows.map((row) => [
          linkKeyOf({
            workKey: row.work_id,
            placeWikidataId: qidByPlaceId.get(row.place_id),
            relationKind: row.relation_kind,
          }),
          row.id,
        ]),
      );

      // Resolve every evidence row's subject to a real uuid, dropping any whose
      // subject was not written (never write dangling evidence).
      const evidenceWithIds = plan.evidence
        .map((row) => {
          const subjectId = row.subject_type === "place"
            ? placeIdByQid.get(row.subject_ref)
            : linkIdByKey.get(row.subject_ref);
          if (!subjectId) return null;
          const { subject_ref: _ref, ...rest } = row;
          return { ...rest, subject_id: subjectId };
        })
        .filter(Boolean);

      const subjectIds = [...new Set(evidenceWithIds.map((row) => row.subject_id))];
      const existing = subjectIds.length > 0 ? await writer.loadEvidence(subjectIds) : [];
      const toInsert = missingEvidenceRows(evidenceWithIds, existing);
      if (toInsert.length > 0) await writer.insertEvidence(toInsert);

      // Group the response by work so the caller sees what each one produced.
      const placeByQid = new Map(plan.places.map((place) => [place.wikidata_id, place]));
      const byWork = new Map();
      for (const link of plan.links) {
        const place = placeByQid.get(link.place_wikidata_id);
        if (!place) continue;
        const bucket = byWork.get(link.workKey) ?? [];
        bucket.push(place);
        byWork.set(link.workKey, bucket);
      }

      return Response.json(
        {
          resolved: [...byWork].map(([work_id, places]) => ({ work_id, places })),
          skipped: plan.skipped,
          flags: plan.flags,
          places_upserted: placeRows.length,
          links_upserted: linkRows.length,
          evidence_inserted: toInsert.length,
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Location resolve failed", { message: error?.message });
      return jsonError("Could not resolve locations", 502);
    }
  };
}

export const POST = createResolveHandler();
