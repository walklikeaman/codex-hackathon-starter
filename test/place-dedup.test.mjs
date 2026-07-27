import assert from "node:assert/strict";
import test from "node:test";

import {
  canMerge,
  DEDUP_RADIUS_M,
  dedupePlaces,
  groupPlaces,
  mergeGroup,
  metresApart,
  namesMatch,
  normalizePlaceName,
} from "../app/lib/place-dedup.mjs";

const place = (overrides = {}) => ({
  id: "p1",
  name: "Bradbury Building",
  lat: 34.0505,
  lng: -118.2478,
  geocode_precision: "building",
  place_class: "real",
  wikidata_id: null,
  confidence: 0.8,
  work_ids: [],
  ...overrides,
});

// --- the pairs that actually exist in production ----------------------------
// Every one of these is a REAL pair from the live graph, and every one of them is
// two different places. They are the reason this module exists in this shape: a
// plain "within N metres" rule would have merged all six.

test("a landmark ON a square is not the square", () => {
  const gallery = place({ id: "ng", name: "National Gallery", lat: 51.5089, lng: -0.1283 });
  const square = place({ id: "ts", name: "Trafalgar Square", lat: 51.508, lng: -0.128 });

  assert.ok(metresApart(gallery, square) < 250);
  assert.equal(canMerge(gallery, square), false);
});

test("a CITY centroid is never merged into a place that happens to be 100 m away", () => {
  // The worst possible merge. A source that said only "London" would silently
  // become a source that said "Trafalgar Square" — a claim nobody ever made.
  const london = place({ id: "ldn", name: "London", lat: 51.5074, lng: -0.1278, geocode_precision: "city" });
  const square = place({ id: "ts", name: "Trafalgar Square", lat: 51.508, lng: -0.128 });

  assert.ok(metresApart(london, square) < 250);
  assert.equal(canMerge(london, square), false);
});

test("two city centroids are not merged with each other either", () => {
  // Neither side is precise enough to support the claim "the same place".
  const a = place({ id: "a", name: "London", lat: 51.5074, lng: -0.1278, geocode_precision: "city" });
  const b = place({ id: "b", name: "London", lat: 51.5074, lng: -0.1278, geocode_precision: "city" });
  assert.equal(canMerge(a, b), false);
});

test("a station ON a street is not the street", () => {
  const station = place({ id: "ald", name: "Aldwych tube station", lat: 51.5115, lng: -0.1171 });
  const strand = place({ id: "str", name: "Strand", lat: 51.5109, lng: -0.1195, geocode_precision: "street" });
  assert.equal(canMerge(station, strand), false);
});

// --- what SHOULD merge -------------------------------------------------------

test("the same building imported twice under the same name is one place", () => {
  const a = place({ id: "a", work_ids: ["w1"] });
  const b = place({ id: "b", lat: 34.05052, lng: -118.24782, work_ids: ["w2"] });

  assert.ok(metresApart(a, b) <= DEDUP_RADIUS_M);
  assert.equal(canMerge(a, b), true);
});

test("a merged place carries every work that was seen there", () => {
  // The point of merging: one pin, many films — not one film losing its link.
  const merged = mergeGroup([
    place({ id: "a", work_ids: ["blade-runner"] }),
    place({ id: "b", work_ids: ["500-days"], lat: 34.05052 }),
  ]);
  assert.deepEqual(merged.work_ids.sort(), ["500-days", "blade-runner"]);
  assert.equal(merged.merged_count, 2);
  assert.deepEqual(merged.merged_from, ["a", "b"]);
});

test("the surviving row is the canonical one, and its coordinate is real", () => {
  // Averaging two coordinates would invent a spot no source ever named.
  const canonical = place({ id: "q", wikidata_id: "Q1000", lat: 34.0505, confidence: 0.5 });
  const guessed = place({ id: "g", wikidata_id: null, lat: 34.05053, confidence: 0.99 });

  const merged = mergeGroup([guessed, canonical]);
  assert.equal(merged.id, "q");
  assert.equal(merged.lat, 34.0505);
});

// --- the rules, one at a time ------------------------------------------------

