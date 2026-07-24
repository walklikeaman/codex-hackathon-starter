// Location Resolution Engine — Stage 0 (Wikidata canonical) + Stage 1 (P31
// classification). ARCHITECTURE.md §4, issue #93. This is the spine that turns an
// imported work into map-ready places, links and evidence.
//
// Stage 0 reads a work's location claims (P915 filming location for film/series,
// P840 narrative location for book) straight from the entity — NOT through
// normalizeWikidataLocations, which drops coordinate-less rows because it is built
// for the map. That drop would silently delete every fictional place; here fiction
// must survive as a row with lat/lng NULL and no false geocode.
//
// Stage 1 classifies each place by walking P31 → P279* upward (typeAncestry) to a
// small set of target types. Classification is never by name: isStudioLocation() is
// a name regex and is used ONLY as a QA flag, never to decide place_class.
//
// Pure by default (classifyPlace / buildResolutionPlan / missingEvidenceRows) with
// injectable fetch wrappers, same split as connectors/wikidata-crosswalk.mjs.
//
// Stages 2-4 (web_search, GeoCLIP, grounding) are NOT here and must not be baked in.
// They append evidence to the same ledger against the same subjects; confidence stays
// grounding.fuseConfidence, so nothing in this file changes when they land.

import { confidenceBand, fuseConfidence, hasValidCoordinate } from "./grounding.mjs";
import {
  buildWikidataEntitiesUrl,
  entityClaimIds,
  entityCoordinate,
  entityText,
  isWikidataId,
  typeAncestry,
  workKindConfig,
} from "./location-search.mjs";
import { isStudioLocation } from "./scene-image-match.mjs";

export const RESOLVER_VERSION = "wikidata-stage0.1";

const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)";

// Target types for Stage 1, every one verified live against Wikidata rather than
// taken from the spec — the spec's studio id (Q1107679) is "animation studio", which
// real studios are not tagged with.
//   fictional: Hogwarts / Gotham / Middle-earth / Winterfell / Tatooine all reach BOTH.
//   studio:    Pinewood, Shepperton, Cinecittà, Babelsberg are all P31 → Q375336.
//              Q21550789 is the separate "building/lot" sense (it does NOT reach
//              Q375336). Q1107679 (animation studio) is P279* → Q375336, so it needs
//              no target of its own.
export const PLACE_TYPE_TARGETS = Object.freeze({
  fictional: Object.freeze(["Q3895768", "Q14897293"]),
  studio: Object.freeze(["Q375336", "Q21550789"]),
  country: "Q6256",
  settlement: "Q486972",
});

const hasAny = (ancestry, ids) => ids.some((id) => ancestry.has(id));

// Coarse → fine. A place is only ever recorded at the COARSEST of what the source
// claims and what its type implies, so we never overstate how exactly we know a point.
const PRECISION_ORDER = ["none", "country", "city", "street", "building", "point"];
const coarser = (a, b) =>
  (PRECISION_ORDER.indexOf(a) <= PRECISION_ORDER.indexOf(b) ? a : b);

// Wikidata's own P625 precision, in degrees, bucketed into our enum. An absent
// precision means the source made no claim, so we fall back to the type-derived value.
function sourcePrecision(precisionDeg) {
  if (!Number.isFinite(precisionDeg)) return null;
  if (precisionDeg >= 1) return "country";
  if (precisionDeg >= 0.1) return "city";
  if (precisionDeg >= 0.01) return "street";
  return "point";
}

