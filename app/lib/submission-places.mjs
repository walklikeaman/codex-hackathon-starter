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

// Sources whose terms forbid taking the data, regardless of who is paying. The project
// is not commercial and that changes what LICENCES allow; it changes nothing about a
// site's terms of use, which forbid the act itself ([[source-evaluation]]).
//
// 8,063 reelstreets rows are already in the queue — 27 of them with coordinates — and
// they are filtered here rather than deleted, because deleting somebody else's ingest is
// their call and hiding it from the product is ours.
export const REFUSED_SOURCES = Object.freeze(["reelstreets"]);

// What each source is called on the card, and what its link is called.
const SOURCE_LABELS = {
  moviemaps: { evidence: "moviemaps", title: "MovieMaps entry" },
  wikipedia: { evidence: "wikipedia_extract", title: "Wikipedia article" },
  permit_record: { evidence: "film_permit", title: "Filming permit record" },
};

export function isRefusedSource(sourceKind) {
  return REFUSED_SOURCES.includes(String(sourceKind ?? ""));
}

// A sentence that says exactly what this is: somebody's claim, from a named source, not
// yet checked by us. The source's own sentence leads when it has one — a permit record
// and a Wikipedia line both say more than any template could.
function submissionDescription(row, workTitle) {
  const place = row.place_name;
  const stated = String(row.source_sentence ?? "").trim();
  if (stated) return `${stated} — recorded for ${workTitle}, not yet verified by us.`;
  return `${place} is listed as a location for ${workTitle} by ${
    SOURCE_LABELS[row.source_kind]?.title ?? "an external source"
  }. Not yet verified by us.`;
}

export function submissionToLocation(row, { work, kind }) {
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
    relation_label: "In review",
    relation_description: submissionDescription(row, work.title),
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
export function selectSubmissionPlaces(rows, { work, kind, center, limit = 12, exclude = [] }) {
  const shown = [...exclude];
  const chosen = [];

  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => !isRefusedSource(row?.source_kind))
    .map((row) => submissionToLocation(row, { work, kind }))
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
