import assert from "node:assert/strict";
import test from "node:test";

import { placeIdFromSlug, placePath, placeSlug } from "../app/lib/place-url.mjs";
import { workIdFromSlug, workPath } from "../app/lib/work-url.mjs";

const TRAFALGAR = "1dace4f1-8d85-44af-a390-5fd851cc6564";

test("a place has an address of the same shape as a work's", () => {
  assert.equal(
    placePath({ id: TRAFALGAR, name: "Trafalgar Square" }),
    `/place/trafalgar-square--${TRAFALGAR}`,
  );
});

test("the readable half is decorative, and the parser proves it", () => {
  // The reason the uuid is in the URL at all: a place renamed tomorrow must not break the
  // links sent today.
  assert.equal(placeIdFromSlug(`trafalgar-square--${TRAFALGAR}`), TRAFALGAR);
  assert.equal(placeIdFromSlug(`something-else-entirely--${TRAFALGAR}`), TRAFALGAR);
  assert.equal(placeIdFromSlug(TRAFALGAR), TRAFALGAR);
});

test("a name spelled with hyphens is not cut in the wrong place", () => {
  // The separator is a double hyphen precisely so this works.
  const id = placeIdFromSlug(`stoke-on-trent--${TRAFALGAR}`);
  assert.equal(id, TRAFALGAR);
});

test("anything that is not a uuid is not a place, and is answered without a query", () => {
  assert.equal(placeIdFromSlug("trafalgar-square"), null);
  assert.equal(placeIdFromSlug(""), null);
  assert.equal(placeIdFromSlug(null), null);
  assert.equal(placePath({ id: "not-a-uuid", name: "Nowhere" }), null);
  assert.equal(placePath(null), null);
});

test("a fact row addresses its place by place_id, which is what the card holds", () => {
  // `placeSummary` puts the place's id on `id`, but a raw RPC row carries `place_id`, and
  // a link built from the wrong one silently points at the fact instead of the place.
  assert.equal(placeSlug({ place_id: TRAFALGAR, name: "Trafalgar Square" }), `trafalgar-square--${TRAFALGAR}`);
});

test("a place with no usable name still gets an address", () => {
  // Three of the graph's places are named only in a script this slugifier strips to
  // nothing. A bare uuid is a worse link than a readable one and a much better one than
  // none.
  assert.equal(placePath({ id: TRAFALGAR, name: "———" }), `/place/${TRAFALGAR}`);
  assert.equal(placeIdFromSlug(TRAFALGAR), TRAFALGAR);
});

test("the two addresses share one parser, so they cannot drift apart", () => {
  // Both halves of #129 mint slugs of the same shape. Two copies of this rule is two
  // things that can disagree while every link already sent assumes they do not.
  const slug = `skyfall-2012--${TRAFALGAR}`;
  assert.equal(workIdFromSlug(slug), placeIdFromSlug(slug));
  assert.equal(workPath({ id: TRAFALGAR, title: "Skyfall", year: 2012 }), `/work/${slug}`);
});