// Decide what a place IS from its type ancestry alone. Returns the place's classified
// fields; never invents a coordinate, and deliberately drops one for fiction.
export function classifyPlace({ ancestry, relationKind, coordinate, name } = {}) {
  const types = ancestry instanceof Set ? ancestry : new Set(ancestry ?? []);
  // hasValidCoordinate (not a bare isFinite) so an out-of-range value is refused here
  // rather than by the database CHECK, which would 502 the whole batch.
  const point = hasValidCoordinate(coordinate?.lat, coordinate?.lng) ? coordinate : null;
  // Name regex has zero authority over the classification — QA signal only.
  const nameHintsStudio = isStudioLocation(name ?? "");

  // 1. Fiction first, so a fictional studio is fiction rather than a studio. A P625
  //    on a fictional entity is discarded: we never pin a real point for a made-up place.
  if (hasAny(types, PLACE_TYPE_TARGETS.fictional)) {
    return {
      place_class: "fictional",
      shot_on_set: false,
      geocode_precision: "none",
      lat: null,
      lng: null,
      method: "wikidata_statement",
      name_hints_studio: nameHintsStudio,
    };
  }

  // 2. A studio is real and correctly located, but it depicts somewhere else —
  //    keep its own coordinates, mark shot_on_set, and use the discounted prior.
  if (hasAny(types, PLACE_TYPE_TARGETS.studio)) {
    return {
      place_class: "studio_interior",
      shot_on_set: true,
      geocode_precision: point
        ? coarser("building", sourcePrecision(point.precisionDeg) ?? "building")
        : "none",
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      method: "wikidata_studio_entity",
      name_hints_studio: nameHintsStudio,
    };
  }

  // 3. Real, but Wikidata has no coordinate — recorded honestly, kept off the map by
  //    grounding.isPublishable rather than by guessing a location.
  if (!point) {
    return {
      place_class: "unknown",
      shot_on_set: false,
      geocode_precision: "none",
      lat: null,
      lng: null,
      method: "wikidata_statement",
      name_hints_studio: nameHintsStudio,
    };
  }

  // 4. Real place with a coordinate. P915 carries no interior/exterior signal, so
  //    real_interior is never emitted here — it is reserved for Stage 4 vision_verify.
  // Start from what Wikidata itself claims, then let the type only ever coarsen it —
  // a country's centroid must never be recorded as a "point".
  let precision = sourcePrecision(point.precisionDeg) ?? "point";
  if (types.has(PLACE_TYPE_TARGETS.country)) precision = coarser("country", precision);
  else if (types.has(PLACE_TYPE_TARGETS.settlement)) precision = coarser("city", precision);

  return {
    place_class: relationKind === "narrative_location" ? "narrative_real" : "real_exterior",
    shot_on_set: false,
    geocode_precision: precision,
    lat: point.lat,
    lng: point.lng,
    method: "wikidata_statement",
    name_hints_studio: nameHintsStudio,
  };
}

// Precedence when two works classify one canonical place differently. Ordered by how
// much the class constrains the map: fiction (never pinned) wins outright so a place
// can never be downgraded INTO being pinned; a studio outranks a plain real place
// because shot_on_set changes what the pin means; narrative_real yields to
// real_exterior, which is the stronger physical claim.
const PLACE_CLASS_PRECEDENCE = [
  "fictional",
  "studio_interior",
  "real_interior",
  "real_exterior",
  "narrative_real",
  "unknown",
];

export function strongerPlaceClass(a, b) {
  const rank = (value) => {
    const index = PLACE_CLASS_PRECEDENCE.indexOf(value);
    return index === -1 ? PLACE_CLASS_PRECEDENCE.length : index;
  };
  return rank(a) <= rank(b) ? a : b;
}

export function linkKeyOf({ workKey, placeWikidataId, relationKind }) {
  return `${workKey}|${placeWikidataId}|${relationKind}`;
}

// Deterministic identity of an evidence row: stable across runs, machines and row
// order (retrieved_at is deliberately excluded). place_evidence has no unique
// constraint, so this key is what keeps re-resolving from duplicating the ledger.
export function evidenceKey(row) {
  return `${row.subject_type}|${row.subject_ref ?? row.subject_id}|${row.method}|${row.source_ref ?? ""}`;
}

// The subset of planned evidence that is not already stored. `existing` is any
// iterable of rows carrying the same identity fields.
export function missingEvidenceRows(planned, existing) {
  const seen = new Set();
  for (const row of existing ?? []) seen.add(evidenceKey(row));

  const out = [];
  for (const row of planned ?? []) {
    const key = evidenceKey(row);
    if (seen.has(key)) continue;
    seen.add(key); // also de-dupes within the plan itself
    out.push(row);
  }
  return out;
}

const wikidataPageUrl = (qid) => `https://www.wikidata.org/wiki/${qid}`;

