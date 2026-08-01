import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeocodeQuery,
  cacheRow,
  chooseCandidate,
  groupByName,
  isGeocodableName,
  MAX_NAMES_PER_QUERY,
  QUERY_GAP_MS,
  retryPlan,
  RIVAL_DISTANCE_KM,
  sparqlLiteral,
  WIKIDATA_LICENSE,
} from "../app/lib/geocode-wikidata.mjs";

const at = (lat, lng, extra = {}) => ({ wikidata_id: "Q1", name: "X", lat, lng, ...extra });

// --- what is worth asking about --------------------------------------------------

test("a phrase that names no place is never sent", () => {
  // "various locations" matches hundreds of entities; a population tiebreak between
  // them is a coin toss dressed as a decision.
  assert.equal(isGeocodableName("various locations"), false);
  assert.equal(isGeocodableName("the studio"), false);
  assert.equal(isGeocodableName("1953"), false);
  assert.equal(isGeocodableName("a"), false);
  assert.equal(isGeocodableName(""), false);
  assert.equal(isGeocodableName(null), false);
});

test("a real place name is", () => {
  assert.equal(isGeocodableName("Hankley Common"), true);
  assert.equal(isGeocodableName("Hashima Island"), true);
});

// --- the query --------------------------------------------------------------------

test("the query demands a geographic thing AND a coordinate", () => {
  // Without the class filter, "Skyfall" returns the film and "Victoria" a monarch.
  const query = buildGeocodeQuery(["Hankley Common"]);
  assert.match(query, /wdt:P31\/wdt:P279\* wd:Q618123/);
  assert.match(query, /wikibase:geoLatitude/);
  // An alias must count: prose rarely uses the canonical label.
  assert.match(query, /rdfs:label\|skos:altLabel/);
});

test("a quote in a place name cannot rewrite the query", () => {
  // Prose contains quotes and backslashes; an unescaped one does not merely fail, it
  // changes what is asked.
  assert.equal(sparqlLiteral('The "Blue" Bar'), 'The \\"Blue\\" Bar');
  assert.equal(sparqlLiteral("back\\slash"), "back\\\\slash");
  assert.equal(sparqlLiteral("two\nlines"), "two lines");

  const query = buildGeocodeQuery(['The "Blue" Bar']);
  assert.match(query, /\\"Blue\\"/);
});

