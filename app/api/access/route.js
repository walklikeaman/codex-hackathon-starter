// Can a person actually stand there — asked of a whole tour at once (#access).
//
// `place-access.mjs` was written, verified and called by nobody. This is the door it
// needed: the tour builder sends the stops it is considering, and gets back what OSM
// says about getting in. One Overpass request for the batch, because Overpass runs on
// donated hardware and a call per stop is the pace that gets a client blocked.
//
// WHAT THIS ROUTE MAY NOT DO is answer "open" when it does not know. Measured on twelve
// real tour stops, OSM knows about four: The Elephant House, the V&A, St Paul's and
// Leadenhall Market carry hours; Midhope Castle, Doune Castle, Culross and Falkland
// carry nothing an app can read. Silence is reported as `unknown` all the way to the
// client, which then decides — and the one thing nobody may do is turn it into a
// promise on the way.

import {
  ACCESS,
  accessRecordsFromOverpass,
  INTERIOR,
  MAX_PLACES_PER_QUERY,
  overpassAccessQuery,
  overpassError,
} from "../../lib/place-access.mjs";
import { OVERPASS_ENDPOINT, USER_AGENT } from "../../lib/building-snap.mjs";
import { metresApart, normalizePlaceName } from "../../lib/place-dedup.mjs";
import { finiteOrNull } from "../../lib/numbers.mjs";

export const runtime = "nodejs";

// Overpass is slow and this sits in front of somebody waiting to walk somewhere.
// Measured: 6.2s and 6.4s for a twelve-stop batch, 22s for a wider one that asked for
// every named feature instead of the named ones.
const OVERPASS_TIMEOUT_MS = 25000;

// Access changes on the scale of seasons, and the answer is the same for everybody, so
// it is cached at the edge. Short enough that a corrected tag reaches people the same
// week; long enough that a party of ten planning the same walk costs one request.
const CACHE_CONTROL = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

function unknownRecord(place) {
  return {
    id: place.id,
    name: place.name,
    access: ACCESS.unknown,
    interior: INTERIOR.unknown,
    source: null,
  };
}

export function createAccessHandler({
  fetchImpl = fetch,
  endpoint = OVERPASS_ENDPOINT,
  logError = console.warn,
} = {}) {
  return async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Send a JSON body" }, { status: 400 });
    }

    const places = (Array.isArray(body?.places) ? body.places : [])
      .map((place) => ({
        id: String(place?.id ?? "").trim(),
        name: String(place?.name ?? "").trim(),
        lat: finiteOrNull(place?.lat),
        lng: finiteOrNull(place?.lng),
      }))
      // `finiteOrNull`, not Number(): Number("") is 0 and 0 is finite, which is how
      // places end up at Null Island — and here it would ask Overpass about the Gulf of
      // Guinea and report its silence as this place's access.
      .filter((place) => place.id && place.name && place.lat !== null && place.lng !== null)
      .slice(0, MAX_PLACES_PER_QUERY);

    if (places.length === 0) {
      return Response.json({ error: "Send at least one named place with coordinates" }, { status: 400 });
    }

    const query = overpassAccessQuery(places);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });

      // Read the body BEFORE the status, because Overpass says "the server is probably
      // too busy" in an HTML page with HTTP 200 as readily as with a 504.
      const text = await response.text();
      const failure = overpassError(text) ?? (response.ok ? null : `overpass ${response.status}`);
      if (failure) throw new Error(failure);

      const records = accessRecordsFromOverpass(JSON.parse(text), places, {
        // The SAME name, not a close one — `namesMatch` is the right rule for merging
        // two records of one place and the wrong one here, because it accepts a name
        // with one extra word. Live in the browser that turned "Notting Hill Bookshop"
        // into Notting Hill and printed a shop's opening hours as a district's access.
        // A place whose OSM name is spelled differently is reported unknown, which is
        // the direction this module is built to fail in.
        matchesName: (osmName, placeName) =>
          Boolean(normalizePlaceName(osmName))
          && normalizePlaceName(osmName) === normalizePlaceName(placeName),
        distanceM: (place, point) => metresApart(place, point),
      });

      return Response.json(
        { places: places.map((place) => records.get(place.id) ?? unknownRecord(place)) },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      );
    } catch (error) {
      // A busy Overpass is not a verdict about a place. Every stop comes back unknown,
      // which is what it was before the question — never "open", and never an error
      // that would cost the caller its tour.
      logError("access: overpass unavailable", error?.message);
      return Response.json(
        { places: places.map(unknownRecord), degraded: true },
        { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
      );
    }
  };
}

export const POST = createAccessHandler();
