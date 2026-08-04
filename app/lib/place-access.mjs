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
