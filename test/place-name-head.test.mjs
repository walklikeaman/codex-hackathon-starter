import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_RADIUS_KM,
  IMMEDIATE_AREA_RADIUS_KM,
  areasFromHint,
  hintIsAnIndexBucket,
  headIsInsideArea,
  radiusForAreaIndex,
  headRefusal,
  placeArea,
  placeHead,
  splitPlacePhrase,
} from "../app/lib/place-name-head.mjs";

// Every string below is a real `place_name` from the live queue.

// --- the head: what a gazetteer can be asked ------------------------------------

test("an address gives up its venue", () => {
  assert.equal(placeHead("Millennium Biltmore Hotel, South Grand Avenue Entrance, Downtown Los Angeles"),
    "Millennium Biltmore Hotel");
  assert.equal(placeHead("Queen's Gate Mews, Kensington, London SW7"), "Queen's Gate Mews");
  assert.equal(placeHead("The Black Friar, Queen Victoria Street, Blackfriars, London EC4"), "Black Friar");
});

test("prose gives up its subject and drops where it stood", () => {
  // ReelStreets names are written by people describing a camera position. Everything from
  // the first locative preposition on is precise, deliberate and unanswerable by a
  // gazetteer.
  assert.equal(placeHead("Star Tavern public house at the corner of St. John's Wood Terrace and Charlbert Street"),
    "Star Tavern public house");
  assert.equal(placeHead("Bristol Temple Meads station on Station Approach off Bath Road in Bristol, Avon"),
    "Bristol Temple Meads station");
  assert.equal(placeHead("Midford Brook below Kennels Farm at the end of Waterhouse Lane to the south-west of Monkton Combe"),
    "Midford Brook");
});

// --- the refusals, each one a measured wrong answer ------------------------------

test("a head that is only a common noun is refused", () => {
  // "the alley at the corner of Seaford Road and Leeland Terrace in W13" reduces to
  // "alley", and Wikidata answers with a place in Israel.
  assert.equal(headRefusal("alley"), "head_is_a_common_noun");
  assert.equal(headRefusal("station"), "head_is_a_common_noun");
  assert.equal(headRefusal("public house"), "head_is_a_common_noun");
  // The word may still APPEAR in a head — these are real places.
  assert.equal(headRefusal("Sonning Bridge"), null);
  assert.equal(headRefusal("Box Tunnel"), null);
  assert.equal(headRefusal("Star Tavern public house"), null);
});

test("a road is a line, not a point", () => {
  // "A82 at Rannoch Moor near Lochan na h-Achlaise" reduces to "A82", which Wikidata
  // places at the road's southern end in Glasgow — 80 km from the scene, on the right
  // road and in the wrong place.
  assert.equal(headRefusal("A82"), "road_is_a_line_not_a_point");
  assert.equal(headRefusal("M1"), "road_is_a_line_not_a_point");
  assert.equal(headRefusal("A1(M)"), "road_is_a_line_not_a_point");
  assert.equal(headRefusal("Route 66"), "road_is_a_line_not_a_point");
  // A named road is not a designation and stays answerable.
  assert.equal(headRefusal("North Bridge Road"), null);
});

test("an empty or letterless head is refused", () => {
  assert.equal(headRefusal(""), "no_head");
  assert.equal(headRefusal("—"), "head_has_no_letters");
  assert.equal(headRefusal("St"), "head_too_short");
});

// --- the area: the thing that proves the head is the right one -------------------

test("the area is the last clause, because these addresses run specific-first", () => {
  assert.equal(placeArea("Queen's Gate Mews, Kensington, London SW7"), "London");
  assert.equal(placeArea("Kladruby Monastery, Kladruby, Czech Republic"), "Czech Republic");
  assert.equal(placeArea("Cartwright Hall, Lister Park, Bradford, West Yorkshire"), "West Yorkshire");
});

test("a bare postcode is not an area, so the clause before it answers", () => {
  // "London SW7" loses its outward code and stays London; a clause that is ONLY a
  // postcode has nothing left and the search moves inwards.
  assert.equal(placeArea("The Ivy, West Street, WC2"), "West Street");
  assert.equal(placeArea("Some Pub, Leinster Gardens, Bayswater, London W2"), "London");
});

