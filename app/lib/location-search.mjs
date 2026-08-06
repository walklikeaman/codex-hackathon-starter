import { haversineKm } from "./geo.mjs";

const WORK_KIND_CONFIG = {
  film: {
    label: "film",
    plural: "films",
    rootType: "Q11424",
    locationProperty: "P915",
    relationKind: "filming_location",
    relationLabel: "Filming location",
  },
  series: {
    label: "series",
    plural: "series",
    rootType: "Q5398426",
    locationProperty: "P915",
    relationKind: "filming_location",
    relationLabel: "Filming location",
  },
  book: {
    label: "book",
    plural: "books",
    rootType: "Q7725634",
    locationProperty: "P840",
    relationKind: "narrative_location",
    relationLabel: "Story setting",
  },
};

export function workKindConfig(kind) {
  return WORK_KIND_CONFIG[kind] ?? null;
}

// What to say about a work that has no filming locations at all.
//
// An empty map does not read as "nobody has recorded where this was shot". It reads as
// "we do not have that film" — which is the one impression this product cannot afford,
// and measured on 24 famous titles it happened to three of them. Two were animation:
// Spirited Away and Parasite carry no P915 because there was nothing to film on location
// (and in Parasite's case the sets were built), but both state where the story is set
// and where they were made.
//
// So the fallback is ordered by how much it claims, weakest last, and each rung says
// plainly what it is. A country is not a stop on a walk — `place-grade` renders it as an
// area — but it is an honest answer, and honest beats blank.
const LOCATION_FALLBACKS = {
  film: [
    { property: "P840", relationKind: "narrative_location", relationLabel: "Story setting" },
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
  series: [
    { property: "P840", relationKind: "narrative_location", relationLabel: "Story setting" },
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
  book: [
    { property: "P495", relationKind: "origin_country", relationLabel: "Country of origin" },
  ],
};

export function locationFallbacks(kind) {
  return LOCATION_FALLBACKS[kind] ?? [];
}

export function isWorkKind(kind) {
  return Boolean(workKindConfig(kind));
}

export function isWikidataId(value) {
  return /^Q\d+$/.test(value ?? "");
}

export function numberInRange(value, fallback, { min, max }) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function wikidataId(uri) {
  return uri?.match(/Q\d+$/)?.[0] ?? null;
}

export function coordinates(wkt) {
  const match = wkt?.match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
  return match ? { lng: Number(match[1]), lat: Number(match[2]) } : null;
}

function releaseYear(value) {
  return Number(value?.match(/^([+-]?\d{1,6})-/)?.[1]) || null;
}

function isPlaceholderLabel(value) {
  return /^Q\d+(?:\s|$)/.test(value?.trim() ?? "");
}

function coreLocationPattern({ lat, lng, radius, workIds, config, excludeLocationId }) {
  const instancePattern = workIds?.length || config.label !== "film"
    ? `wdt:P31/wdt:P279* wd:${config.rootType}`
    : `wdt:P31 wd:${config.rootType}`;

  if (workIds?.length) {
    const values = workIds.map((id) => `wd:${id}`).join(" ");
    return `
      VALUES ?work { ${values} }
      ?work ${instancePattern} ;
            wdt:${config.locationProperty} ?location .
      ?location wdt:P625 ?coord .`;
  }

  const excludedLocation = isWikidataId(excludeLocationId)
    ? `\n      FILTER(?location != wd:${excludeLocationId})`
    : "";

  return `
      SERVICE wikibase:around {
        ?location wdt:P625 ?coord .
        bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
        bd:serviceParam wikibase:radius "${radius}" .
      }
      ?work ${instancePattern} ;
            wdt:${config.locationProperty} ?location .${excludedLocation}`;
}

export function buildLocationsSparql({
  lat,
  lng,
  radius,
  sourceLimit,
  kind,
  workIds = [],
  excludeLocationId = null,
}) {
  const config = workKindConfig(kind);
  if (!config) throw new Error(`Unsupported work kind: ${kind}`);
  if (workIds.some((id) => !isWikidataId(id))) throw new Error("Invalid Wikidata work id");

  const core = coreLocationPattern({
    lat,
    lng,
    radius,
    workIds,
    config,
    excludeLocationId,
  });

  // `?types` is what a place IS, and it decides whether the place may be a pin at all
  // ([[three-axes]]). GROUP_CONCAT rather than SAMPLE, because a place carries several
  // P31s and SAMPLE picks one at random: the Isle of Skye is an island AND a place with
  // a Council area, and grading it on whichever arrives first is a coin toss over
  // whether it appears as a dot you could stand on.
  return `
SELECT ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription
       (MIN(?date) AS ?releaseDate)
       (SAMPLE(?placeImage) AS ?image)
       (SAMPLE(?tmdb) AS ?tmdbId)
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
WHERE {
  {
    SELECT DISTINCT ?work ?location ?coord WHERE {${core}
    }
    LIMIT ${sourceLimit}
  }
  OPTIONAL { ?work wdt:P577 ?date . }
  OPTIONAL { ?work wdt:P4947 ?tmdb . }
  OPTIONAL { ?location wdt:P18 ?placeImage . }
  OPTIONAL {
    ?location wdt:P31 ?type .
    ?type rdfs:label ?typeLabel .
    FILTER(LANG(?typeLabel) = "en")
  }
  OPTIONAL {
    ?location schema:description ?locationDescription .
    FILTER(LANG(?locationDescription) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru" . }
}
GROUP BY ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription`;
}

// How many title candidates to consider before deciding which work was meant.
//
// It was 8, and 8 is where the demo breaks. Measured on the live search: "Skyfall"
// returns Adele's song, her lyric video and the soundtrack before the film — the film
// is not in the top eight at all — and "Parasite" returns a parasitology journal, two
// video games and the biological concept. `wbsearchentities` ranks by how well a label
// matches the string, and nothing else.
export const WORK_SEARCH_CANDIDATES = 15;

export function buildWikidataSearchUrl(query, limit = WORK_SEARCH_CANDIDATES) {
  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.searchParams.set("action", "wbsearchentities");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("uselang", "en");
  endpoint.searchParams.set("type", "item");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

// Which of the candidates is the one somebody meant.
//
// A label match cannot tell "Skyfall the film" from "Skyfall the lyric video", and the
// type check alone does not either — a music video IS a film in Wikidata's hierarchy, so
// the video passes and answers with no filming locations. What separates them is how
// many Wikipedias bothered to write about the thing:
//
//   Skyfall        film 78 · song 36 · soundtrack 9 · literary work 1
//   Parasite       film 81 · the biological concept 46 · video games 14
//   Spirited Away  film 109 · album 4 · a TV episode 2
//
// Measured, all three. The same signal that orders the character fan-out in
// `place-search.mjs`, used here for the question it answers best: of several things
// with one name, which is the famous one.
export function buildWorkFameQuery(ids) {
  const valid = [...new Set(ids ?? [])].filter(isWikidataId);
  if (!valid.length) return null;
  return `SELECT ?item ?sitelinks WHERE {
  VALUES ?item { ${valid.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
}`;
}

export function fameFromBindings(payload) {
  const fame = new Map();
  for (const row of payload?.results?.bindings ?? []) {
    const id = String(row?.item?.value ?? "").split("/").pop();
    const count = Number(row?.sitelinks?.value);
    if (isWikidataId(id)) fame.set(id, Number.isFinite(count) ? count : 0);
  }
  return fame;
}

// Fame decides the ORDER, never the answer: the type check still has the last word, so
// a famous song can outrank a film in this list and still be refused for not being one.
// A candidate whose count we could not read sorts last rather than first.
export function rankWorksByFame(matches, fame) {
  const counts = fame instanceof Map ? fame : new Map(Object.entries(fame ?? {}));
  return [...(matches ?? [])].sort((left, right) =>
    (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0));
}

export function buildWikidataEntitiesUrl(ids) {
  const validIds = [...new Set(ids ?? [])].filter(isWikidataId);
  if (!validIds.length || validIds.length > 50) {
    throw new Error("Wikidata entity requests require between 1 and 50 valid ids");
  }

  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.searchParams.set("action", "wbgetentities");
  endpoint.searchParams.set("ids", validIds.join("|"));
  endpoint.searchParams.set("props", "labels|descriptions|claims");
  endpoint.searchParams.set("languages", "en|ru");
  endpoint.searchParams.set("languagefallback", "1");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

export function entityClaimValues(entity, property) {
  return (entity?.claims?.[property] ?? [])
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value) => value !== undefined && value !== null);
}

export function entityClaimIds(entity, property) {
  return entityClaimValues(entity, property)
    .map((value) => value?.id)
    .filter(isWikidataId);
}

export function entityText(entity, property) {
  return entity?.[property]?.en?.value
    ?? entity?.[property]?.ru?.value
    ?? null;
}

const EARTH_GLOBE = "http://www.wikidata.org/entity/Q2";

export function entityCoordinate(entity) {
  const value = entityClaimValues(entity, "P625")[0];
  if (!Number.isFinite(value?.latitude) || !Number.isFinite(value?.longitude)) return null;
  // Every P625 states which celestial body it belongs to. The Moon's own coordinate
  // is 0,0 — pinning it on an Earth map puts it in the Gulf of Guinea — and Mars
  // longitudes run 0..360, which no Earth map (or our lat/lng CHECK) accepts.
  if (value.globe && value.globe !== EARTH_GLOBE) return null;
  return {
    lat: value.latitude,
    lng: value.longitude,
    // Wikidata states how precise its own coordinate is, in degrees. Kept so callers
    // never record a precision bucket finer than the source itself claims.
    precisionDeg: Number.isFinite(value.precision) ? value.precision : null,
  };
}

function entityReleaseYear(entity) {
  const value = entityClaimValues(entity, "P577")[0]?.time;
  return releaseYear(value);
}

function entityImageUrl(entity) {
  const filename = entityClaimValues(entity, "P18")[0];
  if (typeof filename !== "string" || !filename.trim()) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1200`;
}

// Every type reachable from an entity's P31 classes by walking P279* upward through
// the supplied type graph. The walk terminates on `visited`; how far the graph
// reaches is bounded by whatever the caller fetched, not by this function.
// Used for work-kind validation here and for place classification in
// app/lib/location-resolver.mjs.
export function typeAncestry(entity, typeEntities) {
  const graph = typeEntities instanceof Map
    ? typeEntities
    : new Map(Object.entries(typeEntities ?? {}));
  const pending = [...entityClaimIds(entity, "P31")];
  const ancestry = new Set();

  while (pending.length) {
    const typeId = pending.pop();
    if (ancestry.has(typeId)) continue;
    ancestry.add(typeId);
    pending.push(...entityClaimIds(graph.get(typeId), "P279"));
  }

  return ancestry;
}

export function workMatchesTypeGraph(workEntity, typeEntities, kind) {
  const rootType = workKindConfig(kind)?.rootType;
  if (!rootType) return false;
  return typeAncestry(workEntity, typeEntities).has(rootType);
}

// `via` reads a DIFFERENT property than the kind's own, for a work that has none of its
// own — see `locationFallbacks`. It carries its own relation kind and label so the map
// never presents a country of origin as though somebody filmed there.
export function normalizeWikidataEntityLocations(
  workEntity,
  locationEntities,
  { kind, typeLabels = null, via = null } = {},
) {
  const config = workKindConfig(kind);
  if (!config || !isWikidataId(workEntity?.id)) return [];
  const property = via?.property ?? config.locationProperty;
  const relationKind = via?.relationKind ?? config.relationKind;
  const relationLabel = via?.relationLabel ?? config.relationLabel;

  const entities = locationEntities instanceof Map
    ? locationEntities
    : new Map(Object.entries(locationEntities ?? {}));
  const workTitle = entityText(workEntity, "labels") ?? workEntity.id;
  if (isPlaceholderLabel(workTitle)) return [];
  const workYear = entityReleaseYear(workEntity);

  return entityClaimIds(workEntity, property).flatMap((locationId) => {
    const locationEntity = entities.get(locationId);
    const point = entityCoordinate(locationEntity);
    if (!point) return [];

    const place = entityText(locationEntity, "labels") ?? locationId;
    if (isPlaceholderLabel(place)) return [];
    return [{
      work_wikidata_id: workEntity.id,
      work_title: workTitle,
      work_year: workYear,
      kind,
      loc_wikidata_id: locationId,
      loc_name: place,
      lat: point.lat,
      lng: point.lng,
      commons_image: entityImageUrl(locationEntity),
      film_tmdb_id: kind === "film"
        ? entityClaimValues(workEntity, "P4947")[0] ?? null
        : null,
      relation_kind: relationKind,
      relation_property: property,
      relation_label: relationLabel,
      relation_description: relationDescription({
        workTitle,
        place,
        kind,
        via,
        locationDescription: entityText(locationEntity, "descriptions"),
      }),
      // The entity path knows the place's P31 ids; their labels come from a second
      // batch the caller has already fetched, or not at all — an ungraded place is
      // still a place, and refusing to show it would be the worse mistake.
      place_types: entityClaimIds(locationEntity, "P31")
        .map((typeId) => (typeLabels instanceof Map ? typeLabels.get(typeId) : typeLabels?.[typeId]))
        .filter(Boolean),
      source_url: `https://www.wikidata.org/wiki/${locationId}`,
    }];
  });
}

