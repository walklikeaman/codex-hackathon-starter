// A verified queue row, become a fact.
//
// The review has produced verdicts since August and **not one of them ever reached the
// graph**: measured 21.09.2026, 4,703 rows say `verified` and `location_submissions.place_id`
// is null on every one of 45,448. So the map draws 70 places worldwide, the panel reads
// "Checked places · 0 places" over Los Angeles, and every list in the product carries the
// line "named by our sources · not checked by us" — while the rows that ARE checked sit in
// a table nothing reads.
//
// This module is the missing step, and it is deliberately only the arithmetic: which rows
// are the same place, what a `places` row says about them, and what evidence is filed. The
// writing is in scripts/promote-verified.mjs.
//
// ---------------------------------------------------------------------------------------
//
// **Two rows are the same place when they are at the same point, under a name that
// matches.** Both halves are needed, and the project's own rules are used rather than new
// ones: `metresApart` with `DEDUP_RADIUS_M`, and `namesMatch`, which refuses "National
// Gallery" against "National Portrait Gallery" and allows one extra word, no more. A wrong
// merge is a false claim that two films were shot in one building.
//
// **A Wikidata id is an identity and it wins.** Two rows carrying Q180788 are one place
// however their scrapers spelled the name, and `places.wikidata_id` is unique — so the id
// decides first, and geometry only settles what is left.

import { DEDUP_RADIUS_M, metresApart, namesMatch, normalizePlaceName } from "./place-dedup.mjs";
import { finiteOrNull } from "./numbers.mjs";
import { studioLotAt } from "./studio-lots.mjs";

// What the graph is told about where the point came from.
//
// A scraped coordinate is a point somebody published beside a name; it is not a geocode,
// and calling it `building` would be inventing a precision nobody measured. `point` is
// claimed only when the row carries a Wikidata entity, because then the coordinate IS that
// entity's own. Everything else says `none` — we hold a point and make no claim about what
// it is a point OF.
export function geocodePrecisionFor(row) {
  return isWikidataId(row?.wikidata_id) ? "point" : "none";
}

function isWikidataId(value) {
  return typeof value === "string" && /^Q[1-9]\d*$/.test(value);
}

// `{ lat, lng }`, which is the shape `metresApart` reads — passing it a `[lat, lng]` pair
// returns null, and a null distance silently compares as "not near", so every group would
// have been one row.
export function positionOf(row) {
  const lat = finiteOrNull(row?.lat);
  const lng = finiteOrNull(row?.lng);
  if (lat === null || lng === null) return null;
  // (0, 0) is a legal coordinate and the signature of a number that was never parsed.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

// The shortest name in the group, which is the least likely to be a sentence about the
// scene — the same rule the map already uses when it has to name a point held by several
// rows.
export function bestName(rows) {
  const names = rows
    .map((row) => String(row?.place_name ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names[0] ?? null;
}

// One group of rows that are the same place. Q-id first, geometry second.
export function groupIntoPlaces(rows, { radiusM = DEDUP_RADIUS_M } = {}) {
  const groups = [];
  const byWikidata = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const position = positionOf(row);
    if (!position) continue;

    if (isWikidataId(row.wikidata_id)) {
      const existing = byWikidata.get(row.wikidata_id);
      if (existing) { existing.rows.push(row); continue; }
      const group = { wikidataId: row.wikidata_id, rows: [row], position };
      byWikidata.set(row.wikidata_id, group);
      groups.push(group);
      continue;
    }

    // Only against groups that have no identity of their own: a row without a Q-id must
    // not be merged into one that has, because their coordinates agreeing says nothing
    // about whether the scraper meant that entity.
    const near = groups.find((group) => !group.wikidataId
      && metresApart(group.position, position) <= radiusM
      && namesMatch(bestName(group.rows), row.place_name));

    if (near) near.rows.push(row);
    else groups.push({ wikidataId: null, rows: [row], position });
  }

  return groups;
}

// The place a group becomes. `confidence` is the review's own score for the strongest row
// in it — not an average, and not a count: a group is as good as its best evidence, and
// averaging would let two weak rows dilute one strong one into pending.
export function placeFromGroup(group, { scoreOf } = {}) {
  const rows = group?.rows ?? [];
  const lead = rows[0];
  if (!lead) return null;
  const position = group.position ?? positionOf(lead);
  if (!position) return null;

  const { lat, lng } = position;
  const lot = studioLotAt(lat, lng);
  const scores = rows.map((row) => (typeof scoreOf === "function" ? Number(scoreOf(row)) : 1));
  const confidence = Math.min(1, Math.max(...scores.filter(Number.isFinite), 0));

  return {
    wikidata_id: group.wikidataId ?? null,
    name: bestName(rows),
    lat,
    lng,
    // We know where it is, not what it is. `place-grade.mjs` decides pin-or-area from type
    // labels we do not have here, and guessing "real_exterior" would be a claim about the
    // inside of a building nobody looked at.
    place_class: "unknown",
    geocode_precision: geocodePrecisionFor(lead),
    // The camera was here; the scene is set somewhere else. Decided by the polygon, never
    // by the name.
    shot_on_set: Boolean(lot),
    confidence,
    confidence_band: "verified",
    status: "verified",
    status_reason: lead.status_reason ?? null,
  };
}

// One evidence row per submission, because the ledger's rule is one row = one signal.
//
// `text_mention` is the honest method: the source published a sentence naming this place,
// on a page we can link to. Not `web_search_cited` — nobody searched — and not
// `manual_fix`, which would claim a person looked.
export function evidenceFromRows(placeId, rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    subject_type: "place",
    subject_id: placeId,
    method: "text_mention",
    source_url: row.source_url ?? null,
    source_ref: row.source_kind ?? null,
    snippet: row.source_sentence ? String(row.source_sentence).slice(0, 500) : null,
    agrees: true,
  }));
}

// The work↔place links a group produces: one per distinct work, because two sources naming
// the same film at the same address are one claim, not two.
export function linksFromGroup(placeId, rows, { relationKind = "filming_location", scoreOf } = {}) {
  const byWork = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.work_id) continue;
    const score = typeof scoreOf === "function" ? Number(scoreOf(row)) : 1;
    const current = byWork.get(row.work_id) ?? 0;
    byWork.set(row.work_id, Math.max(current, Number.isFinite(score) ? score : 0));
  }

  return [...byWork].map(([workId, confidence]) => ({
    work_id: workId,
    place_id: placeId,
    relation_kind: relationKind,
    confidence: Math.min(1, confidence),
  }));
}

// Does an existing graph place already hold this group? Checked before inserting, so a
// promotion lands ON the 70 places the graph already has rather than beside them.
export function matchExistingPlace(group, places, { radiusM = DEDUP_RADIUS_M } = {}) {
  const candidates = Array.isArray(places) ? places : [];
  if (group?.wikidataId) {
    const byId = candidates.find((place) => place.wikidata_id === group.wikidataId);
    if (byId) return byId;
  }
  const position = group?.position;
  if (!position) return null;

  return candidates.find((place) => {
    const point = positionOf(place);
    if (!point) return false;
    if (metresApart(point, position) > radiusM) return false;
    return namesMatch(place.name, bestName(group.rows ?? []))
      || normalizePlaceName(place.name) === normalizePlaceName(bestName(group.rows ?? []));
  }) ?? null;
}
