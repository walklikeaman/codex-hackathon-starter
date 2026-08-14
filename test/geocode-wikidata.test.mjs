import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NAMES_PER_QUERY,
  NOTABLE_POPULATION,
  QUERY_GAP_MS,
  RIVAL_DISTANCE_KM,
  WIKIDATA_LICENSE,
  buildGeocodeQuery,
  buildHeadquartersQuery,
  cacheRow,
  chooseCandidate,
  dominantByPopulation,
  gazetteerName,
  groupByName,
  inheritedPointIds,
  inheritsEnclosingPoint,
  isGeocodableName,
  isPlaceType,
  retryPlan,
  sparqlLiteral,
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

test("the query demands a coordinate, and never walks the subclass tree", () => {
  // The closure `wdt:P31/wdt:P279* wd:Q618123` was correct and unusable: measured live
  // it took 65 SECONDS and returned 504 for ONE name, while a trivial query to the same
  // service answered in 0.45s. Requiring a coordinate does the same work — "Skyfall"
  // returns nothing because the film has no P625.
  const query = buildGeocodeQuery(["Hankley Common"]);
  assert.doesNotMatch(query, /P279/);
  assert.match(query, /wikibase:geoLatitude/);
  // The direct type comes back so non-places can be dropped in code.
  assert.match(query, /wdt:P31 \?type/);
  // An alias must count: prose rarely uses the canonical label.
  assert.match(query, /rdfs:label\|skos:altLabel/);
});

test("a thing with a coordinate that is not a place is dropped", () => {
  // "Victoria" matches a shipwreck and a bark, and both carry coordinates.
  assert.equal(isPlaceType("shipwreck"), false);
  assert.equal(isPlaceType("Sailing Ship"), false);
  assert.equal(isPlaceType("city"), true);
  assert.equal(isPlaceType("common"), true);
  // An untyped entity that has a coordinate is still a place.
  assert.equal(isPlaceType(null), true);
});