export function distanceKm(first, second) {
  return haversineKm([first.lat, first.lng], [second.lat, second.lng]);
}

export function cityRadiusKm({ lat, lng, boundingBox }) {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) return 15;
  const [south, north, west, east] = boundingBox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return 15;

  const center = { lat, lng };
  const radius = Math.max(
    distanceKm(center, { lat: south, lng: west }),
    distanceKm(center, { lat: south, lng: east }),
    distanceKm(center, { lat: north, lng: west }),
    distanceKm(center, { lat: north, lng: east }),
  );

  return Math.min(50, Math.max(5, Math.ceil(radius)));
}

function relationDescription({ workTitle, place, kind, locationDescription, via = null }) {
  // A fallback rung must say what it is AND what is missing, in the same breath. "South
  // Korea" under a film with no caveat looks like a filming location the size of a
  // country; with the second sentence it is an honest answer to a question nobody else
  // could answer.
  const relation = via?.relationKind === "origin_country"
    ? `${workTitle} was made in ${place}. No exact filming locations are recorded for it yet.`
    : via?.relationKind === "narrative_location"
      ? `${workTitle} is set in ${place}. No exact filming locations are recorded for it yet.`
      : kind === "book"
        ? `The story of ${workTitle} is set in ${place}.`
        : kind === "series"
          ? `${place} is listed as a filming location for the series ${workTitle}.`
          : `${place} is listed as a filming location for ${workTitle}.`;

  if (!locationDescription) return relation;
  const detail = locationDescription.trim().replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return `${relation} ${detail.replace(/[.!?]?$/, ".")}`;
}

