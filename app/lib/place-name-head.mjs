// Turning a written location into a name a gazetteer can answer, plus the area that
// proves the answer is the right one.
//
// 13,637 rows in the queue have no coordinate, and not one of them has ever been through
// a geocoder. Measured on a sample of 120 movie-locations rows, asking Wikidata for the
// name as stored resolves **0.8%** — because what is stored is an address:
//
//   "Zorba, Leinster Gardens, Bayswater, London W2"
//   "Millennium Biltmore Hotel, South Grand Avenue Entrance, Downtown Los Angeles"
//
// and Wikidata holds the venue, not the address. Asking for the first clause alone takes
// the same sample to **31.7%**. That number is a trap, and the measurement is why this
// module exists rather than a one-line split:
//
//   Zorba, Leinster Gardens, Bayswater, London W2   ->  "Zorba"   ->  Colorado, USA
//   St John's Square, Clerkenwell, London EC1       ->  ...       ->  Malta
//   Federal Reserve Bank, Liberty Street, New York  ->  ...       ->  Dallas
//
// The comma clause that was discarded is the disambiguator — exactly what
// `gazetteerName` refuses to strip, and it is right to refuse. So the clause is not
// thrown away: it becomes the **area**, and the caller resolves the area first and keeps
// the head only if the head landed inside it. A head with nowhere to be checked against
// is refused rather than believed.
//
// Rows here were written by people describing where a camera stood. `area_hint` already
// exists on the row for the prose; this module is only about producing something
// answerable and something to check it with.

import { normalizePlaceName } from "./place-dedup.mjs";

// Two kinds, and they are cut differently.
//
// EXPLICIT phrases can only be locative: nothing that begins "at the corner of" is part
// of a place's name. They always cut.
const EXPLICIT_LOCATIVE = new RegExp(
  "\\s+(?:"
  + "at\\s+the\\s+(?:corner|end|junction|top|bottom|foot|rear|back|front)\\s+of|"
  + "on\\s+the\\s+(?:corner|side|bank|banks|edge)\\s+of|"
  + "to\\s+the\\s+(?:north|south|east|west)(?:[-\\s]?(?:east|west))?\\s+of|"
  + "in\\s+front\\s+of|close\\s+to|next\\s+to|opposite|outside|beside|behind|"
  + "between|below|above|off|over|along|across|towards|toward|"
  + "looking|seen\\s+from|viewed\\s+from|with|where|which|now\\s+the"
  + ")\\s+.*$",
  "i",
);

// BARE prepositions are ambiguous, because they also occur INSIDE names: Stoke on Trent,
// Chalfont St Giles. So they cut only when enough of a name is left standing — measured
// against the corpus, two words is the line that keeps "Bristol Temple Meads station"
// while refusing to reduce "Stoke on Trent" to "Stoke".
const BARE_LOCATIVE = /\s+(?:on|at|in|near|by)\s+.*$/i;
export const MIN_HEAD_WORDS = 2;

function words(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function cutLocative(text) {
  const explicit = String(text ?? "").replace(EXPLICIT_LOCATIVE, "");
  const bare = explicit.replace(BARE_LOCATIVE, "");
  return words(bare) >= MIN_HEAD_WORDS ? bare : explicit;
}

// A head that is only a common noun is not a name, and a gazetteer will happily answer it
// with something on another continent: "the alley at the corner of Seaford Road and
// Leeland Terrace in W13" reduces to "alley", which Wikidata places in Israel.
//
// This is not a list of words that may not APPEAR in a head — "Sonning Bridge" and "Box
// Tunnel" are fine. It is a list of what a head may not consist of entirely.
const GENERIC_ALONE = new Set([
  "alley", "alleyway", "arch", "avenue", "bank", "bar", "beach", "boulevard", "bridge",
  "building", "buildings", "car park", "castle", "cathedral", "cemetery", "church",
  "cinema", "close", "corner", "cottage", "cottages", "court", "crescent", "drive",
  "embankment", "entrance", "estate", "farm", "field", "forest", "gardens", "gate",
  "harbour", "hall", "hill", "hospital", "hotel", "house", "inn", "junction", "lane",
  "library", "market", "mews", "museum", "park", "path", "pier", "place", "pub",
  "public house", "quay", "restaurant", "river", "road", "roundabout", "school",
  "square", "station", "street", "terrace", "theatre", "tower", "track", "tunnel",
  "viaduct", "village", "wharf", "wood", "woods", "yard",
]);

// A road is a line, not a point. Measured: "A82 at Rannoch Moor near Lochan na
// h-Achlaise" reduces to "A82", which Wikidata places at the road's southern end in
// Glasgow — 80 km from the scene, on the right road and in the wrong place. A pin that is
// confidently eighty kilometres out is worse than no pin, because nothing about it looks
// wrong ([[place-precision]]).
const ROAD_DESIGNATION = /^(?:[abcm]\s?\d+(?:\s?\(m\))?|route\s+\d+|highway\s+\d+|us\s?\d+|i-\d+)$/i;

// A UK outward code is not a place a gazetteer answers, and it is the commonest last
// clause in this corpus: "London SW7", "W13", "Bristol BS1".
const UK_OUTWARD = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\b\s*$/;
const BARE_POSTCODE = /^[A-Z]{1,2}\d{1,2}[A-Z]?$/i;

function tidy(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "").trim();
}

