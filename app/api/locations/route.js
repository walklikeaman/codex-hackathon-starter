import { NextResponse } from "next/server";
import { MAX_SEARCH_RADIUS_KM } from "../../lib/nearby.mjs";
import {
  buildLocationsSparql,
  buildWikidataEntitiesUrl,
  buildWikidataSearchUrl,
  entityClaimIds,
  entityText,
  isWikidataId,
  isWorkKind,
  locationsByDistance,
  locationsWithinRadius,
  normalizeWikidataEntityLocations,
  normalizeWikidataLocations,
  numberInRange,
  rankNearbyLocations,
  safeSearchQuery,
  selectFirstMatchingWork,
  workKindConfig,
  workMatchesTypeGraph,
} from "../../lib/location-search.mjs";
import {
  addSceneMatchTokens,
  SCENE_MATCH_TOKEN_CACHE_CONTROL,
} from "../../lib/scene-match-token.mjs";
import { findInvertedPlaces } from "../../lib/inverted-places.mjs";

// node:crypto (via scene-match-token) requires the Node runtime, not edge.
export const runtime = "nodejs";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULTS = { lat: 51.5072, lng: -0.1276, radius: 15, limit: 30, kind: "film" };
const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)";
const ENTITY_CHUNK_SIZE = 5;

async function searchWorks(query) {
  const response = await fetch(buildWikidataSearchUrl(query), {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) throw new Error(`Wikidata search responded with ${response.status}`);
  const payload = await response.json();

  return (payload.search ?? [])
    .filter((result) => isWikidataId(result.id))
    .map(({ id, label, description }) => ({ id, label, description }));
}

async function fetchLocationBindings(query) {
  const endpoint = new URL(WIKIDATA_ENDPOINT);
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("format", "json");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": USER_AGENT,
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(18000),
    });

    if (response.ok) {
      const payload = await response.json();
      if (!Array.isArray(payload?.results?.bindings)) {
        throw new Error("Wikidata returned an invalid payload");
      }
      return payload.results.bindings;
    }
    if (![429, 503].includes(response.status) || attempt === 1) {
      throw new Error(`Wikidata locations responded with ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error("Wikidata locations request failed");
}

async function fetchEntities(ids) {
  const uniqueIds = [...new Set(ids)].filter(isWikidataId);
  if (!uniqueIds.length) return new Map();

  const chunks = [];
  for (let index = 0; index < uniqueIds.length; index += ENTITY_CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(index, index + ENTITY_CHUNK_SIZE));
  }

  const payloads = await Promise.all(chunks.map(async (chunk) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(buildWikidataEntitiesUrl(chunk), {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) return response.json();
      if (response.status !== 429 || attempt === 1) {
        throw new Error(`Wikidata entities responded with ${response.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("Wikidata entities request failed");
  }));

  return new Map(payloads.flatMap((payload) => Object.entries(payload.entities ?? {})));
}

async function fetchTypeGraph(workEntities, kind) {
  const rootType = workKindConfig(kind).rootType;
  const graph = new Map();
  const visited = new Set([rootType]);
  let frontier = [...new Set(
    [...workEntities.values()].flatMap((entity) => entityClaimIds(entity, "P31")),
  )].filter((typeId) => !visited.has(typeId));

  for (let depth = 0; depth < 4 && frontier.length; depth += 1) {
    const level = await fetchEntities(frontier);
    const next = [];

    for (const [typeId, entity] of level) {
      graph.set(typeId, entity);
      visited.add(typeId);
      for (const parentId of entityClaimIds(entity, "P279")) {
        if (!visited.has(parentId)) next.push(parentId);
      }
    }

    frontier = [...new Set(next)].filter((typeId) => typeId !== rootType);
  }

  return graph;
}

