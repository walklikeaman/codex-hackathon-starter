// Merging places that are the SAME physical place — and refusing to merge ones that
// merely stand near each other.
//
// The naive version of this feature ("group anything within N metres") was checked
// against the real graph first, and it would have destroyed data. The six closest
// pairs we hold are all DIFFERENT places:
//
//   National Gallery  ↔ Trafalgar Square         95 m — the gallery stands ON the square
//   Trafalgar Square  ↔ London                  100 m — "London" is a CITY centroid
//   Aldwych station   ↔ Strand                  228 m — a station ON a street
//
// Merging the second pair would claim a film was shot on Trafalgar Square when the
// source only ever said "London". So proximity alone is never enough. Three rules:
//
// 1. **Two canonical entities are two places.** Distinct Wikidata Q-ids mean the
//    sources consider them distinct; we do not overrule that.
// 2. **Never merge across precision.** A city centroid and a building are different
//    claims about how well we know a location, and merging them silently upgrades
//    the vaguer one.
// 3. **Names must agree.** Same spot + same name is a duplicate; same spot +
//    different name is a neighbour.

import { haversineMeters } from "./geo.mjs";
import { finiteOrNull } from "./numbers.mjs";

// Places need their own normaliser. `normalizeWorkTitle` folds titles to a-z0-9,
// which is fine for cross-source film titles but empties any name written outside
// the Latin alphabet — "Красная площадь" and "東京タワー" both become "". On a world
// map that would quietly disable deduplication for most of the planet, so this keeps
// Unicode letters and digits and only strips punctuation and accents.
export function normalizePlaceName(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // "Cafés" === "Cafes"
    // Apostrophes are deleted rather than spaced, or "St Paul's" becomes the three
    // words "st paul s" and stops matching "St Pauls" — likewise "O'Connell Street".
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Tight, because the risk is asymmetric: a missed duplicate is clutter, a wrong merge
// is a false claim about where something happened.
export const DEDUP_RADIUS_M = 40;

// Precision buckets that may be compared at all. A place known only to the city is
// never "the same place" as a specific building, however close the centroids fall.
const PRECISE_ENOUGH = new Set(["point", "building", "street"]);

export function metresApart(a, b) {
  const aLat = finiteOrNull(a?.lat);
  const aLng = finiteOrNull(a?.lng);
  const bLat = finiteOrNull(b?.lat);
  const bLng = finiteOrNull(b?.lng);
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;
  return Math.round(haversineMeters([aLat, aLng], [bLat, bLng]));
}

// Do two names refer to the same thing? Normalised equality, plus the common case of
// one being a qualified form of the other ("Bradbury Building" vs "The Bradbury
// Building"). Deliberately NOT fuzzy — "National Gallery" and "National Portrait
// Gallery" are a short edit apart and are different museums.
export function namesMatch(a, b) {
  const left = normalizePlaceName(a);
  const right = normalizePlaceName(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  const [shorter, longer] = leftWords.length <= rightWords.length
    ? [leftWords, rightWords]
    : [rightWords, leftWords];
  // One name fully contains the other AND adds only a leading article-ish word.
  if (longer.length - shorter.length > 1) return false;
  return longer.join(" ").endsWith(shorter.join(" ")) || longer.join(" ").startsWith(shorter.join(" "));
}

// May these two rows be merged? Every rule must pass; any single "no" wins.
export function canMerge(a, b) {
  if (!a || !b) return false;

  // Rule 1 — distinct canonical entities stay distinct.
  if (a.wikidata_id && b.wikidata_id && a.wikidata_id !== b.wikidata_id) return false;

  // Rule 2 — never merge across precision, and never merge two vague points at all.
  const aPrecision = a.geocode_precision ?? "none";
  const bPrecision = b.geocode_precision ?? "none";
  if (aPrecision !== bPrecision) return false;
  if (!PRECISE_ENOUGH.has(aPrecision)) return false;

  // A studio and a street are different kinds of claim even at the same coordinate.
  if ((a.place_class ?? null) !== (b.place_class ?? null)) return false;

  // Rule 3 — same spot AND same name.
  const metres = metresApart(a, b);
  if (metres === null || metres > DEDUP_RADIUS_M) return false;
  return namesMatch(a.name, b.name);
}

// Group places into clusters of the same physical place. Returns one group per real
// place, each listing its members; a place with no duplicate is a group of one.
export function groupPlaces(places) {
  const list = Array.isArray(places) ? places : [];
  const groups = [];

  for (const place of list) {
    // Merging is not transitive here — A may merge with B without B merging with C —
    // so a candidate joins a group only if it can merge with EVERY member.
    const target = groups.find((group) => group.every((member) => canMerge(member, place)));
    if (target) target.push(place);
    else groups.push([place]);
  }
  return groups;
}

// The single pin a group becomes: the most-evidenced member, carrying the union of
// every work seen at that place. Nothing is invented — the coordinate belongs to a
// real member row rather than being averaged into a spot no source ever named.
export function mergeGroup(group) {
  const members = Array.isArray(group) ? group.filter(Boolean) : [];
  if (members.length === 0) return null;

  const primary = [...members].sort((a, b) => {
    const canonical = Number(Boolean(b.wikidata_id)) - Number(Boolean(a.wikidata_id));
    if (canonical !== 0) return canonical;
    return (finiteOrNull(b.confidence) ?? 0) - (finiteOrNull(a.confidence) ?? 0);
  })[0];

  const workIds = new Set();
  for (const member of members) {
    for (const id of member.work_ids ?? []) workIds.add(id);
  }

  return {
    ...primary,
    merged_from: members.map((member) => member.id).filter(Boolean),
    merged_count: members.length,
    work_ids: [...workIds],
  };
}

export function dedupePlaces(places) {
  return groupPlaces(places).map(mergeGroup).filter(Boolean);
}
