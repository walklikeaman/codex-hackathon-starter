// The inverted search, wired to the map.
//
// `place-search.mjs` was written, verified against the live services and then called by
// nobody — the fourth time in this project that finished work never reached the live
// path. This module is the wiring: it turns the primitives there into the same location
// records `/api/locations` already returns, so a place found by reading the PLACE's
// article appears next to the places found by reading the work's.
//
// What it must never do is let those two look alike. A P915 statement says "this film
// was shot here". An inverted hit says something much weaker and much more interesting:
// this place's own article mentions the work, or one of its characters, or its author.
// Greyfriars Kirkyard is the case — Thomas Riddell's grave is not a filming location and
// is not where the story is set — and the schema now has `inspiration_for` for exactly
// this. But WHICH of those it is cannot be read off a search result, so every record
// here arrives as a CANDIDATE: shown, labelled as unverified, and never presented as a
// filming location. Turning one into a claim means quoting the sentence and checking it
// verbatim, which is `wikipedia-extract.mjs`'s job and the next step after this one.

import {
  buildEntityFanoutQuery,
  buildInvertedSearch,
  buildSearchUrl,
  candidatesFromSearch,
  namesFromFanout,
  WIKIDATA_SPARQL,
} from "./place-search.mjs";
import { metresApart, namesMatch } from "./place-dedup.mjs";

export const INVERTED_RELATION_KIND = "candidate";
export const INVERTED_EVIDENCE_SOURCE = "wikipedia_mention";

// Wikimedia requires a real contact; a placeholder domain is itself a policy violation.
export const USER_AGENT =
  "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/; nakonechnyi.n@gmail.com)";

// Two round trips per work search, and no more. This runs on the interactive path
// behind somebody waiting for a map, so the budget is one fan-out and one search —
// measured together at 377 ms (Harry Potter), 534 ms (Philosopher's Stone) and 553 ms
// (Outlander) against the live services, on top of a title search that already costs
// seconds.
const FANOUT_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 8000;

// A hit within this distance of a place we already have, under a matching name, is the
// same place found twice. Wider than `place-dedup`'s 40 m because the two coordinates
// come from different sources: Wikidata's item and Wikipedia's article carry their own
// points for the same thing, and measured on Greyfriars Kirkyard they are 48 m apart —
// far enough that the 40 m rule would have shown it twice. The name test does the real
// work here; the radius only stops two same-named places in one city from merging.
export const SAME_PLACE_RADIUS_M = 150;

async function readJson(url, { fetchImpl, timeoutMs, accept = "application/json" }) {
  const response = await fetchImpl(url, {
    headers: { Accept: accept, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

// Wikimedia answers a missing page AND a lagged replica with HTTP 200 and an error in
// the body, so a status check alone reports success for a search that never ran.
function apiError(payload) {
  const error = payload?.error;
  if (!error) return null;
  return error.code ? `${error.code}: ${error.info ?? ""}`.trim() : "unknown api error";
}

export async function fanoutNames(workQid, { fetchImpl = fetch } = {}) {
  const query = buildEntityFanoutQuery(workQid);
  if (!query) return [];

  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");

  const payload = await readJson(url, {
    fetchImpl,
    timeoutMs: FANOUT_TIMEOUT_MS,
    accept: "application/sparql-results+json",
  });
  return namesFromFanout(payload);
}

// Is this hit a place we already have? Name and distance must BOTH agree: the same
// article can be reached by both paths, and showing Greyfriars twice — once as a
// filming location and once as a candidate — would be the map contradicting itself.
export function isAlreadyKnown(candidate, locations) {
  return (Array.isArray(locations) ? locations : []).some((known) => {
    if (!namesMatch(candidate.title, known.loc_name)) return false;
    const metres = metresApart(
      { lat: candidate.lat, lng: candidate.lng },
      { lat: known.lat, lng: known.lng },
    );
    return metres !== null && metres <= SAME_PLACE_RADIUS_M;
  });
}

// The sentence a person reads on the card. It says what we actually know — that the
// place's article mentions the work — and does not say where anything was filmed.
function candidateDescription(place, workTitle) {
  return `${place}'s own Wikipedia article mentions ${workTitle}. `
    + "Found by searching the place, not the work — the connection is unverified, and it "
    + "may be where something was named, written or imagined rather than filmed.";
}

export function toLocationRecords(candidates, { work, kind }) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    work_wikidata_id: work.id,
    work_title: work.title,
    work_year: work.year ?? null,
    kind,
    // No Q-id: this came from a Wikipedia page, and pretending otherwise would put a
    // fake identifier into the field every other part of the app trusts as canonical.
    loc_wikidata_id: null,
    loc_source_id: `wikipedia:${candidate.pageid}`,
    loc_name: candidate.title,
    lat: candidate.lat,
    lng: candidate.lng,
    commons_image: null,
    film_tmdb_id: null,
    relation_kind: INVERTED_RELATION_KIND,
    relation_property: null,
    relation_label: "Possible connection",
    relation_description: candidateDescription(candidate.title, work.title),
    // Wikipedia's own one-line description, standing in for the P31 a Wikipedia page
    // does not have. Without it every candidate is ungraded, and Edinburgh — a city of
    // half a million — arrives on the map as a dot somebody could stand on.
    place_types: candidate.description ? [candidate.description] : [],
    evidence_source: INVERTED_EVIDENCE_SOURCE,
    source_title: "Wikipedia article",
    source_url: `https://en.wikipedia.org/?curid=${candidate.pageid}`,
  }));
}

// Every place near the viewport whose own article mentions this work.
//
// Returns `[]` rather than throwing on any failure. This runs ALONGSIDE a search that
// has already succeeded, so a Wikimedia hiccup must cost the extra candidates and never
// the map the person asked for.
export async function findInvertedPlaces({
  work,
  kind = "film",
  center,
  radiusKm,
  limit = 10,
  exclude = [],
  fetchImpl = fetch,
  onError = null,
} = {}) {
  if (!work?.id || !work?.title) return [];

  try {
    const names = await fanoutNames(work.id, { fetchImpl });
    // The title leads: it is the one name guaranteed to be about this work, and for a
    // work with no characters in Wikidata it is the only one there is.
    const query = buildInvertedSearch({ names: [work.title, ...names], center, radiusKm });
    if (!query) return [];

    const payload = await readJson(buildSearchUrl(query, { limit: Math.min(limit * 2, 50) }), {
      fetchImpl,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    const failure = apiError(payload);
    if (failure) throw new Error(failure);

    const candidates = candidatesFromSearch(payload)
      .filter((candidate) => !isAlreadyKnown(candidate, exclude))
      .slice(0, limit);

    return toLocationRecords(candidates, { work, kind });
  } catch (error) {
    onError?.(error);
    return [];
  }
}