async function findLocationsByTitle({ workMatches, kind, center, radius, limit, excludeLocationId }) {
  const workIds = workMatches.map((match) => match.id);
  const workEntities = await fetchEntities(workIds);
  let matchedWorkId = null;

  for (const workId of workIds) {
    const entity = workEntities.get(workId);
    if (!entity) continue;
    const typeGraph = await fetchTypeGraph(new Map([[workId, entity]]), kind);
    if (workMatchesTypeGraph(entity, typeGraph, kind)) {
      matchedWorkId = workId;
      break;
    }
  }

  const matchedWork = matchedWorkId
    ? workMatches.find((match) => match.id === matchedWorkId) ?? null
    : null;

  if (!matchedWorkId) return { matchedWork: null, locations: [] };

  const workEntity = workEntities.get(matchedWorkId);
  const config = workKindConfig(kind);
  const locationIds = entityClaimIds(workEntity, config.locationProperty);
  const locationEntities = await fetchEntities(locationIds);
  const normalized = normalizeWikidataEntityLocations(workEntity, locationEntities, { kind });
  // Every place the work touches, nearest first. The radius no longer decides what
  // exists — a title search is not a question about the city on screen.
  const ranked = locationsByDistance(normalized, center, radius);
  const stated = selectFirstMatchingWork(ranked, [matchedWorkId], limit, excludeLocationId);

  // The other direction: places whose OWN article mentions this work. Wikidata's P915
  // is a statement somebody wrote on the work's item, and per-work it is thin — one
  // place for Notting Hill. The inverted search reads the category that only ever lives
  // on the place's page, which is where the graves, the cafés and the schools are.
  //
  // It runs AFTER the statement search rather than beside it, and is given what that
  // search already found, so the same place cannot arrive twice. Its cost is bounded
  // and its failures are swallowed: these are extra places, never the answer.
  const candidates = await findInvertedPlaces({
    work: {
      id: matchedWorkId,
      title: matchedWork?.label ?? entityText(workEntity, "labels"),
      year: stated[0]?.work_year ?? null,
    },
    kind,
    center,
    radiusKm: radius,
    limit: Math.max(0, limit - stated.length),
    exclude: stated,
    onError: (error) => console.warn("inverted place search failed", error?.message),
  });

  // Every inverted hit is inside `nearcoord:`, so it is here by construction — but the
  // distance is still measured rather than assumed, because the client sorts on it.
  const locations = [...stated, ...locationsByDistance(candidates, center, radius)];

  return {
    matchedWork,
    locations,
    here: locations.filter((location) => location.in_radius).length,
    candidate_count: candidates.length,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberInRange(searchParams.get("lat"), DEFAULTS.lat, { min: -90, max: 90 });
  const lng = numberInRange(searchParams.get("lng"), DEFAULTS.lng, { min: -180, max: 180 });
  const radius = numberInRange(searchParams.get("radius"), DEFAULTS.radius, { min: 0.1, max: MAX_SEARCH_RADIUS_KM });
  const limit = numberInRange(searchParams.get("limit"), DEFAULTS.limit, { min: 1, max: 60 });
  const kind = searchParams.get("kind") ?? DEFAULTS.kind;
  const workQuery = searchParams.has("q") ? safeSearchQuery(searchParams.get("q")) : null;
  const excludeLocationId = searchParams.get("exclude");

  if ([lat, lng, radius, limit].some((value) => value === null) || !isWorkKind(kind)) {
    return NextResponse.json(
      { error: "lat, lng, radius, limit, or kind is outside the supported range" },
      { status: 400 },
    );
  }

  if (searchParams.has("q") && !workQuery) {
    return NextResponse.json({ error: "Enter a work title up to 160 characters" }, { status: 400 });
  }

  try {
    const workMatches = workQuery ? await searchWorks(workQuery) : [];
    const workIds = workMatches.map((match) => match.id);

    if (workQuery && workIds.length === 0) {
      return NextResponse.json({
        center: { lat, lng },
        radius_km: radius,
        kind,
        search_mode: "work",
        matched_work: null,
        locations: [],
      });
    }

    if (workQuery) {
      const result = await findLocationsByTitle({
        workMatches,
        kind,
        center: { lat, lng },
        radius,
        limit,
        excludeLocationId,
      });

      return NextResponse.json(
        {
          center: { lat, lng },
          radius_km: radius,
          kind,
          search_mode: "work",
          matched_work: result.matchedWork,
          // How many of them are in the city on screen. The client needs this to know
          // whether to fly somewhere: a title search that returns places nobody can see
          // is the same failure as returning none.
          here: result.here ?? 0,
          // How many of them are candidates rather than statements. The client says so
          // on the card; a count here lets it say so before opening one.
          candidates: result.candidate_count ?? 0,
          locations: addSceneMatchTokens(result.locations),
        },
        { headers: { "Cache-Control": SCENE_MATCH_TOKEN_CACHE_CONTROL } },
      );
    }

    const sourceLimit = Math.min(60, limit);
    const query = buildLocationsSparql({
      lat,
      lng,
      radius,
      sourceLimit,
      kind,
      workIds: [],
      excludeLocationId,
    });
    const bindings = await fetchLocationBindings(query);
    const normalized = normalizeWikidataLocations(bindings, { kind });
    const nearby = locationsWithinRadius(normalized, { lat, lng }, radius);
    const locations = rankNearbyLocations(nearby, { limit });

    return NextResponse.json(
      {
        center: { lat, lng },
        radius_km: radius,
        kind,
        search_mode: "nearby",
        matched_work: null,
        locations: addSceneMatchTokens(locations),
      },
      { headers: { "Cache-Control": SCENE_MATCH_TOKEN_CACHE_CONTROL } },
    );
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error("Wikidata locations request failed", {
      name: error?.name,
      message: error?.message,
    });
    return NextResponse.json(
      { error: timedOut ? "Location search timed out. Try the title search again." : "Unable to retrieve locations from Wikidata" },
      { status: timedOut ? 504 : 502 },
    );
  }
}