test("prose names its area only with a trailing \"in <somewhere>\"", () => {
  // A comma still wins when there is one: Avon is the county Bristol sits in, and it is
  // a perfectly good thing to check a Bristol station against.
  assert.equal(placeArea("Bristol Temple Meads station on Station Approach off Bath Road in Bristol, Avon"),
    "Avon");
  assert.equal(placeArea("Roughdown Road to the east of Hemel Hempstead and Boxmoor station in Boxmoor"),
    "Boxmoor");
  // "near"/"off"/"at" introduce the neighbouring STREET, not an area. Anchoring a pub to
  // a kerb would confirm nothing, so this returns null and the row is refused.
  assert.equal(placeArea("Star Tavern public house at the corner of St. John's Wood Terrace and Charlbert Street"),
    null);
});

test("a bare preposition cuts only when a name is left standing", () => {
  // "on", "at" and "in" also occur INSIDE names.
  assert.equal(placeHead("Stoke on Trent"), "Stoke on Trent");
  assert.equal(placeHead("Bristol Temple Meads station on Station Approach"), "Bristol Temple Meads station");
});

test("a name with nothing enclosing it has no area", () => {
  assert.equal(placeArea("Fairfield Hall"), null);
});

// --- the whole decision ----------------------------------------------------------

test("a head with no area is refused rather than believed", () => {
  // This is the rule that matters. Asking for the first clause alone takes the sample
  // from 0.8% to 31.7% "resolved", and that number includes Zorba (a restaurant on
  // Leinster Gardens) landing in Colorado. Without an area there is nothing to check
  // against, and an unchecked head is where the wrong continents come from.
  const bare = splitPlacePhrase("Fairfield Hall");
  assert.equal(bare.refusal, "no_area_to_check_against");
  assert.equal(bare.area, null);
});

test("a usable phrase yields both halves", () => {
  const split = splitPlacePhrase("Millennium Biltmore Hotel, South Grand Avenue Entrance, Downtown Los Angeles");
  assert.equal(split.head, "Millennium Biltmore Hotel");
  assert.equal(split.area, "Downtown Los Angeles");
  assert.equal(split.refusal, null);
});

test("a refused head never reaches the area step", () => {
  const split = splitPlacePhrase("the alley at the corner of Seaford Road and Leeland Terrace in W13");
  assert.equal(split.head, null);
  assert.equal(split.refusal, "head_is_a_common_noun");
});

// --- containment: the check the geocoder cannot make for us ----------------------

test("a lone candidate on the wrong continent is caught by its area", () => {
  // chooseCandidate reports "unique" for a single result wherever it is — it is choosing
  // between candidates, not checking one against the world. Zorba's only candidate is in
  // Colorado; the phrase says London.
  const colorado = { lat: 39.706, lng: -107.695 };
  const london = { lat: 51.507, lng: -0.128 };
  assert.equal(headIsInsideArea(colorado, london), false);

  const biltmore = { lat: 34.050, lng: -118.254 };
  const losAngeles = { lat: 34.052, lng: -118.243 };
  assert.equal(headIsInsideArea(biltmore, losAngeles), true);
});

test("an unresolved area cannot confirm anything", () => {
  assert.equal(headIsInsideArea({ lat: 51.5, lng: -0.1 }, null), false);
  assert.equal(headIsInsideArea(null, { lat: 51.5, lng: -0.1 }), false);
  // Null Island is a legal pair of numbers and the signature of one that was never
  // parsed; it must not silently confirm a place off West Africa.
  assert.equal(headIsInsideArea({ lat: 0, lng: 0 }, { lat: 51.5, lng: -0.1 }), false);
});

test("the radius is the same 100 km the geocoder already uses for a hint", () => {
  assert.equal(AREA_RADIUS_KM, 100);
  const london = { lat: 51.507, lng: -0.128 };
  // Brighton, 76 km away, is inside the same area for this purpose.
  assert.equal(headIsInsideArea({ lat: 50.827, lng: -0.153 }, london), true);
  // Bristol, 170 km, is not.
  assert.equal(headIsInsideArea({ lat: 51.454, lng: -2.588 }, london), false);
});

