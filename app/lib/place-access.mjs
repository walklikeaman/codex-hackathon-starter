// Whether a person can actually stand there — the axis `place-grade.mjs` named and did
// not implement.
//
// Precision answers "how well do we know where this is". It says nothing about whether
// the gate is open, and measured against a real Outlander itinerary the two disagree in
// both directions: Culross and Falkland are villages, so coarse precision, and they are
// the most walkable stops on the tour — free, open streets. Midhope Castle is
// building-precision and passes every rule we had, while being a ticketed gate on a
// private estate whose interior is derelict and closed to everyone including the guide.
//
// THE POINT OF THIS MODULE is the one case where a self-guided map is WORSE than a
// coach: Midhope has 13+ named closure days in 2026 and the operator reroutes on the
// morning. A static route sends somebody to a locked gate and lets them think it was
// their mistake. That only gets fixed if not knowing STOPS the route rather than being
// quietly assumed open.

// What it takes to be there. Ordered from freest.
export const ACCESS = Object.freeze({
  open: "open",                 // public and free — a street, a churchyard, a harbour
  ticketed: "ticketed",         // you may enter, having paid or booked
  view_only: "view_only",       // you may see it and not enter — a gate, a private house
  closed: "closed",             // not accessible at all right now
  unknown: "unknown",           // nobody has told us, which is NOT the same as open
});

// Reaching a place and getting inside it are different questions, and Midhope is why:
// you can buy a ticket to stand in the courtyard while the interior is shut to
// everybody. Conflating them promises a room nobody can enter.
export const INTERIOR = Object.freeze({
  enterable: "enterable",
  exterior_only: "exterior_only",
  unknown: "unknown",
});

// Overpass answers a failure with HTTP 200 and an HTML page:
//
//   "runtime error: … Dispatcher_Client::request_read_and_idx::timeout.
//    The server is probably too busy to handle your request."
//
// Parsing that as JSON throws far from the cause — the third time this session that a
// service has reported failure inside a success. Checked before anything else is read.
export function overpassError(body) {
  const text = String(body ?? "");
  if (!text.trim()) return "empty response";
  if (text.trimStart().startsWith("<")) {
    const match = text.match(/runtime error:([^<]{0,140})/i);
    return match ? `overpass: ${match[1].trim()}` : "overpass returned HTML, not JSON";
  }
  return null;
}

// Read access off OpenStreetMap tags. ODbL, same source and licence as the building
// footprints already used for snapping.
//
// Silence is reported as `unknown` and never as `open`. Most places carry no access tag
// at all — verified live: Greyfriars Kirkyard has `opening_hours: 24/7`, The Elephant
// House has hours and a website, and Midhope Castle has nothing. Reading "no tag" as
// "walk in" would invent exactly the promise this module exists to stop making.
export function accessFromOsmTags(tags = {}) {
  const value = (key) => String(tags?.[key] ?? "").trim().toLowerCase();

  const access = value("access");
  const barrier = value("barrier");
  const fee = value("fee");
  const hours = value("opening_hours");

  if (access === "no" || access === "private") {
    return { access: ACCESS.view_only, interior: INTERIOR.unknown, source: "osm:access" };
  }
  if (hours === "closed" || value("disused") === "yes") {
    return { access: ACCESS.closed, interior: INTERIOR.unknown, source: "osm:opening_hours" };
  }
  if (fee === "yes" || value("charge")) {
    return { access: ACCESS.ticketed, interior: INTERIOR.unknown, source: "osm:fee" };
  }
  // 24/7 on a churchyard means what it says; any stated hours mean somebody checked.
  if (hours) {
    return {
      access: ACCESS.open,
      interior: INTERIOR.unknown,
      openingHours: tags.opening_hours,
      source: "osm:opening_hours",
    };
  }
  // A gate with no access tag is not evidence of anything either way.
  if (barrier) return { access: ACCESS.unknown, interior: INTERIOR.unknown, source: "osm:barrier" };

  return { access: ACCESS.unknown, interior: INTERIOR.unknown, source: null };
}

// SHOWING a place and ROUTING to it are different promises, and this is the split the
// whole module turns on.
//
// A pin says "this is connected to the work" — true regardless of whether the door is
// open, and hiding it would throw away most of the map, since access coverage is thin.
// A generated route says "go here, in this order, and it will be worth it". That is a
// promise about the world on a specific day, and making it without knowing is how a map
// becomes worse than a coach.
export function canShow(record) {
  return record?.access !== ACCESS.closed;
}

export function isRoutable(record) {
  const access = record?.access ?? ACCESS.unknown;
  return access === ACCESS.open || access === ACCESS.ticketed || access === ACCESS.view_only;
}

