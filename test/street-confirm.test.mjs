import assert from "node:assert/strict";
import test from "node:test";

import { confirmStreet, metresToLine, parseStreets, STREET_RADIUS_M, streetName, streetQuery } from "../app/lib/street-confirm.mjs";

// Cable Street, London E1, as a straight east–west line at 51.5110.
const cable = { osm_id: "way/4", name: "Cable Street", line: [{ lat: 51.511, lng: -0.07 }, { lat: 51.511, lng: -0.06 }] };
const north = (metres) => 51.511 + metres / 111320;

test("a name is a street when its last word says so, without its house number", () => {
  assert.equal(streetName("Cable Street, London E1"), "Cable Street");
  assert.equal(streetName("102 Poplar Road"), "Poplar Road");
  assert.equal(streetName("Therapia Road, Honor Oak, London SE22"), "Therapia Road");
  assert.equal(streetName("27 St. Luke's Mews"), "St. Luke's Mews");
  assert.equal(streetName("Bourne Woods"), null);
  assert.equal(streetName("Tate Modern, Bankside, London"), null);
  // One word is a street type, not a street.
  assert.equal(streetName("Road"), null);
});

test("a pin on the named street is confirmed as the street, and is not moved", () => {
  const result = confirmStreet({ lat: north(12), lng: -0.065, name: "Cable Street, London E1", streets: [cable] });
  assert.equal(result.confirmed, true);
  assert.equal(result.geocode_precision, "street");
  assert.equal(result.osm_street_id, "way/4");
  assert.equal("lat" in result, false, "confirming never moves the pin");
});

test("a pin a street away is not on it", () => {
  const result = confirmStreet({ lat: north(STREET_RADIUS_M + 15), lng: -0.065, name: "Cable Street", streets: [cable] });
  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "no_such_street_here");
});

test("only the street of that exact name confirms it", () => {
  const mews = { ...cable, osm_id: "way/5", name: "Cable Street Mews" };
  assert.equal(confirmStreet({ lat: north(5), lng: -0.065, name: "Cable Street", streets: [mews] }).confirmed, false);
  assert.equal(confirmStreet({ lat: north(5), lng: -0.065, name: "Bourne Woods", streets: [cable] }).reason, "not_a_street_name");
});

test("several segments of one street are one street: the nearest confirms it", () => {
  const far = { ...cable, osm_id: "way/9", line: [{ lat: north(25), lng: -0.07 }, { lat: north(25), lng: -0.06 }] };
  const result = confirmStreet({ lat: north(20), lng: -0.065, name: "102 Cable Street", streets: [cable, far] });
  assert.equal(result.osm_street_id, "way/9");
});

test("distance is to the line, with no closing edge back to its start", () => {
  // An L-shaped street: a closing edge would run diagonally past the corner.
  const l = [{ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.09 }, { lat: 51.51, lng: -0.09 }];
  const nearTheMissingEdge = { lat: 51.505, lng: -0.095 };
  assert.ok(metresToLine(nearTheMissingEdge, l) > 300);
});

test("the query asks for named roads around the pin, and parsing keeps only those", () => {
  assert.match(streetQuery(51.5, -0.1), /way\["highway"\]\["name"\]\(around:30,51.5,-0.1\)/);
  const parsed = parseStreets({ elements: [
    { type: "way", id: 1, tags: { highway: "residential", name: "Cable Street" }, geometry: [{ lat: 51.5, lon: -0.1 }] },
    { type: "way", id: 2, tags: { highway: "footway" }, geometry: [] },
    { type: "way", id: 3, tags: { building: "yes", name: "Cable Street" }, geometry: [] },
  ] });
  assert.deepEqual(parsed.map((street) => street.osm_id), ["way/1"]);
});
