import assert from "node:assert/strict";
import test from "node:test";

import { STUDIO_TYPES, studioNameHint, studioVerdict } from "../app/lib/studio-lots.mjs";

// Measured on 5,436 Los Angeles queue rows, the name test missed 166 places inside a lot
// and raised 19 alarms outside every lot, some of them Studio City shops.
test("inside a lot's fence is a studio, whatever the place is called", () => {
  const verdict = studioVerdict({ name: "New York Street", lat: 34.1476, lng: -118.3374 });
  assert.equal(verdict.studio, true);
  assert.equal(verdict.basis, "polygon");
  assert.equal(verdict.lot.slug, "warner-bros-burbank");
});

test("Wikidata's own type makes a studio where there is no fence", () => {
  // Cinecittà has no ring here; its type is what says it is a studio.
  const cinecitta = studioVerdict({ name: "Cinecittà", lat: 41.8522, lng: 12.5773, instanceOf: ["Q375336"] });
  assert.deepEqual([cinecitta.studio, cinecitta.basis], [true, "type"]);
  for (const type of STUDIO_TYPES) {
    assert.equal(studioVerdict({ lat: 1, lng: 1, instanceOf: [type] }).studio, true, type);
  }
});

// A false "studio" claims the scene is set elsewhere; a missed stage only costs a frame
// match the matcher declines. So a coordinate outside every fence, with no studio type,
// is the street — the name is not consulted.
test("a coordinate outside every lot, with no studio type, is the street", () => {
  for (const name of ["Bistro Garden, Studio City", "Bookstar (Studio City)", "General Motors Design Studio", "Red Studios"]) {
    const verdict = studioVerdict({ name, lat: 34.1437, lng: -118.396 });
    assert.deepEqual([verdict.studio, verdict.basis], [false, "coordinate"], name);
  }
});

// The rings added for #196, each checked against a row the queue holds inside it.
test("the lots beyond Los Angeles are fenced too", () => {
  assert.equal(studioVerdict({ lat: 51.5497, lng: -0.5361 }).lot?.slug, "pinewood-studios");
  assert.equal(studioVerdict({ lat: 51.6922, lng: -0.4185 }).lot?.slug, "warner-bros-leavesden");
});

test("only a place with no coordinate falls back to its name, and says so", () => {
  assert.deepEqual(studioVerdict({ name: "Warner Bros. Studios, Leavesden" }), { studio: true, basis: "name", lot: null });
  assert.deepEqual(studioVerdict({ name: "The interior of a London pub" }), { studio: false, basis: "name", lot: null });
  // (0, 0) is not a place — four incidents in this project came from Number("") being 0.
  assert.equal(studioVerdict({ name: "Stage 4 sound-stage", lat: 0, lng: 0 }).basis, "name");
});

test("the name test does not take a neighbourhood for a studio", () => {
  assert.equal(studioNameHint("Warner Bros. Studios, Leavesden"), true);
  assert.equal(studioNameHint("Stage 4 sound-stage"), true);
  assert.equal(studioNameHint("CBS Studio Center, Studio City"), true);
  assert.equal(studioNameHint("Universal Studios Lot, Studio City"), true);
  assert.equal(studioNameHint("Bookstar (Studio City)"), false);
  assert.equal(studioNameHint("Diamond and Jewelry Gallery Studio City"), false);
  assert.equal(studioNameHint("The interior of a London pub"), false);
  assert.equal(studioNameHint(null), false);
});
