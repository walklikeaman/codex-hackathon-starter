import assert from "node:assert/strict";
import test from "node:test";

import { createPlaceCardHandler, placeIdentity } from "../app/api/place/route.js";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://db.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

const TRAFALGAR = "1dace4f1-8d85-44af-a390-5fd851cc6564";
const LONDON = "40d442dd-257e-424b-8043-50677eb30ca6";

const get = (path) => new Request(`https://glorymap.local${path}`);

// A row exactly as `place_facts_at` returns it — the place columns repeat on every row
// because the function joins `places`, which is what lets one query answer the whole card.
const fact = (overrides = {}) => ({
  fact_id: "9bef4a90-4f86-4ea3-be2e-679e809800c5",
  subject_type: "work",
  subject_id: "d72da1ff-8c6d-4219-8f65-bf941287fed6",
  subject_name: "28 Days Later",
  subject_kind: "film",
  relation_kind: "filming_location",
  about: null,
  stated_year: null,
  statement: null,
  distance: 0,
  fact_confidence: 0.9,
  scene_id: null,
  narrative_order: null,
  place_id: TRAFALGAR,
  name: "Trafalgar Square",
  city: null,
  country: null,
  lat: 51.508055555556,
  lng: -0.12805555555556,
  place_class: "real_exterior",
  geocode_precision: "point",
  osm_building_id: null,
  wikidata_id: "Q129143",
  confidence: 0.9,
  evidence_count: 1,
  ...overrides,
});

const reader = ({ facts = [], evidence = [], onFacts, onEvidence } = {}) => () => ({
  async loadFacts(id) { onFacts?.(id); return facts; },
  async loadEvidence(ids) { onEvidence?.(ids); return evidence; },
});

// ---------- what may be asked ----------

test("a slug that is not a uuid is a 400 decided here, and the database is never asked", async () => {
  // Otherwise /place/<anything> is a way to make us look up arbitrary strings for free.
  let asked = false;
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({ onFacts: () => { asked = true; } }),
  });
  const response = await handler(get("/api/place?id=trafalgar-square"));
  assert.equal(response.status, 400);
  assert.equal(asked, false);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("a place with no facts is a 404, because no such place exists in this graph", async () => {
  // Measured 02.09: 70 places, 92 facts, and every place carries at least one. A place
  // row with no facts is not a state this graph can be in, so an empty answer means the
  // id was stale or invented — the same thing /work/[slug] does with a dead uuid.
  const handler = createPlaceCardHandler({ env: ENV, createReader: reader({ facts: [] }) });
  const response = await handler(get(`/api/place?id=${TRAFALGAR}`));
  assert.equal(response.status, 404);
});

test("an unconfigured deployment says so rather than answering an empty card", async () => {
  const handler = createPlaceCardHandler({ env: {}, createReader: undefined });
  assert.equal((await handler(get(`/api/place?id=${TRAFALGAR}`))).status, 503);
});

test("a failed lookup is an error, never a card that reads as 'nothing happened here'", async () => {
  // A film card without our graph still shows a poster. A place card is nothing BUT the
  // facts, so an empty one would be a claim — and a false one.
  const logged = [];
  const handler = createPlaceCardHandler({
    env: ENV,
    logError: (...args) => logged.push(args),
    createReader: () => ({ loadFacts: async () => { throw new Error("PostgREST is down"); } }),
  });
  const response = await handler(get(`/api/place?id=${TRAFALGAR}`));
  assert.equal(response.status, 502);
  assert.equal(logged.length, 1);
});

// ---------- what comes back ----------