test("one entity with several types is one candidate, not several", () => {
  // Each P31 value returns its own row; without deduplication a place with three types
  // looks like three records of itself and skews the population tiebreak.
  const rows = ["island", "ghost town", "tourist attraction"].map((typeLabel) => ({
    name: { value: "Hashima Island" },
    place: { value: "http://www.wikidata.org/entity/Q285468" },
    placeLabel: { value: "Hashima Island" },
    lat: { value: "32.6277" }, lng: { value: "129.7383" },
    typeLabel: { value: typeLabel },
  }));
  assert.equal(groupByName(rows).get("hashima island").length, 1);
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

// --- the label is evidence; the hint is only local ------------------------------------

test("an entity's own label beats one that merely lists the name as an alias", () => {
  // Checked live: "Istanbul" matches the city by label and a Manchester pub called
  // "Istanbul Grill" by alias. Without this the pub is a rival.
  const chosen = chooseCandidate([
    at(41.0082, 28.9784, { wikidata_id: "Q406", name: "Istanbul", exact_label: true, population: 15655924 }),
    at(53.5330, -2.2850, { wikidata_id: "Q136769547", name: "Istanbul Grill", exact_label: false }),
  ]);
  assert.equal(chosen.place.wikidata_id, "Q406");
});

test("a hint speaks only about its own neighbourhood", () => {
  // The bug this exists to prevent: with London as the hint, "Istanbul" resolved to a
  // pub in Manchester, because Manchester is closer to London than Turkey is. The hint
  // separates Cambridge from Cambridge; it does not rank the world by distance.
  const chosen = chooseCandidate([
    at(41.0082, 28.9784, { name: "Istanbul", exact_label: true }),
    at(53.5330, -2.2850, { name: "Istanbul Grill", exact_label: true }),
  ], { near: { lat: 51.5072, lng: -0.1276 } });

  assert.notEqual(chosen.reason, "nearest_to_hint");
});

test("a hint still decides between two candidates that are actually near it", () => {
  const chosen = chooseCandidate([
    at(52.2053, 0.1218, { name: "Cambridge, England", exact_label: true }),
    at(42.3736, -71.1097, { name: "Cambridge, Massachusetts", exact_label: true }),
  ], { near: { lat: 51.5072, lng: -0.1276 } });

  assert.equal(chosen.reason, "nearest_to_hint");
  assert.equal(chosen.place.name, "Cambridge, England");
});

// --- population as evidence, and as a coin toss ----------------------------------------

test("a city beside rivals with no recorded population at all is the answer", () => {
  // Shanghai (24.8m) against three unincorporated communities Wikidata records no
  // population for. Refusing this cost real recall for no safety.
  const chosen = chooseCandidate([
    at(31.2304, 121.4737, { name: "Shanghai", exact_label: true, population: 24870895 }),
    at(37.61, -95.0, { name: "Shanghai", exact_label: true, population: null }),
    at(18.45, -66.0, { name: "Shanghai", exact_label: true, population: null }),
  ]);
  assert.equal(chosen.reason, "dominant_population");
  assert.equal(chosen.place.population, 24870895);
});

test("one rival with a recorded population is enough to refuse", () => {
  // "Victoria": the state of Australia (7,074,468) beats a Canadian district (110,942)
  // by 63x, so any ratio rule picks it — among 110 real places. Ratios cannot tell a
  // city beside a hamlet from a state beside a city.
  const chosen = chooseCandidate([
    at(-36.85, 144.28, { name: "Victoria", exact_label: true, population: 7074468 }),
    at(48.43, -123.37, { name: "Victoria", exact_label: true, population: 110942 }),
  ]);
  assert.equal(chosen.place, null);
  assert.equal(chosen.reason, "ambiguous_homonyms");
});

test("two comparable cities are still a coin toss", () => {
  assert.equal(dominantByPopulation([
    { lat: 52.2, lng: 0.1, population: 145000 },
    { lat: 42.3, lng: -71.1, population: 118000 },
  ]), null);
});

test("a small place among silent rivals is not promoted either", () => {
  // A missing population is missing data, not a measured zero, so the winner has to be
  // large in absolute terms before silence on the other side counts for anything.
  assert.equal(dominantByPopulation([
    { lat: 1, lng: 1, population: 400 },
    { lat: 50, lng: 50, population: null },
  ]), null);
  assert.ok(NOTABLE_POPULATION >= 50_000);
});

test("a prose name is reduced to one a gazetteer can answer", () => {
  // The first live run asked Wikidata about "the Old Royal Naval College in Greenwich"
  // and got nothing, while "Old Royal Naval College" resolves immediately. The area is
  // already carried in area_hint, so repeating it here is duplication, not information.
  assert.equal(gazetteerName("the Old Royal Naval College in Greenwich"), "Old Royal Naval College");
  assert.equal(gazetteerName("Hankley Common in Surrey"), "Hankley Common");
  assert.equal(gazetteerName("the National Gallery"), "National Gallery");
});

test("a comma clause is left alone — it IS the gazetteer name", () => {
  // Stripping it would turn an answerable name into an ambiguous one.
  assert.equal(gazetteerName("Cambridge, Massachusetts"), "Cambridge, Massachusetts");
  assert.equal(gazetteerName("Hashima Island"), "Hashima Island");
});

// --- an entity that has no place of its own, only its city's (#152) --------------

test("the New York Public Library sits on New York City and is refused", () => {
  // Q219555's own P625 is -74.0059728, 40.7127753. New York City's is -74.006111111,
  // 40.712777777 — the same point to about twenty metres. The film used the Fifth Avenue
  // main branch, five kilometres away.
  assert.equal(
    inheritsEnclosingPoint({ lat: 40.7127753, lng: -74.0059728 }, { lat: 40.712777777, lng: -74.006111111 }),
    true,
  );
});

test("an organisation that really is where it says is kept", () => {
  // Measured across all 1,063 placed rows: the closest genuine headquarters gap is
  // Brasenose College at 252 m from Oxford's own point. Everything correct sits above the
  // threshold, and the three worst offenders are kilometres away — which is exactly why
  // the rule refuses instead of preferring P159.
  const brasenose = { lat: 51.753194, lng: -1.254722 };
  const oxford = { lat: 51.7548, lng: -1.2544 };
  assert.equal(inheritsEnclosingPoint(brasenose, oxford), false);

  // Columbia University: own point is the Morningside campus, headquarters is New York
  // City 11.2 km away. Preferring the headquarters would have moved a correct pin.
  assert.equal(
    inheritsEnclosingPoint({ lat: 40.8075, lng: -73.961944 }, { lat: 40.712777, lng: -74.006111 }),
    false,
  );
});

test("a missing coordinate on either side proves nothing", () => {
  assert.equal(inheritsEnclosingPoint({ lat: 51.5, lng: -0.1 }, null), false);
  assert.equal(inheritsEnclosingPoint(null, { lat: 51.5, lng: -0.1 }), false);
  // Null Island is a legal pair of numbers and the signature of one never parsed.
  assert.equal(inheritsEnclosingPoint({ lat: 0, lng: 0 }, { lat: 51.5, lng: -0.1 }), false);
});

test("the headquarters question is asked separately, of the winners only", () => {
  // Never folded into buildGeocodeQuery: that query already answers 500, 502 and 504
  // under sustained load, and a second hop to the headquarters' coordinate is the kind
  // of weight that made the class closure time out at 65 seconds.
  const query = buildHeadquartersQuery(["Q219555", "Q49088", "not-an-id", "Q219555"]);
  assert.match(query, /VALUES \?place \{ wd:Q219555 wd:Q49088 \}/);
  assert.match(query, /wdt:P159/);
  assert.ok(!query.includes("rdfs:label"), "the winner is already chosen; this only checks it");
  assert.equal(buildHeadquartersQuery([]), null);
  assert.equal(buildHeadquartersQuery(["nonsense"]), null);
});

test("only the entities that sit on their headquarters come back", () => {
  const point = (lat, lng) => ({ value: String(lat) });
  const rows = [
    { place: { value: "http://www.wikidata.org/entity/Q219555" },
      lat: { value: "40.7127753" }, lng: { value: "-74.0059728" },
      hqLat: { value: "40.712777777" }, hqLng: { value: "-74.006111111" } },
    { place: { value: "http://www.wikidata.org/entity/Q49088" },
      lat: { value: "40.8075" }, lng: { value: "-73.961944" },
      hqLat: { value: "40.712777" }, hqLng: { value: "-74.006111" } },
  ];
  const inherited = inheritedPointIds(rows);
  assert.ok(inherited.has("Q219555"));
  assert.ok(!inherited.has("Q49088"));
  assert.equal(inheritedPointIds(null).size, 0);
});
