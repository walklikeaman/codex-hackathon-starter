import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntityFanoutQuery,
  buildInvertedSearch,
  buildSearchUrl,
  candidatesFromSearch,
  escapeInsourceRegex,
  isSearchableEntity,
  MAX_ENTITIES_PER_QUERY,
} from "../app/lib/place-search.mjs";

const EDINBURGH = { lat: 55.9533, lng: -3.1883 };

// --- the query shape that actually reaches the answer -------------------------------

test("the search uses the REGEX form of insource, not the quoted one", () => {
  // They are different operators. `insource:"Rowling"` matches tokens and misses
  // "Rowling's"; `insource:/Rowling/` matches the raw source. Measured on the
  // motivating article: the quoted form finds nothing, the regex form finds it.
  const query = buildInvertedSearch({ names: ["Lord Voldemort"], center: EDINBURGH });
  assert.match(query, /insource:\/Lord Voldemort\//);
  assert.doesNotMatch(query, /insource:"/);
});

test("the geographic filter is in the query, not applied afterwards", () => {
  // Searching a name and then keeping whatever happens to have coordinates wastes the
  // retrieval budget: `insource:/Lord Voldemort/` alone returns 50 articles of which 2
  // are places. With nearcoord, measured, 10 of 10 results carried coordinates.
  const query = buildInvertedSearch({ names: ["Lord Voldemort"], center: EDINBURGH, radiusKm: 15 });
  assert.match(query, /nearcoord:15km,55\.9533,-3\.1883/);
});

test("several entities go in ONE regex, never as CirrusSearch OR clauses", () => {
  // Measured all four forms against the motivating article. `insource:/A/ OR
  // insource:/B/ nearcoord:…` returns ZERO — not an error, zero results — while
  // `nearcoord:… insource:/A|B/` returns the right article. A silent nil is the worst
  // shape of wrong, so the alternation lives inside the regex.
  const query = buildInvertedSearch({
    names: ["Lord Voldemort", "Hermione Granger"], center: EDINBURGH,
  });
  assert.equal((query.match(/insource:/g) ?? []).length, 1);
  assert.doesNotMatch(query, / OR /);
  assert.match(query, /insource:\/Lord Voldemort\|Hermione Granger\//);
});

test("the alternation is bounded, and a pipe inside a name cannot become one", () => {
  const many = Array.from({ length: MAX_ENTITIES_PER_QUERY + 4 }, (_, i) => `Character Number ${i}`);
  const query = buildInvertedSearch({ names: many, center: EDINBURGH });
  assert.equal((query.match(/Character Number/g) ?? []).length, MAX_ENTITIES_PER_QUERY);

  const sneaky = buildInvertedSearch({ names: ["A|B ok", "Second Name"], center: EDINBURGH });
  assert.match(sneaky, /A\\\|B ok\|Second Name/);
});

test("a regex metacharacter in a name cannot rewrite the query", () => {
  // An unescaped one does not merely fail to match, it changes what is asked — and
  // character names carry full stops and parentheses as a matter of course.
  assert.equal(escapeInsourceRegex("J. K. Rowling"), "J\\. K\\. Rowling");
  assert.equal(escapeInsourceRegex("Q (character)"), "Q \\(character\\)");
  assert.equal(escapeInsourceRegex("a/b"), "a\\/b");

  const query = buildInvertedSearch({ names: ["Dr. No"], center: EDINBURGH });
  assert.match(query, /insource:\/Dr\\\. No\//);
});

// --- which names are worth asking about -----------------------------------------------

test("a full name is searchable; a single word is not", () => {
  // "Harry" matches a thousand unrelated sentences. A full name is near-unique in
  // running prose, which is exactly what makes this work at all.
  assert.equal(isSearchableEntity("Lord Voldemort"), true);
  assert.equal(isSearchableEntity("Minerva McGonagall"), true);
  assert.equal(isSearchableEntity("Harry"), false);
  assert.equal(isSearchableEntity("Q"), false);
});

test("an unresolved label is never searched for", () => {
  // The label service sometimes returns a bare Q-id; searching for "Q34660" finds
  // nothing and spends a branch of the query saying so.
  assert.equal(isSearchableEntity("Q34660"), false);
  assert.equal(buildInvertedSearch({ names: ["Q34660"], center: EDINBURGH }), null);
});

test("no usable name, or no centre, is a clean refusal", () => {
  assert.equal(buildInvertedSearch({ names: [], center: EDINBURGH }), null);
  assert.equal(buildInvertedSearch({ names: ["Lord Voldemort"], center: null }), null);
  assert.equal(buildInvertedSearch({ names: ["Lord Voldemort"], center: { lat: "x", lng: 1 } }), null);
});

test("the radius is clamped rather than sent out of bounds", () => {
  // CirrusSearch rejects an out-of-range radius instead of clamping it, which turns a
  // wide search into no search.
  assert.match(buildInvertedSearch({ names: ["Lord Voldemort"], center: EDINBURGH, radiusKm: 9000 }), /nearcoord:500km/);
  assert.match(buildInvertedSearch({ names: ["Lord Voldemort"], center: EDINBURGH, radiusKm: 0 }), /nearcoord:1km/);
});

// --- the fan-out ------------------------------------------------------------------------

test("the fan-out asks for characters, because the title does not reach the place", () => {
  // Neither "Harry Potter" nor "Rowling" finds Greyfriars Kirkyard — the article links
  // to [[Lord Voldemort]] and names no one else.
  const query = buildEntityFanoutQuery("Q8337");
  assert.match(query, /wdt:P674/, "P674 characters is the property that matters");
  assert.match(query, /wd:Q8337/);
  assert.equal(buildEntityFanoutQuery("not-a-qid"), null);
});

// --- reading the answer -------------------------------------------------------------------

test("a page with a coordinate becomes a candidate", () => {
  const found = candidatesFromSearch({ query: { pages: [
    { pageid: 1, title: "Greyfriars Kirkyard", coordinates: [{ lat: 55.9469, lon: -3.1925 }] },
  ] } });

  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Greyfriars Kirkyard");
  assert.equal(found[0].lat, 55.9469);
});

test("a page without one is dropped rather than half-placed", () => {
  // nearcoord should make this impossible; one that occurs anyway is a page we cannot
  // put on a map, and a missing coordinate must never become zero.
  const found = candidatesFromSearch({ query: { pages: [
    { pageid: 1, title: "No coordinate" },
    { pageid: 2, title: "Empty coordinate", coordinates: [{ lat: "", lon: "" }] },
  ] } });

  assert.deepEqual(found, []);
  assert.deepEqual(candidatesFromSearch(null), []);
});

// --- the request ---------------------------------------------------------------------------

test("coordinates come back with the page, not in a second round trip", () => {
  const url = buildSearchUrl(buildInvertedSearch({ names: ["Lord Voldemort"], center: EDINBURGH }));
  assert.match(url, /generator=search/);
  assert.match(url, /prop=coordinates/);
  assert.match(url, /gsrlimit=20/);
  assert.equal(buildSearchUrl(null), null);
});