// --- the radius depends on how big the area is -----------------------------------

test("a street-level area demands a street-level distance", () => {
  // Measured on the first batch of 1,000: "Bedales, Bedale Street, Borough Market, London
  // SE1" was confirmed by Bedale Street — and Bedales is a school in Hampshire, 80 km
  // away. Inside 100 km, and a completely wrong pin.
  const bedaleStreet = { lat: 51.505, lng: -0.090 };
  const bedalesSchool = { lat: 51.020, lng: -0.911 };
  assert.equal(headIsInsideArea(bedalesSchool, bedaleStreet, radiusForAreaIndex(0)), false);
  assert.equal(headIsInsideArea(bedalesSchool, bedaleStreet, radiusForAreaIndex(1)), true);

  // And the tight tier keeps the ones that are genuinely on the street it names.
  const ropemakerStreet = { lat: 51.5195, lng: -0.0888 };
  const cityPoint = { lat: 51.5194, lng: -0.0885 };
  assert.equal(headIsInsideArea(cityPoint, ropemakerStreet, radiusForAreaIndex(0)), true);
});

test("the two radii are the two sizes of thing an area can be", () => {
  assert.equal(radiusForAreaIndex(0), IMMEDIATE_AREA_RADIUS_KM);
  assert.equal(radiusForAreaIndex(1), AREA_RADIUS_KM);
  assert.equal(radiusForAreaIndex(2), AREA_RADIUS_KM);
  assert.ok(IMMEDIATE_AREA_RADIUS_KM < AREA_RADIUS_KM);
});

// --- the row's own hint, and the one source whose hint is a lie ------------------

test("an alphabetical index bucket is not an area", () => {
  // ReelStreets files every row under a section of its own browse index. Measured on the
  // pending rows: 2,676 of them. The TITLES are bucketed, not the places — so
  // "Pavilion Theatre on Westover Road, Bournemouth" carries "London M-N", and using it
  // would confirm Bournemouth as London, 160 km wrong, by the very check whose job is to
  // catch that. The bucket resolves (to London), so nothing downstream would notice.
  assert.equal(hintIsAnIndexBucket("London M-N"), true);
  assert.equal(hintIsAnIndexBucket("London A-B"), true);
  assert.equal(hintIsAnIndexBucket("London T–Z"), true);
  assert.deepEqual(areasFromHint("London H-L"), []);

  // movie-locations has no such shape: all 117 of its distinct hints are real places.
  assert.equal(hintIsAnIndexBucket("Los Angeles"), false);
  assert.deepEqual(areasFromHint("Hampshire"), ["Hampshire"]);
});

test("a hint rescues a name that encloses itself in nothing", () => {
  // 703 movie-locations rows and 18 wikipedia rows name no area of their own.
  const rescued = splitPlacePhrase("Fairfield Hall", { areaHint: "Hampshire" });
  assert.equal(rescued.refusal, null);
  assert.deepEqual(rescued.areas, ["Hampshire"]);

  // And a bucket rescues nothing, on purpose.
  const refused = splitPlacePhrase("Big Ben", { areaHint: "London H-L" });
  assert.equal(refused.refusal, "no_area_to_check_against");
});

test("the hint goes last, because it is the coarsest thing available", () => {
  // The ordering is the whole mechanism: the tightest area answers first, and a hint is
  // never tighter than a clause the row wrote about itself.
  const split = splitPlacePhrase("the Old Mission San Juan Bautista, California", { areaHint: "San Francisco" });
  assert.deepEqual(split.areas, ["California", "San Francisco"]);
});

test("a worthless hint is asked rather than second-guessed", () => {
  // "Rest Of The World" and "North" are hints too. They are not index buckets, and the
  // gazetteer refuses them by itself — which is where that judgement belongs.
  assert.deepEqual(areasFromHint("Rest Of The World"), ["Rest Of The World"]);
  assert.deepEqual(areasFromHint(""), []);
  assert.deepEqual(areasFromHint(null), []);
});
