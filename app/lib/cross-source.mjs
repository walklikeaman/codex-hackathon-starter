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

// Words that name a KIND of place rather than the place. Two names sharing only
// these are two different things of the same type — "Broughton Castle" and
// "Arundel Castle", "560 Granville Street" and "Smithfield Street". Judged over
// 4,681 near-miss pairs: in the least similar band this single filter removes
// 2,235 of 2,733 as noise.
const GENERIC_PLACE_WORDS = new Set([
  "street", "road", "avenue", "lane", "place", "square", "court", "drive", "way",
  "park", "garden", "gardens", "castle", "abbey", "church", "cathedral", "hotel",
  "station", "bridge", "house", "building", "tower", "hall", "centre", "center",
  "club", "school", "college", "university", "library", "theatre", "theater",
  "cinema", "museum", "palace", "mansion", "bank", "market", "beach", "island",
  "river", "lake", "mountain", "hill", "boulevard", "terrace", "crescent",
  "close", "walk", "yard", "gate", "cross", "green", "common", "wood", "farm",
  "manor", "city", "town", "village",
  // Directions and size words qualify a name, they do not make one.
  "north", "south", "east", "west", "upper", "lower", "great", "little", "old",
  "new", "saint",
]);

const SHORT_WORDS = new Set(["the", "of", "a", "in", "at", "on", "and", "st", "de", "la", "le"]);

// How much of the two names must coincide. Chosen from judgement rather than
// taste: every pair sampled at 0.4 and above was a true match — "Rosslyn
// Chapel" against "Rosslyn Chapel, Roslin, Midlothian", "Jacob Wirth" against
// "Jacob Wirth, Stuart Street, Boston" — while below it the pairs are things
// like "Astoria Boulevard Station" against "31st Street at Ditmars Boulevard".
export const NAME_OVERLAP = 0.4;

function meaningfulWords(value) {
  return new Set(
    normalizePlaceName(value).split(" ").filter((w) => w.length > 3 && !SHORT_WORDS.has(w)),
  );
}

// Do these two names describe the same place, for the purpose of CORROBORATION?
//
// Looser than place-dedup's namesMatch on purpose, and the asymmetry is the
// reason: merging two rows into one place makes a claim about the world, while
// agreeing that two sources describe the same spot only raises a candidate
// towards review. So the same three sites writing "West Wycombe Park,
// Buckinghamshire" and "West Wycombe Park, West Wycombe, Buckinghamshire" can
// corroborate each other here without place-dedup being relaxed anywhere.
//
// Two conditions, both required. The shared words must include one that is not
// merely the KIND of place, and enough of the two names must coincide.
export function describeSamePlace(a, b) {
  if (namesMatch(a, b)) return true;   // the strict rule still wins outright

  const left = meaningfulWords(a);
  const right = meaningfulWords(b);
  if (left.size === 0 || right.size === 0) return false;

  const shared = [...left].filter((word) => right.has(word));
  if (shared.length === 0) return false;
  if (!shared.some((word) => !GENERIC_PLACE_WORDS.has(word))) return false;

  // The trap this rule fell into first: "National Gallery" and "National
  // Portrait Gallery" share every word of the shorter name and differ by one
  // inserted inside the NAME, which makes them different institutions standing
  // in the same square. Where the extra words are administrative context they
  // arrive as their own comma-separated part — "Rosslyn Chapel, Roslin,
  // Midlothian" — so a part of the longer name still reads exactly as the
  // shorter one.
  //
  // So a strict subset is accepted only when some part of the longer name is
  // the shorter name entire. This knowingly loses true matches where the extra
  // word sits inside the name and is harmless — "Old Royal Naval College"
  // against "the Painted Hall of the Royal Naval College" — and that is the
  // right direction to be wrong in: a false agreement tells a reviewer two
  // sources concur when only one does.
  const subset = [...left].every((w) => right.has(w)) || [...right].every((w) => left.has(w));
  const sameSize = left.size === right.size;
  if (subset && !sameSize) {
    const [shorter, longer] = left.size < right.size ? [left, b] : [right, a];
    const partMatchesWhole = longer
      .split(",")
      .map((part) => meaningfulWords(part))
      .some((part) => part.size === shorter.size && [...shorter].every((w) => part.has(w)));
    if (!partMatchesWhole) return false;
    return true;
  }

  const union = new Set([...left, ...right]).size;
  return shared.length / union >= NAME_OVERLAP;
}

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
      cluster.some((member) => describeSamePlace(member.place_name, row.place_name)));
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
