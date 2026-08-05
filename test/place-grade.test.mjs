import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY,
  gradePlace,
  isPinnable,
  precisionFromType,
  precisionFromTypes,
  precisionOf,
  precisionRank,
} from "../app/lib/place-grade.mjs";

// --- the island case: perfect evidence, and still not a pin --------------------------

test("an island is an area however well the claim is evidenced", () => {
  // The owner's rule: a source saying a film was shot on an island does not put the
  // island on the map as a point. Evidence and precision are different axes, and no
  // amount of the first fixes the second.
  const graded = gradePlace({ name: "Hashima Island", typeLabel: "island", verified: true, confidence: 1 });

  assert.equal(graded.precision, "region");
  assert.equal(graded.display, DISPLAY.area);
  assert.equal(graded.confirmed, true, "it is still a confirmed claim");
  assert.match(graded.caveat, /area, not a spot/);
});

test("a city is an area too, for the same reason", () => {
  // "Skyfall was shot in Istanbul" can be perfectly true and there is nowhere to stand.
  assert.equal(gradePlace({ name: "Istanbul", typeLabel: "megacity", verified: true }).display, DISPLAY.area);
  assert.equal(gradePlace({ name: "London", typeLabel: "capital city" }).display, DISPLAY.area);
});

test("a settlement is deliberately not pinnable, because the failure is asymmetric", () => {
  // A village and a city of fifteen million share the class. Pinning the city centre
  // invents a doorway; showing a small village as an area costs a precision nobody was
  // promised.
  assert.equal(isPinnable("settlement"), false);
  assert.equal(isPinnable("street"), true);
});

// --- fan knowledge is kept, never hidden ------------------------------------------------

test("a precise place with thin evidence is a pin marked unconfirmed, not a hidden one", () => {
  // The café, the stair, the underpass — often the most precise thing anyone has, and
  // exactly what the guided tours sell. Weak evidence forfeits the right to be shown as
  // established, never the right to exist.
  const graded = gradePlace({ name: "The Elephant House", typeLabel: "café", confidence: 0.2 });

  assert.equal(graded.display, DISPLAY.pin);
  assert.equal(graded.confirmed, false);
  assert.equal(graded.caveat, null, "its problem is evidence, not precision");
});

test("the two axes never collapse into one number", () => {
  // A single score cannot say WHICH is missing, and the fixes are opposite: another
  // source, or a better address.
  const precise = gradePlace({ name: "Greyfriars Kirkyard", typeLabel: "graveyard", confidence: 0.1 });
  const evidenced = gradePlace({ name: "Isle of Skye", typeLabel: "island", verified: true });

  assert.equal(precise.display, DISPLAY.pin);
  assert.equal(precise.confirmed, false);
  assert.equal(evidenced.display, DISPLAY.area);
  assert.equal(evidenced.confirmed, true);
});

// --- reading precision off what the source gives -----------------------------------------

test("a street number outranks any type label", () => {
  // "6A Nicolson Street" is a building even if the entity is typed as a café chain.
  // The number is evidence, and it is stronger than a label.
  assert.equal(precisionOf({ name: "6A Nicolson Street", typeLabel: "business" }), "building");
  assert.equal(precisionOf({ name: "21 George IV Bridge", typeLabel: "" }), "building");
});

test("a stated precision wins, because the issuer knows its own address", () => {
  assert.equal(precisionOf({ precision: "building", name: "Isle of Skye", typeLabel: "island" }), "building");
  // A precision we do not have a rung for is ignored rather than trusted.
  assert.equal(precisionOf({ precision: "very exact", name: "Skye", typeLabel: "island" }), "region");
});

test("common types land on the right rung", () => {
  assert.equal(precisionFromType("grave"), "point");
  assert.equal(precisionFromType("Grade A listed building"), "building");
  assert.equal(precisionFromType("shopping street"), "street");
  assert.equal(precisionFromType("village"), "settlement");
  assert.equal(precisionFromType("national park"), "region");
  assert.equal(precisionFromType("sovereign state"), "country");
});

