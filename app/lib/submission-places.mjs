// The queue, on the map.
//
// Measured 05.08: the database holds **38,270 submissions, every one of them pending,
// 30,212 with a coordinate**, covering 6,054 works — and **not one route in `app/` reads
// that table**. The live map answers from Wikidata alone, which is why a title search
// finds places for 15 works while the ingest has facts for six thousand.
//
// So this is not a new source. It is the door to the work we already did.
//
// WHAT IT MUST NOT DO is promote them. A submission is `pending` because nobody has
// checked it: it arrives on the map as a CANDIDATE — the same hollow pin, the same
// "unverified" note and the same link to its source as an inverted-search hit — and it
// stays out of `places`, out of the graph, and out of anything that claims to be
// verified. Showing an unchecked claim, labelled as unchecked, is honest. Quietly
// turning 30,000 of them into map pins that look like the verified ones would undo the
// whole grounding rule in one commit.

import { finiteOrNull } from "./numbers.mjs";
import { metresApart, namesMatch } from "./place-dedup.mjs";

export const SUBMISSION_RELATION_KIND = "candidate";

// Owner's decision, 05.08: take every source and mark it unverified rather than throwing
// candidates away. "Somebody said something happened here" is a lead worth showing, as
// long as the card says exactly that and links to whoever said it.
//
// The list is kept — empty — because the mechanism is the point: the day a source has to
// be pulled from the product, this is where it goes, and no other code has to change.
export const REFUSED_SOURCES = Object.freeze([]);

// What each source is called on the card, and what its link is called.
const SOURCE_LABELS = {
  moviemaps: { evidence: "moviemaps", title: "MovieMaps entry", who: "MovieMaps" },
  wikipedia: { evidence: "wikipedia_extract", title: "Wikipedia article", who: "Wikipedia" },
  permit_record: { evidence: "film_permit", title: "Filming permit record", who: "a city filming permit" },
  reelstreets: { evidence: "reelstreets", title: "Reelstreets entry", who: "Reelstreets" },
  movielocations: { evidence: "movielocations", title: "MovieLocations entry", who: "MovieLocations" },
  // The only source whose sentence a person can check by standing in front of it.
  open_plaques: {
    evidence: "open_plaques",
    title: "The plaque on the wall",
    who: "a commemorative plaque at this address",
  },
};

export function isRefusedSource(sourceKind) {
  return REFUSED_SOURCES.includes(String(sourceKind ?? ""));
}

// How this row was tied to the work the person searched for. It belongs on the card,
// because the two are not equally strong and pretending otherwise is the quiet kind of
// lie this project keeps finding in itself.
export const MATCHED_BY = Object.freeze({
  id: "id",       // the same IMDb or TMDB identifier — one work, no doubt
  title: "title", // the same title and kind — probably the same work, possibly a namesake
});

// A sentence that says exactly what this is: somebody's claim, from a named source, not
// yet checked by us. The source's own sentence leads when it has one — a permit record
// and a Wikipedia line both say more than any template could.
function submissionDescription(row, workTitle, matchedBy) {
  const place = row.place_name;
  const who = SOURCE_LABELS[row.source_kind]?.who ?? "an external source";
  const stated = String(row.source_sentence ?? "").trim();
  // Said plainly rather than hedged: the title matched, the identifier did not, and a
  // work can share a title with a different work — Doctor Who is two series under one
  // name, and Gladiator is two films.
  const caveat = matchedBy === MATCHED_BY.title
    ? ` Matched to ${workTitle} by title, not by identifier — check it is the same work.`
    : "";

  if (stated) return `${stated} — recorded for ${workTitle} by ${who}, not yet verified by us.${caveat}`;
  return `${place} is listed as a location for ${workTitle} by ${who}. Not yet verified by us.${caveat}`;
}

export function submissionToLocation(row, { work, kind, matchedBy = MATCHED_BY.id }) {
  const lat = finiteOrNull(row?.lat);
  const lng = finiteOrNull(row?.lng);
  if (lat === null || lng === null) return null;
  if (!String(row?.place_name ?? "").trim()) return null;

  const labels = SOURCE_LABELS[row.source_kind] ?? { evidence: "submission", title: "Source record" };

  return {
    work_wikidata_id: work.id,
    work_title: work.title,
    work_year: work.year ?? null,
    kind,
    // It is a queue row, not a canonical place. The id says which one, so a reviewer can
    // find it, and no part of the app can mistake it for a Wikidata item.
    loc_wikidata_id: null,
    loc_source_id: `submission:${row.id}`,
    loc_name: row.place_name,
    lat,
    lng,
    commons_image: null,
    film_tmdb_id: null,
    relation_kind: SUBMISSION_RELATION_KIND,
    relation_property: null,
    relation_label: matchedBy === MATCHED_BY.title ? "In review · matched by title" : "In review",
    relation_description: submissionDescription(row, work.title, matchedBy),
    matched_by: matchedBy,
    // The area the source named, when it gave one — "Top of Bevington Road" is more use
    // than a dot, and it is what a reviewer checks against.
    place_types: row.area_hint ? [row.area_hint] : [],
    evidence_source: labels.evidence,
    source_title: labels.title,
    source_url: row.source_url ?? null,
  };
}

// The same place found twice is the map contradicting itself, and here it is likely:
// MovieMaps and Wikidata both know Alnwick Castle.
export function isAlreadyShown(candidate, shown) {
  return (Array.isArray(shown) ? shown : []).some((known) => {
    if (!namesMatch(candidate.loc_name, known.loc_name)) return false;
    const metres = metresApart(
      { lat: candidate.lat, lng: candidate.lng },
      { lat: known.lat, lng: known.lng },
    );
    return metres !== null && metres <= 150;
  });
}

// Nearest to what the person is looking at, and bounded. Person of Interest alone has
// 961 rows in the queue; a map that draws all of them is not a map.
export function selectSubmissionPlaces(rows, {
  work, kind, center, limit = 12, exclude = [], matchedBy = MATCHED_BY.id,
}) {
  const shown = [...exclude];
  const chosen = [];

  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => !isRefusedSource(row?.source_kind))
    .map((row) => submissionToLocation(row, { work, kind, matchedBy: row.matched_by ?? matchedBy }))
    .filter(Boolean)
    .map((location) => ({
      location,
      metres: metresApart(
        { lat: location.lat, lng: location.lng },
        { lat: finiteOrNull(center?.lat) ?? 0, lng: finiteOrNull(center?.lng) ?? 0 },
      ) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.metres - right.metres);

  for (const { location } of ordered) {
    if (chosen.length >= limit) break;
    if (isAlreadyShown(location, shown)) continue;
    chosen.push(location);
    shown.push(location);
  }

  return chosen;
}
