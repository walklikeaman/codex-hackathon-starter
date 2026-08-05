// How exactly a place is located — a separate question from how well it is evidenced.
//
// `place-review.mjs` already keeps two questions apart: is this place linked to the work
// (claim signals) and is the coordinate right (location signals). This is the third, and
// it is orthogonal to both:
//
//   HOW EXACTLY IS IT LOCATED?
//
// "Skyfall was shot in Istanbul" can be perfectly evidenced — a permit, a cited article,
// a frame match — and still not be a pin, because Istanbul is fifteen million people and
// there is nowhere to stand. Conversely a fan naming the exact café J.K. Rowling wrote in
// is precise and thinly evidenced.
//
// So the two axes MUST NOT be multiplied into one score. A single number cannot say
// which of the two is missing, and the responses are opposite: weak evidence needs
// another source, weak precision needs a better address, and no amount of the first
// fixes the second.
//
// The product decides this. GloryMap replaces a guided tour, so the deliverable is a
// place somebody stands in front of. A region is context, not a stop.

// Coarsest last. The order is the ladder, so a comparison is an index comparison.
export const PRECISION = Object.freeze([
  "point",        // a bench, a grave, a doorway
  "building",     // a café, a castle, a station
  "street",       // Victoria Street, a harbour front
  "settlement",   // a village or a town — walkable only if small
  "region",       // an island, a county, a national park
  "country",
  "unknown",
]);

// What may be a pin on the map.
//
// Everything coarser is still KEPT and still shown — as an area, with its own shape or
// a ring, and never as a dot that implies a doorway. The distinction the owner drew:
// "we do not include the whole island as a point, but as an area where the exact place
// is not known".
const PINNABLE = new Set(["point", "building", "street"]);

// A settlement is the hard case and it is deliberately NOT pinnable. A village of two
// streets and a city of fifteen million share the class, and the failure is asymmetric:
// pinning the city centre for "shot in Istanbul" invents a doorway, while showing a
// small village as an area costs a little precision nobody was promised.
//
// THIS IS NOT AN ACCESS RULE, and the difference is measured rather than argued. On a
// real Outlander itinerary selling today, Culross and Falkland are villages — they land
// on this rung and are therefore not pinned, and they are the two most WALKABLE stops
// on the whole tour: free, open, streets you wander. Meanwhile Midhope Castle is
// building-precision and passes cleanly, while being a ticketed gate on a private
// estate with a derelict interior nobody may enter.
//
// So precision answers "how well do we know where this is" and nothing else. Whether a
// person can stand there is a THIRD axis — access — and it is not implemented. Until it
// is, this rule must not be loosened to compensate: that would trade a rule that is
// merely incomplete for one that is wrong.
export function isPinnable(precision) {
  return PINNABLE.has(String(precision ?? "").toLowerCase());
}

export function precisionRank(precision) {
  const index = PRECISION.indexOf(String(precision ?? "").toLowerCase());
  return index === -1 ? PRECISION.length : index;
}

// Wikidata's own type label, read as precision. This is a heuristic over a vocabulary
// nobody designed for us, so it is deliberately conservative: an unrecognised type is
// "unknown" and therefore not pinnable, rather than being guessed into a dot.
// Matched as SUBSTRINGS over a folded label, finest rung first.
//
// Word boundaries were the obvious choice and the wrong one: `\bcity\b` misses
// "megacity", `\bgrave\b` misses "graveyard", and the accent in "café" breaks the
// trailing boundary outright. All three fell through to "unknown" and vanished from the
// map — a rule meant to be conservative was deleting real places instead.
//
// Substrings are safe HERE because of the order. A finer rung is tested first, so
// "island church" is a building and "regional theatre" is a building — the coarse word
// inside a fine label never wins, which is the direction that would actually hurt.
// Words added after a live run, each because a real place fell through to "unknown" and
// was drawn as a dot: "cemetery" and "kirkyard" (Greyfriars — "graveyard" was already
// caught by "grave", the Scottish word was not), "zoo" and "market" (London Zoo,
// Leadenhall Market), and "area of" for Wikidata's own type for a district, which is
// how Kensington, Wandsworth and Notting Hill were all pinned as though they had doors.
const TYPE_PRECISION = [
  ["point", ["grave", "tomb", "memorial", "monument", "statue", "plaque", "bench", "fountain",
    "well", "cemetery", "kirkyard", "churchyard"]],
  ["building", ["building", "house", "hotel", "cafe", "restaurant", "pub", "bar", "castle",
    "palace", "church", "cathedral", "kirk", "abbey", "museum", "library", "theatre", "theater",
    "cinema", "school", "college", "university", "station", "hospital", "shop", "store",
    "tower", "bridge", "lighthouse", "studio", "zoo", "market", "hall", "stadium", "gallery"]],
  ["street", ["street", "road", "lane", "avenue", "square", "plaza", "harbour", "harbor",
    "quay", "pier", "alley", "close", "court", "crescent", "terrace", "steps"]],
  ["settlement", ["village", "hamlet", "town", "city", "municipality", "suburb",
    "neighbourhood", "neighborhood", "district", "borough", "parish", "commune",
    "area of"]],
  ["region", ["island", "isle", "county", "region", "province", "state", "park", "forest",
    "glen", "valley", "mountain", "loch", "lake", "bay", "coast", "peninsula", "moor",
    "common", "estate", "beach"]],
  ["country", ["country", "sovereign state", "kingdom", "republic"]],
];