test("two distinct Wikidata entities are two places, however close", () => {
  // Wikidata already decided these are different things; we do not overrule it.
  const a = place({ id: "a", wikidata_id: "Q1", name: "Same Name" });
  const b = place({ id: "b", wikidata_id: "Q2", name: "Same Name", lat: 34.05051 });
  assert.equal(canMerge(a, b), false);

  const sameEntity = place({ id: "c", wikidata_id: "Q1", name: "Same Name", lat: 34.05051 });
  assert.equal(canMerge(a, sameEntity), true);
});

test("a studio is not merged with the street it stands on", () => {
  // They make different claims: one depicts elsewhere, the other IS the location.
  const studio = place({ id: "s", name: "Ealing Studios", place_class: "studio" });
  const street = place({ id: "r", name: "Ealing Studios", place_class: "real", lat: 34.05051 });
  assert.equal(canMerge(studio, street), false);
});

test("distance is required, not just a matching name", () => {
  const here = place({ id: "a", name: "Victoria Station" });
  const faraway = place({ id: "b", name: "Victoria Station", lat: 51.4952, lng: -0.1441 });
  assert.equal(canMerge(here, faraway), false);
});

test("a place with no coordinate merges with nothing", () => {
  const located = place({ id: "a" });
  const unlocated = place({ id: "b", lat: null, lng: null });
  assert.equal(metresApart(located, unlocated), null);
  assert.equal(canMerge(located, unlocated), false);
});

test("a missing coordinate is not read as 0,0", () => {
  // Null Island again: Number(null) === 0 would put this in the Gulf of Guinea and
  // make it "40 m" from anything else that also failed to parse.
  const a = place({ id: "a", lat: null, lng: null });
  const b = place({ id: "b", lat: undefined, lng: "" });
  assert.equal(metresApart(a, b), null);
  assert.equal(canMerge(a, b), false);
});

// --- names -------------------------------------------------------------------

test("place names survive normalisation outside the Latin alphabet", () => {
  // The work-title normaliser folds to a-z0-9, which empties these entirely and
  // would disable dedup for most of the world.
  assert.equal(normalizePlaceName("Красная площадь"), "красная площадь");
  assert.equal(normalizePlaceName("東京タワー"), "東京タワー");
  assert.ok(namesMatch("Красная площадь", "Красная  площадь!"));
});

test("accents and punctuation do not split one place into two", () => {
  assert.ok(namesMatch("Café de Flore", "Cafe de Flore"));
  assert.ok(namesMatch("St. Paul's Cathedral", "St Pauls Cathedral"));
});

test("a leading article does not split one place into two", () => {
  assert.ok(namesMatch("The Bradbury Building", "Bradbury Building"));
});

test("names that merely look similar are different places", () => {
  // One word apart, two different museums standing 200 m from each other.
  assert.equal(namesMatch("National Gallery", "National Portrait Gallery"), false);
  assert.equal(namesMatch("Victoria Station", "Victoria Park"), false);
  assert.equal(namesMatch("", "anything"), false);
});

// --- grouping ----------------------------------------------------------------

test("grouping leaves distinct places alone", () => {
  const places = [
    place({ id: "ng", name: "National Gallery", lat: 51.5089, lng: -0.1283 }),
    place({ id: "ts", name: "Trafalgar Square", lat: 51.508, lng: -0.128 }),
    place({ id: "ldn", name: "London", lat: 51.5074, lng: -0.1278, geocode_precision: "city" }),
  ];
  assert.equal(groupPlaces(places).length, 3);
  assert.equal(dedupePlaces(places).length, 3);
});

test("a place only joins a group it matches ENTIRELY", () => {
  // Merging is not transitive: A~B and B~C does not make A~C. Chaining would let a
  // string of 40 m hops swallow a whole street.
  const a = place({ id: "a", lat: 34.05, lng: -118.2478 });
  const b = place({ id: "b", lat: 34.05025, lng: -118.2478 }); // ~28 m from a
  const c = place({ id: "c", lat: 34.0505, lng: -118.2478 });  // ~28 m from b, ~56 m from a

  assert.ok(canMerge(a, b) && canMerge(b, c));
  assert.equal(canMerge(a, c), false);
  assert.equal(groupPlaces([a, b, c]).length, 2); // c does not join {a, b}
});

test("dedupePlaces survives junk", () => {
  assert.deepEqual(dedupePlaces(null), []);
  assert.deepEqual(dedupePlaces([]), []);
  assert.equal(mergeGroup([]), null);
  assert.equal(mergeGroup(null), null);
});