// Turn fetched Wikidata entities into the rows to persist. Pure: no uuids, no DB.
// Places are deduped by wikidata_id across the whole batch (two works sharing a
// location produce one place and two links).
export function buildResolutionPlan({ works, workQids, entities, typeGraph } = {}) {
  const entityMap = entities instanceof Map ? entities : new Map(Object.entries(entities ?? {}));
  const qidMap = workQids instanceof Map ? workQids : new Map(Object.entries(workQids ?? {}));

  const places = new Map(); // wikidata_id → row
  const links = [];
  const linkKeys = new Set(); // (work, place, relation) already planned
  const evidence = [];
  const flags = [];
  const skipped = [];

  for (const work of Array.isArray(works) ? works : []) {
    const workKey = String(work?.id ?? "");
    const config = workKindConfig(work?.kind);
    if (!config) {
      skipped.push({ workKey, reason: "unsupported_kind" });
      continue;
    }

    const qidEntry = qidMap.get(workKey);
    const workQid = typeof qidEntry === "string" ? qidEntry : qidEntry?.wikidataId;
    if (qidEntry?.conflict) {
      skipped.push({ workKey, reason: "qid_conflict" }); // ambiguous → never guess
      continue;
    }
    if (!isWikidataId(workQid)) {
      skipped.push({ workKey, reason: "no_wikidata_id" });
      continue;
    }

    const workEntity = entityMap.get(workQid);
    // A deleted or unfetchable QID comes back as {id, missing:""}; that is a different
    // story from a live entity that genuinely carries no location claims.
    if (!workEntity || "missing" in workEntity) {
      skipped.push({ workKey, reason: "work_entity_unavailable" });
      continue;
    }
    // Coordinate-agnostic read — this is what keeps fiction alive. Deduped because a
    // work can carry the same location twice (two statements, different qualifiers);
    // two identical link rows in one upsert are a Postgres cardinality violation.
    const locationQids = [...new Set(entityClaimIds(workEntity, config.locationProperty))];
    if (locationQids.length === 0) {
      skipped.push({ workKey, reason: "no_locations" });
      continue;
    }

    let dropped = 0;
    for (const locQid of locationQids) {
      const locEntity = entityMap.get(locQid);
      if (!locEntity || "missing" in locEntity) {
        dropped += 1; // never fetched or deleted upstream — counted, not silently lost
        continue;
      }

      const name = entityText(locEntity, "labels");
      if (!name) {
        dropped += 1; // an entity with no label is not presentable
        continue;
      }

      const classified = classifyPlace({
        ancestry: typeAncestry(locEntity, typeGraph),
        relationKind: config.relationKind,
        coordinate: entityCoordinate(locEntity),
        name,
      });

      // One evidence row per grain. The place row is evidenced by the location
      // entity itself (its P625/P31); the link is evidenced by the work's own
      // location statement. Both are needed: grounding.isPublishable(place, evidence)
      // reads place-grain evidence, while the link carries the "filmed here" claim.
      const placeEvidence = {
        subject_type: "place",
        subject_ref: locQid,
        method: classified.method,
        source_url: wikidataPageUrl(locQid),
        source_ref: locQid,
        agrees: true,
      };
      const linkEvidence = {
        subject_type: "link",
        subject_ref: linkKeyOf({ workKey, placeWikidataId: locQid, relationKind: config.relationKind }),
        method: classified.method,
        source_url: wikidataPageUrl(workQid),
        source_ref: `${workQid}/${config.locationProperty}/${locQid}`,
        agrees: true,
      };

      const fused = fuseConfidence([placeEvidence]);

      const existingPlace = places.get(locQid);
      if (!existingPlace) {
        places.set(locQid, {
          wikidata_id: locQid,
          name,
          lat: classified.lat,
          lng: classified.lng,
          place_class: classified.place_class,
          geocode_precision: classified.geocode_precision,
          shot_on_set: classified.shot_on_set,
          confidence: fused.confidence,
          confidence_band: fused.band,
          resolver_version: RESOLVER_VERSION,
        });
        evidence.push(placeEvidence);
      } else if (existingPlace.place_class !== classified.place_class) {
        // One canonical place can be reached by two works through different relations
        // (a book's P840 and a film's P915), which yields narrative_real vs
        // real_exterior. Resolve by fixed precedence, never by iteration order, so the
        // stored row can't flip between runs or depend on batch composition.
        const winner = strongerPlaceClass(existingPlace.place_class, classified.place_class);
        if (winner !== existingPlace.place_class) {
          existingPlace.place_class = winner;
          existingPlace.geocode_precision = classified.geocode_precision;
          existingPlace.shot_on_set = classified.shot_on_set;
          existingPlace.lat = classified.lat;
          existingPlace.lng = classified.lng;
        }
        flags.push(`place_class_disagreement:${locQid}:${winner}`);
      }

      // Keyed dedup as well as the source-side dedup above: two identical
      // (work, place, relation) rows in one upsert are a Postgres cardinality
      // violation that would 502 the entire batch.
      const linkKey = linkEvidence.subject_ref;
      if (!linkKeys.has(linkKey)) {
        linkKeys.add(linkKey);
        links.push({
          workKey,
          place_wikidata_id: locQid,
          relation_kind: config.relationKind,
          confidence: fuseConfidence([linkEvidence]).confidence,
        });
        evidence.push(linkEvidence);
      }

      // QA tripwire: a studio-sounding name that the type graph did not classify as a
      // studio means Wikidata under-models it. Response-only; never persisted.
      if (classified.name_hints_studio && classified.place_class !== "studio_interior") {
        flags.push(`studio_name_without_studio_type:${locQid}`);
      }
    }

    // A work whose every location entity was unfetchable/unlabelled would otherwise
    // vanish from both `resolved` and `skipped` — reported as neither, silently.
    if (dropped > 0) {
      flags.push(`locations_unavailable:${workKey}:${dropped}`);
      if (dropped === locationQids.length) {
        skipped.push({ workKey, reason: "locations_unavailable" });
      }
    }
  }

  return { places: [...places.values()], links, evidence, flags, skipped };
}