export function normalizeWikidataLocations(bindings, { kind }) {
  const config = workKindConfig(kind);
  if (!config) return [];
  const locations = new Map();

  for (const row of bindings ?? []) {
    const workWikidataId = wikidataId(row.work?.value);
    const locWikidataId = wikidataId(row.location?.value);
    const point = coordinates(row.coord?.value);
    if (!workWikidataId || !locWikidataId || !point) continue;

    const workTitle = row.workLabel?.value ?? workWikidataId;
    const place = row.locationLabel?.value ?? locWikidataId;
    if (isPlaceholderLabel(workTitle) || isPlaceholderLabel(place)) continue;
    const key = `${workWikidataId}:${locWikidataId}:${config.relationKind}`;
    if (locations.has(key)) continue;

    locations.set(key, {
      work_wikidata_id: workWikidataId,
      work_title: workTitle,
      work_year: releaseYear(row.releaseDate?.value),
      kind,
      loc_wikidata_id: locWikidataId,
      loc_name: place,
      lat: point.lat,
      lng: point.lng,
      commons_image: row.image?.value ?? null,
      film_tmdb_id: kind === "film" ? row.tmdbId?.value ?? null : null,
      relation_kind: config.relationKind,
      relation_property: config.locationProperty,
      relation_label: config.relationLabel,
      relation_description: relationDescription({
        workTitle,
        place,
        kind,
        locationDescription: row.locationDescription?.value,
      }),
      // What the place IS, for the precision axis. Several, because a place is several
      // things and the finest of them decides whether it can be a pin.
      place_types: (row.types?.value ?? "").split("|").filter(Boolean),
      source_url: `https://www.wikidata.org/wiki/${locWikidataId}`,
    });
  }

  return [...locations.values()];
}

