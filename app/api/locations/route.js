import { NextResponse } from "next/server";
import {
  buildLocationsSparql,
  buildWikidataEntitiesUrl,
  buildWikidataSearchUrl,
  entityClaimIds,
  isWikidataId,
  isWorkKind,
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
} from "../../lib/scene-match-token.mjs";

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
  const nearby = locationsWithinRadius(normalized, center, radius);

  return {
    matchedWork,
    locations: selectFirstMatchingWork(nearby, [matchedWorkId], limit, excludeLocationId),
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberInRange(searchParams.get("lat"), DEFAULTS.lat, { min: -90, max: 90 });
  const lng = numberInRange(searchParams.get("lng"), DEFAULTS.lng, { min: -180, max: 180 });
  const radius = numberInRange(searchParams.get("radius"), DEFAULTS.radius, { min: 0.1, max: 50 });
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
          locations: addSceneMatchTokens(result.locations),
        },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
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
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
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