// The sentence that would have prevented the disappointment. Reviewers of these tours
// complain about pace, crowds and honesty — never about missing information — and the
// single line no booking page prints is "the interior is closed to everyone".
export function accessNote(record) {
  const access = record?.access ?? ACCESS.unknown;
  const interior = record?.interior ?? INTERIOR.unknown;

  if (access === ACCESS.closed) return "Closed — do not make the journey.";
  if (access === ACCESS.unknown) return "We have not confirmed whether you can get in.";

  const entry = {
    [ACCESS.open]: "Free to visit",
    [ACCESS.ticketed]: "Ticket needed",
    [ACCESS.view_only]: "You can see it, but not go in",
  }[access];

  const inside = interior === INTERIOR.exterior_only ? " · exterior only" : "";
  const hours = record?.openingHours ? ` · ${record.openingHours}` : "";
  return `${entry}${inside}${hours}`;
}

// A closure the source gave us as a date. The liveness problem in its smallest honest
// form: we cannot know every closure, so we say what we were told and no more.
export function isClosedOn(record, isoDate) {
  const closures = Array.isArray(record?.closures) ? record.closures : [];
  return closures.includes(String(isoDate ?? "").slice(0, 10));
}

// --- asking OpenStreetMap ------------------------------------------------------------

// How far from our coordinate the place itself may be mapped. Wide, because the two
// points come from different sources for different things — measured, St Paul's is 3 m
// away and London Zoo's own way is 134 m — and the NAME does the identifying here, not
// the distance.
export const ACCESS_SEARCH_RADIUS_M = 250;

// One query for a whole tour's worth of stops. Overpass is donated hardware and asks
// callers to bound their own queries; a serial call per stop is exactly the pace that
// gets a client blocked.
export const MAX_PLACES_PER_QUERY = 10;

function escapeOverpassRegex(value) {
  return String(value ?? "").replace(/["\\]/g, "").replace(/[.*+?^${}()|[\]]/g, "\\$&");
}

// The name goes INSIDE the query, and the first measurement is why. Asking for every
// named feature around twelve points returned 200 elements against a shared output cap,
// so half the places got no answer at all — and the nearest named thing to a place is
// routinely not the place: Greyfriars Kirkyard's nearest neighbour is a gravestone
// ("Anne and Robert Potter", 8 m), Alnwick Castle's is the Diana Gift Shop.
//
// Two words rather than the whole name, because OSM rarely spells a name the way
// Wikidata does and a full-string regex is how you get zero.
export function overpassAccessQuery(places, { radiusM = ACCESS_SEARCH_RADIUS_M } = {}) {
  const wanted = (Array.isArray(places) ? places : [])
    .filter((place) => Number.isFinite(place?.lat) && Number.isFinite(place?.lng)
      && String(place?.name ?? "").trim())
    .slice(0, MAX_PLACES_PER_QUERY);
  if (wanted.length === 0) return null;

  const statements = wanted.map((place) => {
    const words = String(place.name).trim().split(/\s+/).slice(0, 2).join(" ");
    return `nwr(around:${radiusM},${place.lat},${place.lng})["name"~"${escapeOverpassRegex(words)}",i];`;
  }).join("\n  ");

  return `[out:json][timeout:25];\n(\n  ${statements}\n);\nout tags center;`;
}

function elementPoint(element) {
  const point = element?.center ?? { lat: element?.lat, lon: element?.lon };
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
    ? { lat: point.lat, lng: point.lon }
    : null;
}

// Access per place, keyed by the caller's own id.
//
// `matchesName` is injected rather than imported so the comparison stays the project's
// one place-name comparison (`place-dedup`) without this module depending on it.
//
// THE NAME TEST IS NOT OPTIONAL, even though the query already filtered by name: a
// union returns ONE result set, so an element fetched for another place is still in the
// list. Measured, that is not theoretical — Greyfriars Kirkyard picked up The Elephant
// House 87 m away and reported a café's opening hours as the graveyard's, which is
// precisely the invented promise this module exists to refuse.
export function accessRecordsFromOverpass(payload, places, {
  matchesName = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase(),
  radiusM = ACCESS_SEARCH_RADIUS_M,
  distanceM,
} = {}) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const records = new Map();

  for (const place of Array.isArray(places) ? places : []) {
    const matches = elements
      .map((element) => {
        const point = elementPoint(element);
        if (!point) return null;
        const distance = distanceM(place, point);
        return Number.isFinite(distance) ? { element, distance } : null;
      })
      .filter((entry) => entry
        && entry.distance <= radiusM
        && matchesName(entry.element.tags?.name, place.name))
      // Richest tagging first among the matches. A castle is usually mapped several
      // times — a way with the fee and the hours, a node with nothing but a name — and
      // the sparse one would report "unknown" for a place we actually know about.
      .sort((left, right) =>
        Object.keys(right.element.tags ?? {}).length - Object.keys(left.element.tags ?? {}).length
        || left.distance - right.distance);

    const chosen = matches[0];
    records.set(place.id, {
      id: place.id,
      name: place.name,
      ...(chosen
        ? { ...accessFromOsmTags(chosen.element.tags), osm_name: chosen.element.tags?.name,
            osm_type: chosen.element.type, osm_id: chosen.element.id }
        : { access: ACCESS.unknown, interior: INTERIOR.unknown, source: null }),
    });
  }

  return records;
}
