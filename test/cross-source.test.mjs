import assert from "node:assert/strict";
import test from "node:test";

import {
  clusterByPlace,
  corroborateWork,
  corroborationsFor,
  hasPoint,
} from "../app/lib/cross-source.mjs";

const mm = (o = {}) => ({ id: "mm1", source_kind: "moviemaps", place_name: "The Bradbury Building", lat: 34.0505, lng: -118.2478, ...o });
const rs = (o = {}) => ({ id: "rs1", source_kind: "reelstreets", place_name: "Bradbury Building", lat: null, lng: null, ...o });
const ml = (o = {}) => ({ id: "ml1", source_kind: "movielocations", place_name: "Bradbury Building", lat: null, lng: null, ...o });

test("two sources naming one place form a cluster", () => {
  const clusters = clusterByPlace([mm(), rs(), ml({ place_name: "Union Station" })]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].length, 2);
});

test("one source agreeing with itself is not corroboration", () => {
  // Two moviemaps rows for one place is a duplicate, not a second opinion.
  const updates = corroborationsFor([mm(), mm({ id: "mm2" })]);
  assert.deepEqual(updates, []);
});

test("a corroborated row records who agreed with it", () => {
  const updates = corroborationsFor([mm(), rs()]);
  const forReelstreets = updates.find((u) => u.id === "rs1");
  assert.equal(forReelstreets.corroborated_by.length, 1);
  assert.equal(forReelstreets.corroborated_by[0].source_kind, "moviemaps");
});

test("a pointless row borrows a point, and says it borrowed it", () => {
  const updates = corroborationsFor([mm(), rs()]);
  const forReelstreets = updates.find((u) => u.id === "rs1");
  assert.equal(forReelstreets.lat, 34.0505);
  // The distinction that matters: this coordinate was measured by another
  // source, not by the one holding the row.
  assert.equal(forReelstreets.geocode_source, "moviemaps_via_corroboration");
  assert.equal(forReelstreets.geocode_reason, "matched_place_in_another_source");
  assert.equal(forReelstreets.corroborated_by[0].gave_coordinate, true);
});

test("a row that already has a point keeps it", () => {
  const updates = corroborationsFor([mm(), rs({ lat: 34.06, lng: -118.25 })]);
  const forReelstreets = updates.find((u) => u.id === "rs1");
  assert.equal(forReelstreets.lat, undefined);
  assert.equal(forReelstreets.geocode_source, undefined);
  // It is still corroborated — the agreement stands even without a transfer.
  assert.equal(forReelstreets.corroborated_by.length, 1);
});

test("only a source that measures its own points may donate", () => {
  // Neither reelstreets nor movielocations measures coordinates, so a point
  // one of them borrowed must not be lent onward as though it were theirs.
  const updates = corroborationsFor([rs({ lat: 1, lng: 2 }), ml()]);
  const forMovielocations = updates.find((u) => u.id === "ml1");
  assert.equal(forMovielocations.lat, undefined);
  assert.equal(forMovielocations.corroborated_by.length, 1);
});

test("names must match by the project's own rule, not fuzzily", () => {
  // place-dedup refuses this pair deliberately: a short edit apart, different
  // museums. Corroboration must inherit that refusal, not relax it.
  const clusters = clusterByPlace([
    mm({ place_name: "National Gallery" }),
    rs({ place_name: "National Portrait Gallery" }),
  ]);
  assert.equal(clusters.length, 2);
});

test("hasPoint refuses the shapes that look like coordinates", () => {
  assert.equal(hasPoint({ lat: 0, lng: 0 }), true);   // Null Island is the gate's job
  assert.equal(hasPoint({ lat: null, lng: 5 }), false);
  assert.equal(hasPoint({}), false);
});

test("a whole work resolves to one update list", () => {
  const updates = corroborateWork([mm(), rs(), ml(), mm({ id: "mm2", place_name: "Union Station" })]);
  // Three rows in the Bradbury cluster all gain; the lone Union Station does not.
  assert.equal(updates.length, 3);
  assert.ok(updates.every((u) => u.corroborated_by.length >= 1));
});