// Everything after " in " says WHERE a place is, not what it is, and reading it as a
// type puts the containing city's rung on the place inside it. Measured live: Moray
// House School is described as "faculty in City of Edinburgh" — no word in "faculty"
// is in the vocabulary, so "city" won and a university building was drawn as a
// settlement-sized area. The descriptions this now grades correctly all keep their
// meaning without the clause: "graveyard surrounding Greyfriars Kirk", "public
// university", "secondary school", "castle".
function foldLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+in\s+.*$/, "")
    .trim();
}

// The LONGEST matching word wins, and a tie goes to the finer rung.
//
// Taking the first matching rung was not enough. "shopping street" matched "shop" and
// became a building; "sovereign state" matched "state" and became a region. Both are
// the same mistake — a short word buried inside a longer one outranking the word the
// label is actually about.
//
// Length is the right tiebreak because a longer match is a more specific claim about
// the label. "sovereign state" beats "state"; "street" beats "shop". Where two matches
// are the same length — "island church" — the finer rung wins, because a church on an
// island is somewhere you can stand and the island is not.
export function precisionFromType(typeLabel) {
  const label = foldLabel(typeLabel);
  if (!label) return "unknown";

  let best = null;
  for (const [precision, words] of TYPE_PRECISION) {
    for (const word of words) {
      if (!label.includes(word)) continue;
      if (!best || word.length > best.length) best = { precision, length: word.length };
    }
  }
  return best?.precision ?? "unknown";
}

// A place is usually several things at once, and the finest of them wins.
//
// Wikidata gives the Isle of Skye "island" and "place with a Council area"; Greyfriars
// Kirkyard is a "cemetery" and a "listed building". Grading on whichever P31 arrives
// first is a coin toss over whether a place appears as a dot somebody could stand on,
// and the two possible mistakes are not equal: calling a churchyard a region loses a
// real stop, while calling an island a building invents a doorway. The finest rung is
// the one the place is most specifically about — and the coarse types it also belongs
// to are true of everything around it too.
export function precisionFromTypes(typeLabels) {
  const labels = (Array.isArray(typeLabels) ? typeLabels : [typeLabels]).filter(Boolean);
  if (labels.length === 0) return "unknown";

  return labels
    .map((label) => precisionFromType(label))
    .sort((left, right) => precisionRank(left) - precisionRank(right))[0];
}

// A street address is precise whatever the type says. "6A Nicolson Street" is a
// building even if the entity behind it is typed as a café chain — the number is the
// evidence, and it is stronger than any label.
const HAS_STREET_NUMBER = /^\s*\d+[A-Za-z]?\s+\S/;

export function precisionOf({ name, typeLabel, typeLabels, precision } = {}) {
  // An explicit precision from the source wins: a permit record knows its own address
  // better than any inference from a name.
  const stated = String(precision ?? "").toLowerCase();
  if (PRECISION.includes(stated)) return stated;
  if (HAS_STREET_NUMBER.test(String(name ?? ""))) return "building";
  return precisionFromTypes(typeLabels ?? typeLabel);
}

// How a place should appear. Three outcomes, and the middle one is the point of all
// this: a place that is real, evidenced and simply not locatable to a doorway.
export const DISPLAY = Object.freeze({
  pin: "pin",         // stand here
  area: "area",       // it happened somewhere in this, and we do not know where
  hidden: "hidden",   // nothing to show
});

// Fan knowledge is an asset, and the grading must not throw it away.
//
// A place named only by enthusiasts — the café, the stair, the underpass — is often the
// most precise thing anyone has, and it is precisely what the guided tours sell. So thin
// evidence NEVER hides a precise place; it marks it unconfirmed and keeps it. What weak
// evidence forfeits is the right to be presented as established, not the right to exist.
export function gradePlace({
  precision, name, typeLabel, typeLabels, confidence = 0, verified = false,
} = {}) {
  const resolved = precisionOf({ precision, name, typeLabel, typeLabels });
  const pinnable = isPinnable(resolved);

  return {
    precision: resolved,
    // The two axes stay side by side and are never multiplied. A reader can always see
    // WHICH one is weak, because the fix differs: another source, or a better address.
    display: pinnable ? DISPLAY.pin : (resolved === "unknown" ? DISPLAY.hidden : DISPLAY.area),
    confirmed: Boolean(verified) || confidence >= 0.6,
    // Said plainly, because "unconfirmed" and "imprecise" are different apologies.
    caveat: !pinnable && resolved !== "unknown"
      ? "The source names this area, not a spot inside it."
      : null,
  };
}
