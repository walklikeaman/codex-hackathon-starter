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

  return `
SELECT ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription
       (MIN(?date) AS ?releaseDate)
       (SAMPLE(?placeImage) AS ?image)
       (SAMPLE(?tmdb) AS ?tmdbId)
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
    ?location schema:description ?locationDescription .
    FILTER(LANG(?locationDescription) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru" . }
}
GROUP BY ?work ?workLabel ?location ?locationLabel ?coord ?locationDescription`;
}

export function buildWikidataSearchUrl(query, limit = 8) {
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

function entityClaimValues(entity, property) {
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

export function normalizeWikidataEntityLocations(workEntity, locationEntities, { kind }) {
  const config = workKindConfig(kind);
  if (!config || !isWikidataId(workEntity?.id)) return [];

  const entities = locationEntities instanceof Map
    ? locationEntities
    : new Map(Object.entries(locationEntities ?? {}));
  const workTitle = entityText(workEntity, "labels") ?? workEntity.id;
  if (isPlaceholderLabel(workTitle)) return [];
  const workYear = entityReleaseYear(workEntity);

  return entityClaimIds(workEntity, config.locationProperty).flatMap((locationId) => {
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
      relation_kind: config.relationKind,
      relation_property: config.locationProperty,
      relation_label: config.relationLabel,
      relation_description: relationDescription({
        workTitle,
        place,
        kind,
        locationDescription: entityText(locationEntity, "descriptions"),
      }),
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

function relationDescription({ workTitle, place, kind, locationDescription }) {
  const relation = kind === "book"
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
