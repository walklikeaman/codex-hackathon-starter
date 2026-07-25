import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinateOrNull,
  finiteOrNull,
  inRangeOrNull,
  integerOrNull,
} from "../app/lib/numbers.mjs";

test("an ABSENT value is never zero — the bug this module exists to end", () => {
  // Number(null), Number(undefined) and Number("") are all 0, a perfectly
  // valid-looking number. That produced Null Island pins, a phantom map viewport, a
  // photo search off the coast of Africa, and a "Scene 0" label.
  for (const absent of [null, undefined, "", "   "]) {
    assert.equal(finiteOrNull(absent), null, `expected null for ${JSON.stringify(absent)}`);
  }
  assert.equal(Number(null), 0); // the trap itself, documented
});

test("finiteOrNull passes real numbers through, including zero", () => {
  // Zero is a legitimate value when it was actually supplied — the equator exists.
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull("0"), 0);
  assert.equal(finiteOrNull(-0.5), -0.5);
  assert.equal(finiteOrNull("51.508"), 51.508);
  assert.equal(finiteOrNull(NaN), null);
  assert.equal(finiteOrNull(Infinity), null);
  assert.equal(finiteOrNull("abc"), null);
});

test("inRangeOrNull rejects out-of-range as firmly as absent", () => {
  assert.equal(inRangeOrNull("51.5", { min: -90, max: 90 }), 51.5);
  assert.equal(inRangeOrNull("91", { min: -90, max: 90 }), null);
  assert.equal(inRangeOrNull(null, { min: -90, max: 90 }), null);
  assert.equal(inRangeOrNull(-90, { min: -90, max: 90 }), -90); // inclusive
});

test("integerOrNull truncates rather than rounds", () => {
  // "I'm on chapter 7.9" means chapter 7 has been read, not chapter 8.
  assert.equal(integerOrNull(7.9), 7);
  assert.equal(integerOrNull("12"), 12);
  assert.equal(integerOrNull(-3.7), -3);
  assert.equal(integerOrNull(""), null);
});

test("coordinateOrNull refuses a half-supplied pair", () => {
  assert.deepEqual(coordinateOrNull("51.5", "-0.12"), { lat: 51.5, lng: -0.12 });
  // A latitude with no longitude is not a location — and must not become 51.5,0.
  assert.equal(coordinateOrNull("51.5", null), null);
  assert.equal(coordinateOrNull(null, "-0.12"), null);
  assert.equal(coordinateOrNull("91", "0"), null);
  // 0,0 is only returned when both were genuinely given.
  assert.deepEqual(coordinateOrNull(0, 0), { lat: 0, lng: 0 });
});
