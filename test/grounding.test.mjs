import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIDENCE_BANDS,
  MAP_THRESHOLD,
  METHOD_PRIORS,
  PLACE_CLASSES,
  confidenceBand,
  fuseConfidence,
  hasValidCoordinate,
  isEvidenceMethod,
  isGeocodedClass,
  isPlaceClass,
  isPublishable,
} from "../app/lib/grounding.mjs";

test("place-class vocabulary is the single fixed enum", () => {
  assert.ok(isPlaceClass("real_exterior"));
  assert.ok(isPlaceClass("studio_interior"));
  assert.ok(isPlaceClass("fictional"));
  assert.ok(!isPlaceClass("studio")); // rejected legacy name
  assert.ok(!isPlaceClass(undefined));
  assert.equal(PLACE_CLASSES.length, 6);
});

test("only fictional is a non-geocoded class", () => {
  assert.ok(isGeocodedClass("real_exterior"));
  assert.ok(isGeocodedClass("narrative_real"));
  assert.ok(!isGeocodedClass("fictional"));
  assert.ok(!isGeocodedClass("nonsense"));
});

test("evidence methods are a closed set", () => {
  assert.ok(isEvidenceMethod("wikidata_statement"));
  assert.ok(isEvidenceMethod("geoclip_infer"));
  assert.ok(!isEvidenceMethod("made_up_method"));
});

test("confidenceBand honors the fixed thresholds", () => {
  assert.equal(confidenceBand(0.9), "verified");
  assert.equal(confidenceBand(CONFIDENCE_BANDS.verified), "verified");
  assert.equal(confidenceBand(0.5), "candidate");
  assert.equal(confidenceBand(CONFIDENCE_BANDS.candidate), "candidate");
  assert.equal(confidenceBand(0.3), "weak");
  assert.equal(confidenceBand(Number.NaN), "weak");
  assert.equal(MAP_THRESHOLD, CONFIDENCE_BANDS.candidate);
});

test("fuseConfidence returns 0 with no supporting evidence", () => {
  assert.deepEqual(fuseConfidence([]), { confidence: 0, band: "weak", supporting: 0 });
  assert.deepEqual(fuseConfidence(null), { confidence: 0, band: "weak", supporting: 0 });
});

test("a single wikidata statement clears the verified band", () => {
  const r = fuseConfidence([{ method: "wikidata_statement" }]);
  assert.equal(r.confidence, METHOD_PRIORS.wikidata_statement); // 0.9
  assert.equal(r.band, "verified");
  assert.equal(r.supporting, 1);
});

test("a lone geoclip guess stays below the map threshold", () => {
  const r = fuseConfidence([{ method: "geoclip_infer", agrees: null }]);
  assert.equal(r.confidence, METHOD_PRIORS.geoclip_infer); // 0.2
  assert.ok(r.confidence < MAP_THRESHOLD);
  assert.equal(r.band, "weak");
});

test("noisy-OR combines independent supporting evidence", () => {
  // geoclip 0.2 + commons 0.6 + vision 0.8 → 1 - (0.8*0.4*0.2) = 0.936
  const r = fuseConfidence([
    { method: "geoclip_infer", agrees: null },
    { method: "commons_geosearch", agrees: true },
    { method: "vision_verify", agrees: true },
  ]);
  assert.equal(r.confidence, 0.936);
  assert.equal(r.band, "verified");
  assert.equal(r.supporting, 3);
});

test("contradicting evidence penalizes the confidence", () => {
  const supportOnly = fuseConfidence([{ method: "web_search_cited", agrees: true }]);
  const withContra = fuseConfidence([
    { method: "web_search_cited", agrees: true },
    { method: "vision_verify", agrees: false },
  ]);
  assert.ok(withContra.confidence < supportOnly.confidence);
  // 0.55 * (1 - 0.8) = 0.11
  assert.equal(withContra.confidence, 0.11);
});

test("an explicit per-row weight overrides the method prior", () => {
  const r = fuseConfidence([{ method: "geoclip_infer", agrees: true, weight: 0.7 }]);
  assert.equal(r.confidence, 0.7);
});

test("unknown evidence methods are ignored, never invented", () => {
  const r = fuseConfidence([
    { method: "totally_unknown", agrees: true },
    { method: "wikidata_statement" },
  ]);
  assert.equal(r.supporting, 1);
  assert.equal(r.confidence, 0.9);
});

test("hasValidCoordinate rejects NaN and out-of-range", () => {
  assert.ok(hasValidCoordinate(51.5, -0.12));
  assert.ok(!hasValidCoordinate(Number.NaN, 0));
  assert.ok(!hasValidCoordinate(91, 0));
  assert.ok(!hasValidCoordinate(0, -181));
});

test("isPublishable enforces the never-invent invariant", () => {
  const real = { place_class: "real_exterior", lat: 51.5, lng: -0.12 };
  const evidence = [{ method: "wikidata_statement" }];
  assert.ok(isPublishable(real, evidence)); // evidence + valid coords

  assert.ok(!isPublishable(real, [])); // no evidence → not published
  assert.ok(!isPublishable({ ...real, lat: null }, evidence)); // no coords
  assert.ok(!isPublishable({ place_class: "fictional", lat: 51.5, lng: -0.12 }, evidence)); // fiction → chip, not pin
  assert.ok(!isPublishable({ place_class: "studio", lat: 51.5, lng: -0.12 }, evidence)); // invalid class
});