test("three films at one point are three facts, and they are not merged", async () => {
  // The acceptance case from #129: this is the page a work card can never show.
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({
      facts: [
        fact(),
        fact({ fact_id: "d02eab6c-adfb-475f-820d-0d251bac89da", subject_id: "501b19a1-4ed3-4606-92b0-0f4b774b7453", subject_name: "Love Actually" }),
        fact({ fact_id: "797d693c-3b4e-4399-99a0-cbf37aea7ad6", subject_id: "7ab4f687-f5a0-43c2-95b1-8fb06120fee5", subject_name: "V for Vendetta" }),
      ],
    }),
  });

  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();

  assert.equal(payload.place.name, "Trafalgar Square");
  assert.equal(payload.facts.length, 3);
  assert.deepEqual(
    payload.facts.map((f) => f.subject_name),
    ["28 Days Later", "Love Actually", "V for Vendetta"],
  );
  // Each carries its own subject, which is what makes it addressable from this page.
  assert.equal(new Set(payload.facts.map((f) => f.subject_id)).size, 3);
});

test("the order the query chose is the order the card prints", async () => {
  // `place_facts_at` orders by distance, then subject name, then year — so that two films
  // at one doorway are stable rather than whatever the union happened to emit. Re-sorting
  // here would replace a decision made in SQL with a different one.
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({
      facts: [
        fact({ fact_id: "a", subject_name: "Alpha", confidence: 0.1 }),
        fact({ fact_id: "b", subject_name: "Beta", confidence: 0.9 }),
      ],
    }),
  });
  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();
  assert.deepEqual(payload.facts.map((f) => f.subject_name), ["Alpha", "Beta"]);
});

test("every fact opens its own source, not the place's", async () => {
  // #129's second acceptance line. On a film card every row pointed at one film's entry;
  // here the three sources are three different pages, and they are the thing that tells
  // the three facts apart.
  const asked = [];
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({
      facts: [fact({ fact_id: "one" }), fact({ fact_id: "two", subject_name: "Love Actually" })],
      evidence: [
        { subject_id: "one", subject_type: "link", source_url: "https://www.wikidata.org/wiki/Q221075", method: "wikidata_statement", cited_quote: null, agrees: true },
        { subject_id: "two", subject_type: "link", source_url: "https://www.wikidata.org/wiki/Q190588", method: "wikidata_statement", cited_quote: "filmed in Trafalgar Square", agrees: true },
      ],
      onEvidence: (ids) => asked.push(ids),
    }),
  });

  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();

  // One query for the whole card, keyed by the fact ids that just arrived.
  assert.deepEqual(asked, [["one", "two"]]);
  assert.equal(payload.facts[0].source_url, "https://www.wikidata.org/wiki/Q221075");
  assert.equal(payload.facts[1].source_url, "https://www.wikidata.org/wiki/Q190588");
  assert.equal(payload.facts[1].sources[0].quote, "filmed in Trafalgar Square");
  // The place's own entry belongs to the place, printed once, and never stands in for a
  // fact's evidence.
  assert.equal(payload.place.source_url, "https://www.wikidata.org/wiki/Q129143");
});

test("evidence about the PIN is not printed under a fact as though it backed it", async () => {
  // `place_evidence` also files rows against a place itself — where we learned the
  // building is at that coordinate. That is a claim about the pin, not about any film.
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({
      facts: [fact({ fact_id: "one" })],
      evidence: [
        { subject_id: "one", subject_type: "place", source_url: "https://www.wikidata.org/wiki/Q129143", method: "wikidata_statement", agrees: true },
      ],
    }),
  });
  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();
  assert.deepEqual(payload.facts[0].sources, []);
  assert.equal(payload.facts[0].source_url, null);
});

test("a fact with nothing recorded behind it says null, not the place's entry", async () => {
  // 8 of the graph's 92 links carry zero evidence. Substituting the place's own page
  // there would be inventing a source for a claim nobody backed.
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({ facts: [fact({ evidence_count: 0 })], evidence: [] }),
  });
  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();
  assert.equal(payload.facts[0].source_url, null);
  assert.equal(payload.facts[0].evidence_count, 0);
});