export function locationsWithinRadius(locations, center, radius) {
  return locations
    .map((location) => ({
      ...location,
      distance_km: distanceKm(center, { lat: location.lat, lng: location.lng }),
    }))
    .filter((location) => location.distance_km <= radius)
    .sort((first, second) => first.distance_km - second.distance_km);
}

// Every place a work touches, nearest first, each saying whether it falls inside the
// city currently on screen.
//
// A radius answers "what is near me", which is the right question for a place search
// and the wrong one for a work search. Asking for "Notting Hill" while looking at Paris
// returned an empty map — not because we lack the film's places, but because they are
// in London. The user typed a title, and a title is not a request about here.
//
// So the radius stops deciding what EXISTS and only decides what is marked as here.
export function locationsByDistance(locations, center, radius) {
  return locations
    .map((location) => {
      const distance_km = distanceKm(center, { lat: location.lat, lng: location.lng });
      return { ...location, distance_km, in_radius: distance_km <= radius };
    })
    .sort((first, second) => first.distance_km - second.distance_km);
}

export function selectFirstMatchingWork(locations, workIds, limit, excludeLocationId = null) {
  for (const workId of workIds) {
    const workLocations = locations.filter((location) => location.work_wikidata_id === workId);
    if (workLocations.length) {
      const preciseLocations = isWikidataId(excludeLocationId)
        ? workLocations.filter((location) => location.loc_wikidata_id !== excludeLocationId)
        : workLocations;
      return (preciseLocations.length ? preciseLocations : workLocations).slice(0, limit);
    }
  }
  return [];
}

export function rankNearbyLocations(locations, { limit, maxWorks = 5, maxPerWork = 6 }) {
  const groups = new Map();
  for (const location of locations) {
    const group = groups.get(location.work_wikidata_id) ?? [];
    group.push(location);
    groups.set(location.work_wikidata_id, group);
  }

  return [...groups.values()]
    .sort((first, second) => second.length - first.length)
    .slice(0, maxWorks)
    .flatMap((group) => group.slice(0, maxPerWork))
    .slice(0, limit);
}

export function safeSearchQuery(value) {
  const query = value?.trim();
  if (!query || query.length > 160) return null;
  return query;
}