async function fetchJson(url, { fetchImpl, userAgent, signal, revalidate }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal,
      next: { revalidate },
    });
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt === 1) {
      throw new Error(`Wikidata responded with ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Wikidata entity fetch exhausted retries");
}

// Fetch entities by id. Chunked at the entity API's documented maximum (50) rather
// than the 5 used by the interactive search path: resolution is a batch job, and 5
// would mean ~10x the sequential round-trips and a needless timeout risk.
export async function fetchWikidataEntities(ids, {
  fetchImpl = (...args) => fetch(...args),
  userAgent = USER_AGENT,
  signal,
  revalidate = 86400,
  chunkSize = 50,
} = {}) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(isWikidataId))];
  const entities = new Map();

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const payload = await fetchJson(buildWikidataEntitiesUrl(chunk), {
      fetchImpl, userAgent, signal, revalidate,
    });
    for (const [qid, entity] of Object.entries(payload?.entities ?? {})) {
      if (isWikidataId(qid)) entities.set(qid, entity);
    }
  }
  return entities;
}

// Expand the P279 closure above a set of seed types, one level per round. Bounded by
// DEPTH ONLY — a level is always fetched whole.
//
// It deliberately has no node budget and no early exit once targets are seen. Both
// would truncate the graph, and truncation here fails OPEN, in the one direction this
// project must never fail: a fictional place whose chain to Q3895768 is severed falls
// through to "real place with a real coordinate" and gets pinned. Which places get
// stranded would depend on wbgetentities key order, so the bug would be intermittent.
// Levels are fetched 50 ids at a time (the API maximum), so a full batch stays cheap.
export async function fetchTypeGraph(seedTypeIds, { maxDepth = 4, ...rest } = {}) {
  const graph = new Map();
  let frontier = [...new Set((Array.isArray(seedTypeIds) ? seedTypeIds : []).filter(isWikidataId))];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const fetched = await fetchWikidataEntities(frontier, rest);
    const next = [];
    for (const [qid, entity] of fetched) {
      if (graph.has(qid)) continue;
      graph.set(qid, entity);
      for (const parent of entityClaimIds(entity, "P279")) {
        if (!graph.has(parent)) next.push(parent);
      }
    }
    frontier = [...new Set(next)];
  }

  return graph;
}

// Stage 0 + 1 end to end for a batch of work rows. Returns the plan plus the QIDs
// used, and touches no database — persistence is the route's job.
export async function resolveWorkPlaces(works, {
  fetchImpl = (...args) => fetch(...args),
  crosswalk,
  signal,
  ...rest
} = {}) {
  const rows = Array.isArray(works) ? works : [];
  const options = { fetchImpl, signal, ...rest };

  // Works that already carry a QID skip the cross-walk entirely.
  const workQids = new Map();
  const needCrosswalk = [];
  for (const work of rows) {
    const workKey = String(work?.id ?? "");
    if (isWikidataId(work?.wikidata_id)) {
      workQids.set(workKey, { wikidataId: work.wikidata_id, conflict: false });
    } else {
      needCrosswalk.push(work);
    }
  }

  if (needCrosswalk.length > 0 && typeof crosswalk === "function") {
    const found = await crosswalk(needCrosswalk, { fetchImpl, signal });
    for (const [workKey, entry] of found ?? []) workQids.set(workKey, entry);
  }

  const qids = [...workQids.values()].map((e) => e?.wikidataId).filter(isWikidataId);
  const workEntities = await fetchWikidataEntities(qids, options);

  // Collect every location claim across the batch, then fetch those entities once.
  const locationQids = new Set();
  for (const work of rows) {
    const config = workKindConfig(work?.kind);
    const entry = workQids.get(String(work?.id ?? ""));
    if (!config || entry?.conflict || !isWikidataId(entry?.wikidataId)) continue;
    for (const locQid of entityClaimIds(workEntities.get(entry.wikidataId), config.locationProperty)) {
      locationQids.add(locQid);
    }
  }

  const locationEntities = await fetchWikidataEntities([...locationQids], options);
  const entities = new Map([...workEntities, ...locationEntities]);

  // One shared type graph for the batch, seeded from every location's P31 classes.
  const seeds = new Set();
  for (const entity of locationEntities.values()) {
    for (const typeId of entityClaimIds(entity, "P31")) seeds.add(typeId);
  }
  const typeGraph = await fetchTypeGraph([...seeds], options);

  return {
    plan: buildResolutionPlan({ works: rows, workQids, entities, typeGraph }),
    workQids,
  };
}