test("a reader written before this route loses its source links, not its card", async () => {
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: () => ({ loadFacts: async () => [fact()] }),
  });
  const response = await handler(get(`/api/place?id=${TRAFALGAR}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.facts.length, 1);
  assert.deepEqual(payload.facts[0].sources, []);
});

test("a broken evidence table costs the links and not the page", async () => {
  const logged = [];
  const handler = createPlaceCardHandler({
    env: ENV,
    logError: (...args) => logged.push(args),
    createReader: () => ({
      loadFacts: async () => [fact()],
      loadEvidence: async () => { throw new Error("no such table"); },
    }),
  });
  const response = await handler(get(`/api/place?id=${TRAFALGAR}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).facts.length, 1);
  assert.equal(logged.length, 1);
});

test("three scenes of one film are three distinguishable facts", async () => {
  // London holds four Skyfall facts, three of them narrative facts with the same subject,
  // the same relation and no stated sentence. Only the scene tells them apart, and
  // without it the page prints one line three times and reads as broken.
  const handler = createPlaceCardHandler({
    env: ENV,
    createReader: reader({
      facts: [
        fact({ fact_id: "s2", place_id: LONDON, name: "London", subject_name: "Skyfall", relation_kind: "narrative_location", scene_id: "a", narrative_order: 2, evidence_count: 0 }),
        fact({ fact_id: "s7", place_id: LONDON, name: "London", subject_name: "Skyfall", relation_kind: "narrative_location", scene_id: "b", narrative_order: 7, evidence_count: 0 }),
        fact({ fact_id: "s9", place_id: LONDON, name: "London", subject_name: "Skyfall", relation_kind: "narrative_location", scene_id: "c", narrative_order: 9, evidence_count: 0 }),
      ],
    }),
  });
  const payload = await (await handler(get(`/api/place?id=${LONDON}`))).json();
  assert.deepEqual(payload.facts.map((f) => f.narrative_order), [2, 7, 9]);
});

test("a fact with no stated wording still gets a sentence naming this place", async () => {
  const handler = createPlaceCardHandler({ env: ENV, createReader: reader({ facts: [fact()] }) });
  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();
  assert.equal(payload.facts[0].sentence, "28 Days Later was filmed at Trafalgar Square.");
});

test("a source's own words are printed verbatim, and beat our template", async () => {
  const statement = "The rooms on the first floor of this building were used in the film.";
  const handler = createPlaceCardHandler({ env: ENV, createReader: reader({ facts: [fact({ statement })] }) });
  const payload = await (await handler(get(`/api/place?id=${TRAFALGAR}`))).json();
  assert.equal(payload.facts[0].sentence, statement);
});

test("a card is cached hard; the ways it can fail are not cached at all", async () => {
  const handler = createPlaceCardHandler({ env: ENV, createReader: reader({ facts: [fact()] }) });
  const ok = await handler(get(`/api/place?id=${TRAFALGAR}`));
  assert.match(ok.headers.get("Cache-Control"), /max-age=3600/);
});

// ---------- the place itself ----------

test("the place is read from the row that already arrived, never asked for twice", () => {
  // A number computed twice from one source is a number that can disagree with itself,
  // which is why `place_facts_at` returns no counts of its own.
  const identity = placeIdentity(fact());
  assert.equal(identity.id, TRAFALGAR);
  assert.equal(identity.name, "Trafalgar Square");
  assert.equal(identity.precision, "Exact point");
  // The same four decimals the map panel shows: a page that hands over more precision
  // than it displays is inventing digits.
  assert.equal(identity.coordinate, "51.5081, -0.1281");
});

test("a place we could not locate hands over no coordinate to paste", () => {
  // Null Island is a legal pair of numbers and the signature of one never parsed.
  assert.equal(placeIdentity(fact({ lat: 0, lng: 0 })).coordinate, null);
  assert.equal(placeIdentity(fact({ lat: null, lng: null })).coordinate, null);
});
