// Matching the same place across scraped sources — pure helpers.
//
// Three sites independently name places for the same films. Where two of them
// name the same place for the same work, that agreement is evidence: not one
// site's contributor being trusted twice, but two sets of people arriving at the
// same address separately. `place-review.mjs` has no signal for this today, and
// it is the only kind of corroboration our data actually contains at scale.
//
// It also carries a coordinate. moviemaps holds 30,153 points; reelstreets holds
// 27 and movie-locations none, and 13,819 rows are refused by the review gate
// before any scoring simply for having no point. A matched pair lets the
// pointless row borrow one that a contributor measured — which is a different
// fact from having measured it ourselves, so it is recorded as such rather than
// written into lat/lng as though the source had supplied it.
//
// The matching is deliberately narrow: same WORK, and a name match by
// place-dedup's own rule. Nothing fuzzy, and nothing across works — two films
// shooting on the same street is a real thing, but it is not evidence about
// either film's claim.

import { namesMatch, normalizePlaceName } from "./place-dedup.mjs";

// A source's own pin is worth more than a borrowed one, and moviemaps is the
// only scrape that measures its own. Ordering decides which row donates.
export const COORDINATE_DONORS = Object.freeze(["moviemaps", "permit_record", "wikipedia"]);

export function hasPoint(row) {
  return Number.isFinite(row?.lat) && Number.isFinite(row?.lng);
}

// Group one work's submissions into clusters of the same place. A cluster with
// members from two different sources is corroborated; a cluster of one is not.
//
// Greedy single-pass grouping: a row joins the first cluster it matches. Names
// that match are near-identical by place-dedup's rule, so ordering cannot
// meaningfully change the partition, and the alternative — all-pairs closure —
// would let A~B and B~C drag together an A and C that do not match.
export function clusterByPlace(rows) {
  const clusters = [];
  for (const row of rows ?? []) {
    if (!normalizePlaceName(row?.place_name)) continue;
    const found = clusters.find((cluster) =>
      cluster.some((member) => namesMatch(member.place_name, row.place_name)));
    if (found) found.push(row);
    else clusters.push([row]);
  }
  return clusters;
}

// What one cluster says about each of its members.
//
// Returns one entry per row that gains something: the sources that agree with
// it, and a coordinate when it has none and a donor in the cluster does.
export function corroborationsFor(cluster) {
  const sources = new Set((cluster ?? []).map((r) => r.source_kind));
  if (sources.size < 2) return [];  // one site agreeing with itself is not evidence

  const donor = (cluster ?? [])
    .filter((r) => hasPoint(r) && COORDINATE_DONORS.includes(r.source_kind))
    .sort((a, b) => COORDINATE_DONORS.indexOf(a.source_kind) - COORDINATE_DONORS.indexOf(b.source_kind))[0] ?? null;

  const updates = [];
  for (const row of cluster) {
    const others = cluster.filter((other) => other.id !== row.id && other.source_kind !== row.source_kind);
    if (others.length === 0) continue;

    const update = {
      id: row.id,
      corroborated_by: others.map((other) => ({
        source_kind: other.source_kind,
        submission_id: other.id,
        place_name: other.place_name,
        gave_coordinate: false,
      })),
    };

    // A row with no point borrows one — and says so. geocode_reason names the
    // mechanism so a later reader can tell a borrowed point from a measured one
    // without joining anything.
    if (!hasPoint(row) && donor && donor.id !== row.id) {
      update.lat = donor.lat;
      update.lng = donor.lng;
      update.geocode_source = `${donor.source_kind}_via_corroboration`;
      update.geocode_source_id = donor.id;
      update.geocode_license = "unstated";
      update.geocode_reason = "matched_place_in_another_source";
      const entry = update.corroborated_by.find((c) => c.submission_id === donor.id);
      if (entry) entry.gave_coordinate = true;
    }

    updates.push(update);
  }
  return updates;
}

// Every update implied by one work's submissions.
export function corroborateWork(rows) {
  return clusterByPlace(rows).flatMap(corroborationsFor);
}