// The name to ask the gazetteer for.
export function placeHead(name) {
  const first = tidy(String(name ?? "").split(",")[0]);
  const withoutArticle = first.replace(/^(?:the|a|an)\s+/i, "");
  return tidy(cutLocative(withoutArticle));
}

// The enclosing areas, MOST SPECIFIC FIRST, for the caller to try in order.
//
// A list rather than one answer, and the reason is measured. Taking the last clause alone
// anchors "Kladruby Monastery, Kladruby, Czech Republic" to the centroid of the Czech
// Republic — 220 km from the monastery, so the containment check rejects a row that is
// perfectly correct. A country is too big to confirm anything at a hundred kilometres.
// The clause before it, "Kladruby", is a village next door and confirms it instantly.
//
// So the caller resolves these in order and uses the first that a gazetteer knows. The
// address runs specific-first, which is exactly the order that makes the check tight.
export function placeAreas(name) {
  const clauses = String(name ?? "").split(",").map(tidy).filter(Boolean);
  if (clauses.length < 2) {
    // No comma: ReelStreets prose, and only a trailing "in <somewhere>" names an area.
    // Not "near"/"off"/"at" — those introduce the neighbouring STREET, and "Star Tavern
    // public house at the corner of St John's Wood Terrace" would anchor a pub to a
    // kerb. A phrase with nothing enclosing it returns nothing and the row is refused,
    // which is the honest outcome rather than a confident one.
    const inArea = String(name ?? "").match(/\bin\s+([^,]{2,40})$/i)?.[1];
    const single = tidy(String(inArea ?? "").replace(UK_OUTWARD, ""));
    return single ? [single] : [];
  }
  const areas = [];
  for (let i = 1; i < clauses.length; i += 1) {
    const candidate = tidy(clauses[i].replace(UK_OUTWARD, ""));
    if (candidate && !BARE_POSTCODE.test(candidate) && !areas.includes(candidate)) {
      areas.push(candidate);
    }
  }
  return areas;
}

// The most general one, kept because a single anchor is what a reader expects to see on
// a card. The runner uses `placeAreas`.
export function placeArea(name) {
  const areas = placeAreas(name);
  return areas.length > 0 ? areas[areas.length - 1] : null;
}

// A browse index is not a place. ReelStreets files every row under a section of its own
// alphabetical index -- "London A-B", "London H-L", "London M-N" -- and those land in
// `area_hint`, where they look exactly like an enclosing area. Measured on the pending
// rows: **2,676 of them**, and the titles are what is bucketed, not the places. So
//
//   "Pavilion Theatre on Westover Road, Bournemouth"   area_hint "London M-N"
//   "Hotel Metropole, The Leas, Folkestone, Kent"      area_hint "London H-L"
//
// would each be confirmed as London -- 160 km and 110 km wrong, by a check whose entire
// job is to catch exactly that. The bucket resolves (to London), so nothing downstream
// would notice.
//
// movie-locations has no such shape: all 117 of its distinct hints are real places
// ("Hampshire", "Prague", "Los Angeles"), and they rescue 703 rows that name no area of
// their own. So the bucket is refused by shape and everything else is simply asked --
// "Rest Of The World" and "North" are hints too, and the gazetteer refuses those by
// itself, which is the right place for that judgement.
const INDEX_BUCKET = /\s+[A-Za-z]\s*[-\u2013]\s*[A-Za-z]$/;

