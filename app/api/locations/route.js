import { NextResponse } from "next/server";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULTS = { lat: 51.5072, lng: -0.1276, radius: 15, limit: 100 };

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

function sparql({ lat, lng, radius, limit }) {
  return `
SELECT ?work ?workLabel ?location ?locationLabel ?coord ?releaseDate ?image WHERE {
  SERVICE wikibase:around {
    ?location wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radius}" .
  }
  ?work wdt:P31 wd:Q11424 ;
        wdt:P915 ?location .
  OPTIONAL { ?work wdt:P577 ?releaseDate . }
  OPTIONAL { ?location wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru" . }
}
LIMIT ${limit * 3}`;
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

  const endpoint = new URL(WIKIDATA_ENDPOINT);
  endpoint.searchParams.set("query", sparql({ lat, lng, radius, limit }));
  endpoint.searchParams.set("format", "json");

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "SceneMap/1.0 (film-location map API)",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      throw new Error(`Wikidata responded with ${response.status}`);
    }

    const payload = await response.json();
    const locations = new Map();

    for (const row of payload.results.bindings) {
      const workWikidataId = wikidataId(row.work?.value);
      const locWikidataId = wikidataId(row.location?.value);
      const point = coordinates(row.coord?.value);
      if (!workWikidataId || !locWikidataId || !point) continue;

      const key = `${workWikidataId}:${locWikidataId}`;
      const current = locations.get(key);
      locations.set(key, current ?? {
        work_wikidata_id: workWikidataId,
        work_title: row.workLabel?.value ?? workWikidataId,
        work_year: releaseYear(row.releaseDate?.value),
        kind: "film",
        loc_wikidata_id: locWikidataId,
        loc_name: row.locationLabel?.value ?? locWikidataId,
        lat: point.lat,
        lng: point.lng,
        commons_image: row.image?.value ?? null,
      });
    }

    return NextResponse.json(
      {
        center: { lat, lng },
        radius_km: radius,
        locations: [...locations.values()].slice(0, limit),
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    console.error("Wikidata locations request failed", error);
    return NextResponse.json({ error: "Unable to retrieve filming locations from Wikidata" }, { status: 502 });
  }
}
