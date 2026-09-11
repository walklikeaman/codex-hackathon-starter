import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PIN, MIN_PIN, pinClasses, pinHtml, pinIconKey, pinKind, pinLabel, pinSize, PIN_KIND, PIN_LEGEND,
} from "../app/lib/map-pin.mjs";

// The map grew three pin systems from three code paths — an amber diamond, a filled circle,
// a hollow circle — for one idea. These tests are the reconciliation: one shape, and the
// things that vary are the things that actually differ.

test("one film prints no number, because a 1 on every pin is noise", () => {
  // The number exists to mark the points that HIDE something. 566 of the 2,024 Los Angeles
  // points carry more than one film; the rest should stay quiet.
  assert.equal(pinLabel(1), "");
  assert.equal(pinLabel(0), "");
  assert.equal(pinLabel(null), "");
  assert.equal(pinLabel(undefined), "");
});

test("several films print the count", () => {
  assert.equal(pinLabel(2), "2");
  assert.equal(pinLabel(96), "96");
});

test("a count too wide to fit is truncated visibly, not silently", () => {
  assert.equal(pinLabel(1000), "999+");
});

test("the pin grows logarithmically, so 5 and 96 do not draw the same", () => {
  // Linear saturates against the clamp at once, which is the mistake the cluster bubbles
  // already corrected once.
  assert.equal(pinSize(1), MIN_PIN);
  assert.ok(pinSize(5) > pinSize(1));
  assert.ok(pinSize(96) > pinSize(5));
  assert.ok(pinSize(100000) <= MAX_PIN, "and it never grows without bound");
});

test("filled means checked, outlined means nobody has looked", () => {
  // Evidence, not decoration: 32,138 located rows are unchecked and only 92 facts are not.
  assert.match(pinClasses({ checked: true }), /is-checked/);
  assert.match(pinClasses({ checked: false }), /is-unchecked/);
  assert.equal(/is-checked/.test(pinClasses({ checked: false })), false);
});

test("a studio lot is its own kind, whatever else is true of it", () => {
  assert.equal(pinKind({ depicts_elsewhere: true }), PIN_KIND.studio);
  assert.match(pinClasses({ depicts_elsewhere: true, checked: true }), /is-studio/);
  // And it keeps the checked distinction rather than replacing it.
  assert.match(pinClasses({ depicts_elsewhere: true, checked: true }), /is-checked/);
});

test("selection is a ring, and never changes what the pin says it is", () => {
  const plain = pinClasses({ depicts_elsewhere: true, checked: true, filmCount: 4 });
  const picked = pinClasses({ depicts_elsewhere: true, checked: true, filmCount: 4, selected: true });
  assert.match(picked, /is-selected/);
  for (const token of plain.split(" ")) assert.match(picked, new RegExp(token.replace(/[-]/g, "\\-")));
});

test("a point with several films is marked as one", () => {
  assert.match(pinClasses({ filmCount: 12 }), /has-many/);
  assert.equal(/has-many/.test(pinClasses({ filmCount: 1 })), false);
});

test("the html carries the number where a reader can see it", () => {
  const html = pinHtml({ filmCount: 96, checked: false, depicts_elsewhere: true });
  assert.match(html, />96</);
  assert.match(html, /is-studio/);
  assert.match(html, /is-unchecked/);
});

test("the legend explains in sentences, not nouns", () => {
  // "Exact / Approximate / Studio" is exactly the vocabulary the reader could not decode.
  assert.ok(PIN_LEGEND.length >= 4);
  for (const row of PIN_LEGEND) {
    assert.ok(row.text.length > 24, `"${row.text}" is a label, not an explanation`);
    assert.match(row.text, /[.!]$/);
  }
  assert.ok(PIN_LEGEND.some((r) => /number/i.test(r.text)), "the number is explained");
});

// The icon cache rests on this: two pins with the same key are visually identical, so they
// may share one L.divIcon. If the key ever collides for pins that should look different,
// the map draws the wrong pin — so these tests are about what MUST differ.
test("pins that look the same share a key", () => {
  assert.equal(
    pinIconKey({ filmCount: 1, checked: false }),
    pinIconKey({ filmCount: 1, checked: false }),
  );
});

test("checked and unchecked never share a key — that distinction is evidence", () => {
  assert.notEqual(
    pinIconKey({ filmCount: 1, checked: true }),
    pinIconKey({ filmCount: 1, checked: false }),
  );
});

test("a studio lot never shares a key with an ordinary place", () => {
  assert.notEqual(
    pinIconKey({ filmCount: 1, checked: true, depicts_elsewhere: true }),
    pinIconKey({ filmCount: 1, checked: true }),
  );
});

test("a selected pin never shares a key with the same pin unselected", () => {
  assert.notEqual(
    pinIconKey({ filmCount: 3, checked: true, selected: true }),
    pinIconKey({ filmCount: 3, checked: true }),
  );
});

test("different counts differ, because the number is drawn on the pin", () => {
  assert.notEqual(pinIconKey({ filmCount: 2 }), pinIconKey({ filmCount: 3 }));
});

// Above 999 every pin reads "999+" and every pin is the maximum size, so they genuinely
// are the same pin and SHOULD share — this is the one case where collapsing is correct.
test("two pins past the cap are the same pin and share a key", () => {
  assert.equal(pinIconKey({ filmCount: 1200 }), pinIconKey({ filmCount: 5000 }));
});
