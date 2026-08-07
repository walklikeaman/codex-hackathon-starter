import { NextResponse } from "next/server";
import { MAX_SEARCH_RADIUS_KM } from "../../lib/nearby.mjs";
import {
  buildLocationsSparql,
  buildWikidataEntitiesUrl,
  buildWikidataSearchUrl,
  buildWorkFameQuery,
  entityClaimIds,
  entityClaimValues,
  entityText,
  fameFromBindings,
  rankWorksByFame,
  isWikidataId,
  isWorkKind,
  locationFallbacks,
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
import { DISPLAY, gradePlace } from "../../lib/place-grade.mjs";
import { createClient } from "@supabase/supabase-js";
import { MATCHED_BY, selectSubmissionPlaces } from "../../lib/submission-places.mjs";
import { normalizeWorkTitle } from "../../lib/content-graph.mjs";

// How many queue rows one work may contribute. Person of Interest alone has 961.
const MAX_SUBMISSION_PLACES = 12;
const SUBMISSION_FETCH_LIMIT = 200;

// Everything the ingest found, reachable from a title search: 6,041 works and 30,189
// geolocated rows that the live map could not see. Read with the anon key like the rest
// of the graph — the queue is public-read under RLS — and a failure costs these extra
// places, never the map.
const SUBMISSION_COLUMNS =
  "id, place_name, area_hint, lat, lng, source_url, source_sentence, source_kind, works!inner(imdb_id, title_norm, kind)";

// One identifier is not enough, and Doctor Who is why.
//
// Wikidata's item for the series carries IMDb `tt0056751` — the 1963 series. Our queue
// was filled under `tt0436992`, the 2005 revival: 566 rows against 3. Both are Doctor
// Who, one identifier reaches three of them, and a search that answers with three is
// wrong in the way that matters — the person asked for Doctor Who and we had 566.
//
// The same shape waits in every long-running series, every remake and every work whose
// two sources picked different ids. So identifiers first, ALL of them — an item may
// carry several P345 values, plus a TMDB id — and then the title, which finds the rest.
//
// The two are not equally strong and the card says which one it was: a title is shared
// by works that have nothing to do with each other (Gladiator is two films), so a
// title-matched row is labelled "matched by title" and asks to be checked.
async function findSubmissionPlaces({ workEntity, work, kind, center, exclude, env = process.env }) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return [];

  const imdbIds = entityClaimValues(workEntity, "P345").filter((id) => /^tt\d+$/.test(String(id)));
  const tmdbId = entityClaimValues(workEntity, "P4947")[0] ?? null;
  const titleNorm = normalizeWorkTitle(work.title ?? "");

  try {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const base = () => client
      .from("location_submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("status", "pending")
      .not("lat", "is", null)
      .limit(SUBMISSION_FETCH_LIMIT);

    const rows = [];
    const seen = new Set();
    const collect = (data, matchedBy) => {
      for (const row of data ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push({ ...row, matched_by: matchedBy });
      }
    };

    if (imdbIds.length || tmdbId) {
      const filters = [
        imdbIds.length ? `imdb_id.in.(${imdbIds.join(",")})` : null,
        tmdbId ? `tmdb_id.eq.${tmdbId}` : null,
      ].filter(Boolean).join(",");
      const { data, error } = await base().or(filters, { referencedTable: "works" });
      if (error) throw new Error(error.message);
      collect(data, MATCHED_BY.id);
    }

    // The title round runs even when the identifier found rows: 3 of Doctor Who's 569
    // came from the id, and stopping there would have been the bug.
    if (titleNorm) {
      const { data, error } = await base()
        .eq("works.title_norm", titleNorm)
        .eq("works.kind", kind);
      if (error) throw new Error(error.message);
      collect(data, MATCHED_BY.title);
    }

    return selectSubmissionPlaces(rows, {
      work, kind, center, limit: MAX_SUBMISSION_PLACES, exclude,
    });
  } catch (error) {
    console.warn("submission queue unavailable", error?.message);
    return [];
  }
}

// Precision is an axis of its own, and it is the one that decides what a pin may claim.
// "Skyfall was shot in Istanbul" can be perfectly evidenced and is still not a doorway;
// a fan naming the exact café is precise and thinly evidenced. The two are never
// multiplied, so both travel to the client separately ([[three-axes]]).
//
// A place whose type we could not read stays a PIN. `gradePlace` calls that case hidden
// — correct for a record we are deciding whether to store, wrong for a live map, where
// a missing P31 label would delete a real place with a real coordinate over metadata
// nobody has filled in. Unknown here means ungraded, and it says so on the card.
function gradeLocations(locations) {
  return locations.map((location) => {
    const grade = gradePlace({
      name: location.loc_name,
      typeLabels: location.place_types,
      // A statement on the work's Wikidata item is somebody's recorded claim; an
      // inverted-search hit is not, and the card already says so.
      verified: location.relation_kind !== "candidate",
    });

    return {
      ...location,
      precision: grade.precision,
      display: grade.display === DISPLAY.hidden ? DISPLAY.pin : grade.display,
      precision_caveat: grade.caveat,
    };
  });
}

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

  const matches = (payload.search ?? [])
    .filter((result) => isWikidataId(result.id))
    .map(({ id, label, description }) => ({ id, label, description }));

  // Famous first. `wbsearchentities` orders by how well a label matches the typed
  // string, which puts Adele's lyric video above the film called Skyfall and a
  // parasitology journal above the film called Parasite. One extra query, and it is the
  // difference between a juror naming their favourite film and seeing it, or seeing an
  // empty map that reads as "we do not have that film".
  const fameQuery = buildWorkFameQuery(matches.map((match) => match.id));
  if (!fameQuery) return matches;

  try {
    const endpoint = new URL(WIKIDATA_ENDPOINT);
    endpoint.searchParams.set("query", fameQuery);
    endpoint.searchParams.set("format", "json");
    const fameResponse = await fetch(endpoint, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(6000),
    });
    if (!fameResponse.ok) return matches;
    return rankWorksByFame(matches, fameFromBindings(await fameResponse.json()));
  } catch (error) {
    // Ordering is an improvement, not a precondition. If the service is slow the search
    // runs in the order the API gave us, exactly as it did before.
    console.warn("work fame ranking unavailable", error?.message);
    return matches;
  }
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

  // The work's own property first, then the weaker ones — but only if the strong one
  // gave nothing. Measured on 24 famous titles, three returned an empty map: Spirited
  // Away and Parasite have no P915 at all (one is animation, the other built its sets),
  // and an empty map does not read as "nobody recorded the locations", it reads as "we
  // do not have that film".
  let via = null;
  let locationIds = entityClaimIds(workEntity, config.locationProperty);
  if (locationIds.length === 0) {
    for (const fallback of locationFallbacks(kind)) {
      const ids = entityClaimIds(workEntity, fallback.property);
      if (ids.length === 0) continue;
      via = fallback;
      locationIds = ids;
      break;
    }
  }

  const locationEntities = await fetchEntities(locationIds);
  // What each place IS, one batch for the whole result. Without it every place in a
  // title search would be ungraded — and the coarse ones, the countries and the
  // counties, are exactly what a title search returns most of.
  const typeEntities = await fetchEntities(
    [...locationEntities.values()].flatMap((entity) => entityClaimIds(entity, "P31")),
  );
  const typeLabels = new Map(
    [...typeEntities].map(([typeId, entity]) => [typeId, entityText(entity, "labels")]),
  );
  const normalized = normalizeWikidataEntityLocations(workEntity, locationEntities, {
    kind, typeLabels, via,
  });
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
  const work = {
    id: matchedWorkId,
    title: matchedWork?.label ?? entityText(workEntity, "labels"),
    year: stated[0]?.work_year ?? null,
  };

  const candidates = await findInvertedPlaces({
    work,
    kind,
    center,
    radiusKm: radius,
    limit: Math.max(0, limit - stated.length),
    exclude: stated,
    onError: (error) => console.warn("inverted place search failed", error?.message),
  });

  // And the queue: everything our own ingest found for this work. Read last so it can be
  // deduplicated against both of the above, and so a slow database never delays the
  // answer that Wikidata already gave.
  const queued = await findSubmissionPlaces({
    workEntity,
    work,
    kind,
    center,
    exclude: [...stated, ...candidates],
  });

  // Every inverted hit is inside `nearcoord:`, so it is here by construction — but the
  // distance is still measured rather than assumed, because the client sorts on it.
  const locations = [
    ...stated,
    ...locationsByDistance([...candidates, ...queued], center, radius),
  ];

  return {
    matchedWork,
    locations,
    here: locations.filter((location) => location.in_radius).length,
    candidate_count: candidates.length + queued.length,
    queued_count: queued.length,
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
          // How many of them came from our own ingest queue rather than from a live
          // service. Useful in one glance when the map looks thinner than it should.
          queued: result.queued_count ?? 0,
          locations: addSceneMatchTokens(gradeLocations(result.locations)),
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
        locations: addSceneMatchTokens(gradeLocations(locations)),
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