test("the batch is bounded and unaskable names are dropped, not sent", () => {
  const many = Array.from({ length: MAX_NAMES_PER_QUERY + 20 }, (_, i) => `Place Number ${i}`);
  const values = (buildGeocodeQuery(many).match(/"Place Number/g) ?? []).length;
  assert.equal(values, MAX_NAMES_PER_QUERY);

  assert.equal(buildGeocodeQuery(["various locations", "the set"]), null);
  assert.equal(buildGeocodeQuery([]), null);
});

test("the batch is small because a big one times out", () => {
  // Measured live: 40 names returns HTTP 504. The label|altLabel union across the
  // geographic class tree is expensive per name, and WDQS hard-fails at 60 seconds.
  assert.ok(MAX_NAMES_PER_QUERY <= 10);
  assert.ok(QUERY_GAP_MS >= 5000);
});

test("a timeout and a rate limit call for opposite responses", () => {
  // 504 means the query was too heavy — waiting longer changes nothing.
  assert.equal(retryPlan(504).action, "shrink_batch");
  // 429 means we were too fast — a smaller batch changes nothing.
  assert.equal(retryPlan(429).action, "back_off");
  assert.ok(retryPlan(429).waitMs > retryPlan(504).waitMs);
  assert.equal(retryPlan(404).action, "give_up");
});

// --- reading the answer -------------------------------------------------------------

test("rows are grouped by the name that was asked for", () => {
  const grouped = groupByName([
    { name: { value: "Hashima Island" }, place: { value: "http://www.wikidata.org/entity/Q285468" },
      lat: { value: "32.6277" }, lng: { value: "129.7383" }, placeLabel: { value: "Hashima Island" } },
  ]);
  const [candidate] = grouped.get("hashima island");
  assert.equal(candidate.wikidata_id, "Q285468");
  assert.equal(candidate.lat, 32.6277);
});

test("a row without a coordinate is not an answer", () => {
  const grouped = groupByName([
    { name: { value: "X" }, place: { value: ".../Q1" }, lat: { value: "" }, lng: { value: "2" } },
    { name: { value: "Y" }, place: { value: ".../notaqid" }, lat: { value: "1" }, lng: { value: "2" } },
  ]);
  assert.equal(grouped.size, 0);
});

test("an empty latitude never becomes zero", () => {
  // Number("") is 0, which is a real coordinate in the Gulf of Guinea.
  const grouped = groupByName([
    { name: { value: "X" }, place: { value: ".../Q1" }, lat: { value: "" }, lng: { value: "" } },
  ]);
  assert.equal(grouped.size, 0);
});

// --- choosing, and refusing ---------------------------------------------------------

test("one candidate is the answer", () => {
  const chosen = chooseCandidate([at(51.5, -0.12)]);
  assert.equal(chosen.reason, "unique");
  assert.ok(chosen.place);
});

test("two genuinely different places sharing a name are REFUSED, not ranked", () => {
  // Cambridge England and Cambridge Massachusetts. The prose said "Cambridge" and we
  // do not know which — writing the bigger one's coordinate invents an answer.
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge", population: 145000 }),
    at(42.3736, -71.1097, { name: "Cambridge", population: 118000 }),
  ]);
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("several records of the SAME place are merged, not refused", () => {
  // A settlement and its centre are not rivals; they cluster.
  const chosen = chooseCandidate([
    at(51.5074, -0.1278, { population: 8000000 }),
    at(51.5155, -0.1410, { population: null }),
  ]);
  assert.equal(chosen.reason, "same_place_multiple_records");
  assert.equal(chosen.place.population, 8000000);
});

test("a hint from the same prose may break a tie", () => {
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge, England" }),
    at(42.3736, -71.1097, { name: "Cambridge, Massachusetts" }),
  ], { near: { lat: 51.5, lng: -0.12 } });
  assert.equal(chosen.reason, "nearest_to_hint");
  assert.equal(chosen.place.name, "Cambridge, England");
});

test("a hint that favours neither does not decide", () => {
  // Equidistant is not a preference, and pretending otherwise is the failure this
  // whole function exists to avoid.
  const chosen = chooseCandidate([
    at(51.0, 0), at(53.0, 0),
  ], { near: { lat: 52.0, lng: 0 } });
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("no candidates is a clean refusal", () => {
  assert.equal(chooseCandidate([]).reason, "no_candidate");
  assert.equal(chooseCandidate(null).reason, "no_candidate");
});

test("rivals are judged by distance, not by name", () => {
  assert.ok(RIVAL_DISTANCE_KM > 10 && RIVAL_DISTANCE_KM < 100);
});

// --- what gets cached ---------------------------------------------------------------

test("a cached coordinate records where it came from and under what licence", () => {
  // Once CC0, CC BY and ODbL results are mixed without these, nobody can say what
  // attribution the data owes.
  const row = cacheRow("Hashima Island", chooseCandidate([at(32.6, 129.7, { wikidata_id: "Q285468" })]));
  assert.equal(row.source, "wikidata");
  assert.equal(row.license, WIKIDATA_LICENSE.name);
  assert.equal(row.source_id, "Q285468");
  assert.equal(row.query_norm, "hashima island");
});

test("a refusal caches nothing", () => {
  assert.equal(cacheRow("Cambridge", { place: null, reason: "ambiguous_homonyms" }), null);
  assert.equal(cacheRow("X", null), null);
});
