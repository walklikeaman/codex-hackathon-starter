import { NextResponse } from "next/server";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULTS = { lat: 51.5072, lng: -0.1276, radius: 15, limit: 100 };
const WORK_QUERIES = [
  {
    kind: "film",
    statement: `
      ?work wdt:P31 wd:Q11424 ;
            wdt:P915 ?location .
      BIND("film" AS ?kind)
      BIND("filming" AS ?locationSource)`,
  },
  {
    kind: "series",
    statement: `
      ?work wdt:P31/wdt:P279* wd:Q5398426 ;
            ?locationProperty ?location .
      VALUES ?locationProperty { wdt:P915 wdt:P840 }
      BIND("series" AS ?kind)
      BIND(IF(?locationProperty = wdt:P840, "narrative", "filming") AS ?locationSource)`,
  },
  {
    kind: "book",
    geoFirst: false,
    statement: `
      hint:Query hint:optimizer "None" .
      ?work wdt:P31 wd:Q571 ;
            wdt:P840 ?location .
      BIND("book" AS ?kind)
      BIND("narrative" AS ?locationSource)`,
  },
];

function numberParam(value, fallback, { min, max }) {
  if (value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function wikidataId(uri) {
  return uri?.match(/Q\d+$/)?.[0] ?? null;
}

function coordinates(wkt) {
  const match = wkt?.match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
  return match ? { lng: Number(match[1]), lat: Number(match[2]) } : null;
}

function releaseYear(value) {
  return Number(value?.match(/^([+-]?\d{1,6})-/)?.[1]) || null;
}

function isPlaceholderLabel(value) {
  return /^Q\d+(?:\s|$)/.test(value?.trim() ?? "");
}

function sparql({ lat, lng, radius, limit, statement, geoFirst = true }) {
  const around = `
    SERVICE wikibase:around {
      ?location wdt:P625 ?coord .
      bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "${radius}" .
    }`;

  return `
SELECT ?work ?workLabel ?location ?locationLabel ?coord ?kind ?locationSource ?releaseDate ?inceptionDate ?image WHERE {
  ${geoFirst ? around : ""}
  ${statement}
  ${geoFirst ? "" : around}
  OPTIONAL { ?work wdt:P577 ?releaseDate . }
  OPTIONAL { ?work wdt:P571 ?inceptionDate . }
  OPTIONAL { ?location wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru" . }
}
LIMIT ${limit}`;
}

function balanceKinds(locationMap, limit) {
  const groups = { film: [], series: [], book: [] };

  for (const location of locationMap.values()) {
    groups[location.kind]?.push(location);
  }

  const balanced = [];
  while (balanced.length < limit && Object.values(groups).some((group) => group.length)) {
    for (const kind of ["film", "series", "book"]) {
      const location = groups[kind].shift();
      if (location) balanced.push(location);
      if (balanced.length === limit) break;
    }
  }

  return balanced;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberParam(searchParams.get("lat"), DEFAULTS.lat, { min: -90, max: 90 });
  const lng = numberParam(searchParams.get("lng"), DEFAULTS.lng, { min: -180, max: 180 });
  const radius = numberParam(searchParams.get("radius"), DEFAULTS.radius, { min: 0.1, max: 50 });
  const limit = numberParam(searchParams.get("limit"), DEFAULTS.limit, { min: 1, max: 200 });

  if ([lat, lng, radius, limit].some((value) => value === null)) {
    return NextResponse.json(
      { error: "lat, lng, radius, and limit must be valid numbers within the supported range" },
      { status: 400 },
    );
  }

  try {
    const perKindLimit = Math.max(10, Math.ceil(limit / WORK_QUERIES.length) * 2);
    const results = await Promise.allSettled(WORK_QUERIES.map(async ({ kind, statement, geoFirst }) => {
      const endpoint = new URL(WIKIDATA_ENDPOINT);
      endpoint.searchParams.set("query", sparql({ lat, lng, radius, limit: perKindLimit, statement, geoFirst }));
      endpoint.searchParams.set("format", "json");

      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "SceneMap/1.0 (film-book-series location map API)",
        },
        signal: AbortSignal.timeout(30_000),
        next: { revalidate: 3600 },
      });

      if (!response.ok) throw new Error(`${kind}: Wikidata responded with ${response.status}`);
      return response.json();
    }));

    const payloads = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    if (!payloads.length) throw new Error("Wikidata returned no successful work-location responses");

    const locations = new Map();

    for (const payload of payloads) {
      for (const row of payload.results.bindings) {
      const workWikidataId = wikidataId(row.work?.value);
      const locWikidataId = wikidataId(row.location?.value);
      const point = coordinates(row.coord?.value);
      if (!workWikidataId || !locWikidataId || !point) continue;

      const kind = row.kind?.value;
      if (!Object.hasOwn({ film: true, series: true, book: true }, kind)) continue;

      const workTitle = row.workLabel?.value ?? workWikidataId;
      const locationName = row.locationLabel?.value ?? locWikidataId;
      if (isPlaceholderLabel(workTitle) || isPlaceholderLabel(locationName)) continue;

      const key = `${kind}:${workWikidataId}:${locWikidataId}`;
      const current = locations.get(key);
        locations.set(key, current ?? {
        work_wikidata_id: workWikidataId,
        work_title: workTitle,
        work_year: releaseYear(row.releaseDate?.value ?? row.inceptionDate?.value),
        kind,
        location_source: row.locationSource?.value ?? null,
        loc_wikidata_id: locWikidataId,
        loc_name: locationName,
        lat: point.lat,
        lng: point.lng,
        commons_image: row.image?.value ?? null,
        });
      }
    }

    return NextResponse.json(
      {
        center: { lat, lng },
        radius_km: radius,
        locations: balanceKinds(locations, limit),
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    console.error("Wikidata locations request failed", error);
    return NextResponse.json({ error: "Unable to retrieve work locations from Wikidata" }, { status: 502 });
  }
}