export function hintIsAnIndexBucket(hint) {
  return INDEX_BUCKET.test(String(hint ?? "").trim());
}

// The area to fall back on when the written name encloses itself in nothing. Returns an
// empty list rather than a bad guess.
export function areasFromHint(hint) {
  const text = tidy(hint);
  if (!text || hintIsAnIndexBucket(text)) return [];
  return [text];
}

// Why this row cannot be asked about at all. A refusal here is a result: the row keeps
// its written name and stays without a point, which is the honest state.
export function headRefusal(head) {
  const text = tidy(head);
  if (!text) return "no_head";
  if (!/\p{L}|\d/u.test(text)) return "head_has_no_letters";
  if (ROAD_DESIGNATION.test(text)) return "road_is_a_line_not_a_point";
  const normalized = normalizePlaceName(text);
  if (!normalized || normalized.length < 3) return "head_too_short";
  if (GENERIC_ALONE.has(normalized)) return "head_is_a_common_noun";
  return null;
}

// The whole decision for one written location.
//
// `area` may be null, and the caller must treat that as "unverifiable" rather than
// "unconstrained": without an area there is nothing to check the head against, and the
// 31.7% that a bare head appears to resolve is where Zorba ends up in Colorado.
export function splitPlacePhrase(name, { areaHint = null } = {}) {
  const head = placeHead(name);
  const refusal = headRefusal(head);
  if (refusal) return { head: null, areas: [], area: null, refusal };
  // The row's own hint goes LAST: it is the coarsest thing available, and the whole point
  // of the ordering is that the tightest area answers first.
  const areas = [...placeAreas(name), ...areasFromHint(areaHint)]
    .filter((area, index, all) => all.indexOf(area) === index);
  if (areas.length === 0) return { head, areas: [], area: null, refusal: "no_area_to_check_against" };
  return { head, areas, area: areas[areas.length - 1], refusal: null };
}

// How far a head may sit from its area and still be that place.
//
// TWO radii, because "area" means two different sizes of thing and one number cannot serve
// both. Measured on the first real batch of 1,000 rows:
//
//   "Millennium Biltmore Hotel, South Grand Avenue Entrance, Downtown Los Angeles"
//        -> confirmed by Downtown Los Angeles, a district. 100 km is right.
//   "Bedales, Bedale Street, Borough Market, London SE1"
//        -> confirmed by Bedale Street, and Bedales is a SCHOOL IN HAMPSHIRE, 80 km away.
//           Inside 100 km, and a completely wrong pin.
//
// So when the area that answered is the row's IMMEDIATELY enclosing clause — normally a
// street or a small district — the head has to be on top of it. When the answer came from
// further out, the loose radius applies. The tight tier keeps every other index-0
// acceptance in that batch (CityPoint on Ropemaker Street, Grace Cathedral on California
// Street, the Massachusetts State House on Beacon Street) and drops only Bedales.
//
// 100 km is the same number `HINT_RADIUS_KM` uses in geocode-wikidata.mjs, and this is the
// same question asked one step later: there, to choose between candidates; here, to check
// the single candidate that came back unopposed. `chooseCandidate` reports "unique" for a
// lone result no matter where it is, which is exactly how a London restaurant became a
// place in Colorado.
export const AREA_RADIUS_KM = 100;
export const IMMEDIATE_AREA_RADIUS_KM = 5;

// Which radius applies, given WHICH of the row's areas actually answered. Index 0 is the
// clause closest to the place itself.
export function radiusForAreaIndex(index) {
  return index === 0 ? IMMEDIATE_AREA_RADIUS_KM : AREA_RADIUS_KM;
}

export function kmApart(a, b) {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

// The verification. Both points must exist; an unresolved area refuses the row.
export function headIsInsideArea(headPoint, areaPoint, radiusKm = AREA_RADIUS_KM) {
  const usable = (point) => point
    && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
  if (!usable(headPoint) || !usable(areaPoint)) return false;
  return kmApart(
    { lat: Number(headPoint.lat), lng: Number(headPoint.lng) },
    { lat: Number(areaPoint.lat), lng: Number(areaPoint.lng) },
  ) <= radiusKm;
}