test("an unrecognised type is unknown, and unknown is not a dot", () => {
  // The vocabulary was not designed for us, so a guess would be a doorway invented from
  // a word nobody checked.
  assert.equal(precisionFromType("Q1234567"), "unknown");
  assert.equal(precisionFromType(""), "unknown");
  assert.equal(gradePlace({ name: "Somewhere", typeLabel: "obscure classification" }).display, DISPLAY.hidden);
});

test("the ladder is ordered coarsest last, so a comparison is a comparison", () => {
  assert.ok(precisionRank("point") < precisionRank("building"));
  assert.ok(precisionRank("street") < precisionRank("settlement"));
  assert.ok(precisionRank("region") < precisionRank("country"));
  assert.ok(precisionRank("nonsense") > precisionRank("country"));
});

test("precision is not access, and the two disagree on real tours", () => {
  // Measured against an Outlander itinerary selling today. Culross and Falkland are
  // villages — settlement rung, so not pinned — and they are the two most WALKABLE
  // stops on the tour: free, open, streets you wander. Midhope Castle is
  // building-precision and passes cleanly, while being a ticketed gate on a private
  // estate with a derelict interior nobody may enter.
  //
  // The rule is therefore incomplete, not wrong. Loosening it to compensate would
  // trade incomplete for wrong, so access stays a separate axis, unimplemented.
  const culross = gradePlace({ name: "Culross", typeLabel: "village", verified: true });
  const midhope = gradePlace({ name: "Midhope Castle", typeLabel: "castle", verified: true });

  assert.equal(culross.display, DISPLAY.area, "walkable, and still not a pin");
  assert.equal(midhope.display, DISPLAY.pin, "pinnable, and behind a locked gate");
});

// --- a place is several things at once ---------------------------------------------------

test("the finest of a place's types decides, not whichever arrives first", () => {
  // Wikidata gives the Isle of Skye "island" and "place with a Council area"; Greyfriars
  // Kirkyard is a cemetery and a listed building. SAMPLE in the query would pick one at
  // random, which is a coin toss over whether a place becomes a dot you could stand on.
  assert.equal(precisionFromTypes(["island", "place with a Council area"]), "region");
  assert.equal(precisionFromTypes(["listed building", "cemetery"]), "point");
  assert.equal(precisionFromTypes(["human settlement", "castle"]), "building");
  assert.equal(precisionFromTypes([]), "unknown");
  assert.equal(precisionFromTypes(["obscure classification"]), "unknown");
});

test("what a place is, not where it is", () => {
  // Live: Moray House School is described as "faculty in City of Edinburgh". Nothing in
  // "faculty" is in the vocabulary, so "city" won and a university building was drawn as
  // a settlement-sized area on the map.
  assert.equal(precisionOf({ typeLabel: "faculty in City of Edinburgh" }), "unknown");
  assert.equal(precisionOf({ typeLabel: "castle in West Lothian, Scotland" }), "building");
  assert.equal(precisionOf({ typeLabel: "graveyard surrounding Greyfriars Kirk in Edinburgh" }), "point");
  assert.equal(precisionOf({ typeLabel: "capital city of Scotland" }), "settlement");
});

test("the words a live run added, each because a real place was pinned as a doorway", () => {
  // Kensington, Wandsworth and Notting Hill all carry Wikidata's "area of London" and
  // were all drawn as dots; Greyfriars is a kirkyard, which "graveyard" does not catch.
  assert.equal(precisionOf({ typeLabel: "area of London" }), "settlement");
  assert.equal(precisionOf({ typeLabel: "kirkyard" }), "point");
  assert.equal(precisionOf({ typeLabel: "zoo" }), "building");
  assert.equal(precisionOf({ typeLabel: "market hall" }), "building");
});
