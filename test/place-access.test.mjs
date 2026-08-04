import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS,
  INTERIOR,
  accessFromOsmTags,
  accessNote,
  canShow,
  isClosedOn,
  isRoutable,
  overpassError,
} from "../app/lib/place-access.mjs";

// --- silence is not permission ---------------------------------------------------------

test("no access tag means unknown, never open", () => {
  // Verified live: Greyfriars Kirkyard carries opening_hours, The Elephant House carries
  // hours and a website, and Midhope Castle carries nothing. Reading "no tag" as "walk
  // in" would invent the exact promise this module exists to stop making.
  assert.equal(accessFromOsmTags({}).access, ACCESS.unknown);
  assert.equal(accessFromOsmTags({ name: "Midhope Castle" }).access, ACCESS.unknown);
});

test("a gate with no access tag is evidence of nothing", () => {
  assert.equal(accessFromOsmTags({ barrier: "gate" }).access, ACCESS.unknown);
});

test("real tags from real places read correctly", () => {
  // Both fetched from Overpass during this work.
  assert.equal(accessFromOsmTags({ opening_hours: "24/7" }).access, ACCESS.open);
  assert.equal(
    accessFromOsmTags({ opening_hours: "Mo-Th 08:00-22:00; Fr 08:00-23:00" }).access,
    ACCESS.open,
  );
  assert.equal(accessFromOsmTags({ access: "private" }).access, ACCESS.view_only);
  assert.equal(accessFromOsmTags({ fee: "yes" }).access, ACCESS.ticketed);
  assert.equal(accessFromOsmTags({ opening_hours: "closed" }).access, ACCESS.closed);
});

// --- showing and routing are different promises -------------------------------------------

test("an unknown place is shown but never routed to", () => {
  // A pin says "this is connected to the work", which is true whether or not the door
  // opens. A route says "go here and it will be worth it" — a promise about a specific
  // day, and making it without knowing is how a map becomes worse than a coach.
  const unknown = { access: ACCESS.unknown };
  assert.equal(canShow(unknown), true);
  assert.equal(isRoutable(unknown), false);
});

test("a place you may only look at is still a stop", () => {
  // Midhope: a ticketed gate you can stand at, with an interior shut to everyone. That
  // is a real thing to go and see, provided nobody is promised a room.
  assert.equal(isRoutable({ access: ACCESS.view_only }), true);
  assert.equal(isRoutable({ access: ACCESS.ticketed }), true);
  assert.equal(isRoutable({ access: ACCESS.open }), true);
});

test("a closed place is neither shown nor routed to", () => {
  assert.equal(canShow({ access: ACCESS.closed }), false);
  assert.equal(isRoutable({ access: ACCESS.closed }), false);
});

// --- the sentence nobody prints -------------------------------------------------------------

test("the note says plainly what you get, including what you do not", () => {
  // Reviewers of these tours complain about pace, crowds and honesty — never about
  // missing information. The one line no booking page prints is that the interior is
  // shut, and it is the line that would have prevented the disappointment.
  assert.match(
    accessNote({ access: ACCESS.ticketed, interior: INTERIOR.exterior_only }),
    /Ticket needed · exterior only/,
  );
  assert.match(accessNote({ access: ACCESS.unknown }), /have not confirmed/i);
  assert.match(accessNote({ access: ACCESS.closed }), /do not make the journey/i);
  assert.match(
    accessNote({ access: ACCESS.open, openingHours: "24/7" }),
    /Free to visit · 24\/7/,
  );
});

// --- the liveness problem, in its smallest honest form ---------------------------------------

test("a dated closure is honoured, and an unknown one is not invented", () => {
  // Midhope has 13+ named closure days in 2026 and the operator reroutes on the morning.
  // We cannot know every closure, so we say what we were told and no more.
  const record = { access: ACCESS.ticketed, closures: ["2026-12-24", "2026-12-25"] };
  assert.equal(isClosedOn(record, "2026-12-24"), true);
  assert.equal(isClosedOn(record, "2026-12-24T09:00:00Z"), true);
  assert.equal(isClosedOn(record, "2026-06-01"), false);
  assert.equal(isClosedOn({ access: ACCESS.open }, "2026-12-24"), false);
});

// --- a failure reported inside a success -------------------------------------------------------

test("Overpass reporting an error with HTTP 200 and HTML is caught before parsing", () => {
  // Seen live during this work: "runtime error: … The server is probably too busy".
  // Parsing that as JSON throws far from the cause — the third service this session to
  // report failure inside a success.
  const html = '<?xml version="1.0"?><html><body>Error: runtime error: '
    + 'Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy.'
    + '</body></html>';

  assert.match(overpassError(html), /overpass:/);
  assert.match(overpassError("<html>something else</html>"), /HTML, not JSON/);
  assert.match(overpassError("   "), /empty/);
  assert.equal(overpassError('{"elements":[]}'), null);
});
