import assert from "node:assert/strict";
import test from "node:test";

import { isPublishable } from "../app/lib/grounding.mjs";
import {
  buildResolutionPlan,
  classifyPlace,
  evidenceKey,
  fetchTypeGraph,
  fetchWikidataEntities,
  linkKeyOf,
  missingEvidenceRows,
  PLACE_TYPE_TARGETS,
  RESOLVER_VERSION,
  resolveWorkPlaces,
  strongerPlaceClass,
} from "../app/lib/location-resolver.mjs";

// --- Wikidata entity fixtures (the shape wbgetentities returns) ---------------

function entity({ label, p31 = [], p279 = [], coord = null, locations = [], property = "P915" }) {
  const claims = {};
  const idClaims = (prop, ids) => {
    if (ids.length) {
      claims[prop] = ids.map((id) => ({
        rank: "normal",
        mainsnak: { datavalue: { value: { id } } },
      }));
    }
  };
  idClaims("P31", p31);
  idClaims("P279", p279);
  idClaims(property, locations);
  if (coord) {
    claims.P625 = [{
      rank: "normal",
      mainsnak: { datavalue: { value: { latitude: coord.lat, longitude: coord.lng } } },
    }];
  }
  return { labels: { en: { value: label } }, claims };
}

const ancestryOf = (...ids) => new Set(ids);

// --- Stage 1 classification --------------------------------------------------

test("classifyPlace marks fiction fictional and refuses to geocode it", () => {
  // Even when the entity carries a coordinate, fiction must never become a pin.
  const result = classifyPlace({
    ancestry: ancestryOf("Q3895768"),
    relationKind: "narrative_location",
    coordinate: { lat: 51.5, lng: -0.1 },
    name: "Hogwarts",
  });
  assert.equal(result.place_class, "fictional");
  assert.equal(result.lat, null);
  assert.equal(result.lng, null);
  assert.equal(result.geocode_precision, "none");
  assert.equal(result.shot_on_set, false);
});

test("classifyPlace reaches fiction through either fictional target", () => {
  for (const target of PLACE_TYPE_TARGETS.fictional) {
    assert.equal(classifyPlace({ ancestry: ancestryOf(target) }).place_class, "fictional");
  }
});

test("classifyPlace marks a studio studio_interior and keeps the studio's own coordinates", () => {
  const result = classifyPlace({
    ancestry: ancestryOf("Q375336"),
    relationKind: "filming_location",
    coordinate: { lat: 51.549, lng: -0.539 },
    name: "Pinewood Studios",
  });
  assert.equal(result.place_class, "studio_interior");
  assert.equal(result.shot_on_set, true);
  assert.equal(result.lat, 51.549); // the studio is real and correctly located
  assert.equal(result.geocode_precision, "building");
  assert.equal(result.method, "wikidata_studio_entity"); // discounted prior
});

test("classifyPlace treats the building sense of a studio as a studio too", () => {
  const result = classifyPlace({ ancestry: ancestryOf("Q21550789"), coordinate: { lat: 1, lng: 2 } });
  assert.equal(result.place_class, "studio_interior");
});

test("classifyPlace prefers fiction over studio for a fictional studio", () => {
  const result = classifyPlace({
    ancestry: ancestryOf("Q3895768", "Q375336"),
    coordinate: { lat: 1, lng: 2 },
    name: "Fictional Studios",
  });
  assert.equal(result.place_class, "fictional");
  assert.equal(result.lat, null);
});

test("classifyPlace separates a filmed-at street from a book's real setting", () => {
  const coordinate = { lat: 48.86, lng: 2.35 };
  assert.equal(
    classifyPlace({ ancestry: ancestryOf(), relationKind: "filming_location", coordinate }).place_class,
    "real_exterior",
  );
  assert.equal(
    classifyPlace({ ancestry: ancestryOf(), relationKind: "narrative_location", coordinate }).place_class,
    "narrative_real",
  );
});

test("classifyPlace records a real place with no coordinate as unknown, never invented", () => {
  const result = classifyPlace({ ancestry: ancestryOf(), relationKind: "filming_location", coordinate: null });
  assert.equal(result.place_class, "unknown");
  assert.equal(result.lat, null);
  assert.equal(result.geocode_precision, "none");
});

test("classifyPlace derives geocode precision from the type ancestry", () => {
  const coordinate = { lat: 10, lng: 10 };
  assert.equal(classifyPlace({ ancestry: ancestryOf("Q6256"), coordinate }).geocode_precision, "country");
  assert.equal(classifyPlace({ ancestry: ancestryOf("Q486972"), coordinate }).geocode_precision, "city");
  assert.equal(classifyPlace({ ancestry: ancestryOf(), coordinate }).geocode_precision, "point");
});

test("classifyPlace never claims a precision finer than Wikidata's own", () => {
  // P625 precision is in degrees; 1° is region-scale and must not be sold as a point.
  const coarse = { lat: 10, lng: 10, precisionDeg: 1 };
  assert.equal(classifyPlace({ ancestry: ancestryOf(), coordinate: coarse }).geocode_precision, "country");
  const fine = { lat: 10, lng: 10, precisionDeg: 0.0001 };
  assert.equal(classifyPlace({ ancestry: ancestryOf(), coordinate: fine }).geocode_precision, "point");
  // A type override may only coarsen, never sharpen.
  assert.equal(
    classifyPlace({ ancestry: ancestryOf("Q6256"), coordinate: fine }).geocode_precision,
    "country",
  );
});

test("classifyPlace refuses an out-of-range coordinate instead of letting the DB reject it", () => {
  // Mars longitudes run 0..360; one such row would violate places_coord_valid and
  // 502 the whole batch, so it must be dropped here.
  const result = classifyPlace({
    ancestry: ancestryOf(),
    relationKind: "narrative_location",
    coordinate: { lat: 18.65, lng: 226.2 },
  });
  assert.equal(result.place_class, "unknown");
  assert.equal(result.lat, null);
});

test("strongerPlaceClass is order-independent and never downgrades fiction into a pin", () => {
  assert.equal(strongerPlaceClass("narrative_real", "real_exterior"), "real_exterior");
  assert.equal(strongerPlaceClass("real_exterior", "narrative_real"), "real_exterior");
  assert.equal(strongerPlaceClass("fictional", "real_exterior"), "fictional");
  assert.equal(strongerPlaceClass("real_exterior", "fictional"), "fictional");
  assert.equal(strongerPlaceClass("studio_interior", "real_exterior"), "studio_interior");
});

test("classifyPlace never lets a studio-sounding name decide the class", () => {
  // The name regex is a QA signal only — Wikidata's type graph is the authority.
  const result = classifyPlace({
    ancestry: ancestryOf(),
    relationKind: "filming_location",
    coordinate: { lat: 51.53, lng: -0.17 },
    name: "Abbey Road Studios",
  });
  assert.equal(result.place_class, "real_exterior");
  assert.equal(result.shot_on_set, false);
  assert.equal(result.name_hints_studio, true); // surfaced, but powerless
});

// --- Stage 0 + plan ----------------------------------------------------------

const FILM_WORK = { id: "w1", kind: "film" };

function planFixture({ locations, locationEntities, typeGraph = new Map() }) {
  const entities = new Map([["Q1", entity({ label: "A Film", locations })], ...locationEntities]);
  return buildResolutionPlan({
    works: [FILM_WORK],
    workQids: new Map([["w1", { wikidataId: "Q1", conflict: false }]]),
    entities,
    typeGraph,
  });
}

test("buildResolutionPlan emits a place, a link and evidence at both grains", () => {
  const plan = planFixture({
    locations: ["Q100"],
    locationEntities: [["Q100", entity({ label: "Bradbury Building", coord: { lat: 34.05, lng: -118.25 } })]],
  });

  assert.equal(plan.places.length, 1);
  assert.deepEqual(plan.places[0], {
    wikidata_id: "Q100",
    name: "Bradbury Building",
    lat: 34.05,
    lng: -118.25,
    place_class: "real_exterior",
    geocode_precision: "point",
    shot_on_set: false,
    confidence: 0.9, // wikidata_statement prior
    confidence_band: "verified",
    resolver_version: RESOLVER_VERSION,
  });
  assert.deepEqual(plan.links, [
    { workKey: "w1", place_wikidata_id: "Q100", relation_kind: "filming_location", confidence: 0.9 },
  ]);
  assert.deepEqual(plan.evidence.map((e) => e.subject_type), ["place", "link"]);
  assert.equal(plan.evidence[1].source_ref, "Q1/P915/Q100"); // provenance triple
});

test("a resolved place satisfies grounding.isPublishable with its own evidence", () => {
  // Acceptance criterion: a point carries place_class, confidence and >=1 evidence row.
  const plan = planFixture({
    locations: ["Q100"],
    locationEntities: [["Q100", entity({ label: "Bradbury Building", coord: { lat: 34.05, lng: -118.25 } })]],
  });
  const placeEvidence = plan.evidence.filter((e) => e.subject_type === "place");
  assert.equal(isPublishable(plan.places[0], placeEvidence), true);
});

test("fiction is persisted without a geocode and stays off the map", () => {
  const plan = planFixture({
    locations: ["Q200"],
    locationEntities: [["Q200", entity({ label: "Hogwarts", p31: ["Q3895768"] })]],
    typeGraph: new Map([["Q3895768", entity({ label: "fictional location" })]]),
  });
  assert.equal(plan.places[0].place_class, "fictional");
  assert.equal(plan.places[0].lat, null);
  assert.equal(plan.evidence.some((e) => e.subject_type === "place"), true);
  // Recorded, evidenced — but never pinned.
  assert.equal(isPublishable(plan.places[0], plan.evidence), false);
});

test("a studio is classified through a subclass chain and discounted", () => {
  const plan = planFixture({
    locations: ["Q300"],
    locationEntities: [["Q300", entity({ label: "Pinewood Studios", p31: ["Q9999"], coord: { lat: 51.549, lng: -0.539 } })]],
    // Q9999 is not a target itself; it reaches Q375336 one P279 hop up.
    typeGraph: new Map([["Q9999", entity({ label: "british studio", p279: ["Q375336"] })]]),
  });
  assert.equal(plan.places[0].place_class, "studio_interior");
  assert.equal(plan.places[0].shot_on_set, true);
  assert.equal(plan.places[0].lat, 51.549);
  assert.equal(plan.places[0].confidence, 0.85); // wikidata_studio_entity prior
});

test("buildResolutionPlan dedupes a shared place into one row with two links", () => {
  const shared = entity({ label: "Trafalgar Square", coord: { lat: 51.508, lng: -0.128 } });
  const plan = buildResolutionPlan({
    works: [{ id: "w1", kind: "film" }, { id: "w2", kind: "film" }],
    workQids: new Map([
      ["w1", { wikidataId: "Q1" }],
      ["w2", { wikidataId: "Q2" }],
    ]),
    entities: new Map([
      ["Q1", entity({ label: "Film One", locations: ["Q100"] })],
      ["Q2", entity({ label: "Film Two", locations: ["Q100"] })],
      ["Q100", shared],
    ]),
    typeGraph: new Map(),
  });
  assert.equal(plan.places.length, 1);
  assert.equal(plan.links.length, 2);
  assert.equal(plan.evidence.filter((e) => e.subject_type === "place").length, 1);
});

test("buildResolutionPlan reads P840 for books, not P915", () => {
  const plan = buildResolutionPlan({
    works: [{ id: "b1", kind: "book" }],
    workQids: new Map([["b1", { wikidataId: "Q1" }]]),
    entities: new Map([
      ["Q1", entity({ label: "A Novel", locations: ["Q100"], property: "P840" })],
      ["Q100", entity({ label: "Paris", coord: { lat: 48.86, lng: 2.35 } })],
    ]),
    typeGraph: new Map(),
  });
  assert.equal(plan.links[0].relation_kind, "narrative_location");
  assert.equal(plan.places[0].place_class, "narrative_real");
});

test("buildResolutionPlan skips works it must not guess about", () => {
  const plan = buildResolutionPlan({
    works: [
      { id: "a", kind: "album" }, // no workKindConfig
      { id: "b", kind: "film" }, // no qid
      { id: "c", kind: "film" }, // ambiguous cross-walk
      { id: "d", kind: "film" }, // qid but no location claims
    ],
    workQids: new Map([
      ["c", { wikidataId: "Q3", conflict: true }],
      ["d", { wikidataId: "Q4" }],
    ]),
    entities: new Map([["Q4", entity({ label: "No Locations" })]]),
    typeGraph: new Map(),
  });
  assert.deepEqual(plan.skipped, [
    { workKey: "a", reason: "unsupported_kind" },
    { workKey: "b", reason: "no_wikidata_id" },
    { workKey: "c", reason: "qid_conflict" },
    { workKey: "d", reason: "no_locations" },
  ]);
  assert.deepEqual(plan.places, []);
});

test("buildResolutionPlan collapses a repeated location statement into one link", () => {
  // A work can carry the same location twice (two statements, different qualifiers).
  // Two identical (work, place, relation) rows in one upsert are a Postgres
  // cardinality violation that would 502 the entire batch.
  const plan = planFixture({
    locations: ["Q100", "Q100"],
    locationEntities: [["Q100", entity({ label: "Trafalgar Square", coord: { lat: 51.5, lng: -0.12 } })]],
  });
  assert.equal(plan.links.length, 1);
  assert.equal(plan.places.length, 1);
  assert.equal(plan.evidence.length, 2); // one place row, one link row
});

test("a place shared by a book and a film gets the same class in either order", () => {
  const shared = entity({ label: "Paris", coord: { lat: 48.86, lng: 2.35 } });
  const build = (works) => buildResolutionPlan({
    works,
    workQids: new Map([["f1", { wikidataId: "Q1" }], ["b1", { wikidataId: "Q2" }]]),
    entities: new Map([
      ["Q1", entity({ label: "A Film", locations: ["Q100"] })],
      ["Q2", entity({ label: "A Novel", locations: ["Q100"], property: "P840" })],
      ["Q100", shared],
    ]),
    typeGraph: new Map(),
  });
  const filmFirst = build([{ id: "f1", kind: "film" }, { id: "b1", kind: "book" }]);
  const bookFirst = build([{ id: "b1", kind: "book" }, { id: "f1", kind: "film" }]);
  assert.equal(filmFirst.places[0].place_class, bookFirst.places[0].place_class);
  assert.equal(filmFirst.places[0].place_class, "real_exterior"); // stronger physical claim
  assert.ok(bookFirst.flags.some((f) => f.startsWith("place_class_disagreement:Q100")));
  // Both relations are still recorded on their own links.
  assert.deepEqual(bookFirst.links.map((l) => l.relation_kind).sort(), ["filming_location", "narrative_location"]);
});

test("buildResolutionPlan reports a work whose location entities never arrived", () => {
  const plan = buildResolutionPlan({
    works: [{ id: "w1", kind: "film" }],
    workQids: new Map([["w1", { wikidataId: "Q1" }]]),
    entities: new Map([["Q1", entity({ label: "A Film", locations: ["Q100"] })]]), // Q100 absent
    typeGraph: new Map(),
  });
  assert.deepEqual(plan.skipped, [{ workKey: "w1", reason: "locations_unavailable" }]);
  assert.ok(plan.flags.includes("locations_unavailable:w1:1"));
});

test("buildResolutionPlan separates a deleted work entity from one with no locations", () => {
  const plan = buildResolutionPlan({
    works: [{ id: "gone", kind: "film" }],
    workQids: new Map([["gone", { wikidataId: "Q1" }]]),
    entities: new Map([["Q1", { id: "Q1", missing: "" }]]),
    typeGraph: new Map(),
  });
  assert.deepEqual(plan.skipped, [{ workKey: "gone", reason: "work_entity_unavailable" }]);
});

test("buildResolutionPlan flags a studio-named place the type graph missed", () => {
  const plan = planFixture({
    locations: ["Q400"],
    locationEntities: [["Q400", entity({ label: "Ealing Studios", coord: { lat: 51.5, lng: -0.3 } })]],
  });
  assert.deepEqual(plan.flags, ["studio_name_without_studio_type:Q400"]);
  assert.equal(plan.places[0].place_class, "real_exterior"); // flag only, no authority
});

// --- Idempotency -------------------------------------------------------------

test("missingEvidenceRows returns nothing on a second identical run", () => {
  const plan = planFixture({
    locations: ["Q100"],
    locationEntities: [["Q100", entity({ label: "Bradbury Building", coord: { lat: 34.05, lng: -118.25 } })]],
  });
  assert.equal(missingEvidenceRows(plan.evidence, []).length, 2);
  assert.equal(missingEvidenceRows(plan.evidence, plan.evidence).length, 0);
});

test("missingEvidenceRows keeps a different method for the same subject", () => {
  const base = { subject_type: "place", subject_ref: "Q100", method: "wikidata_statement", source_ref: "Q100" };
  const later = { ...base, method: "web_search_cited", source_ref: "https://example.org/a" };
  assert.deepEqual(missingEvidenceRows([base, later], [base]), [later]);
});

test("evidenceKey and linkKeyOf are stable identities", () => {
  assert.equal(
    evidenceKey({ subject_type: "link", subject_ref: "w1|Q100|filming_location", method: "wikidata_statement", source_ref: "Q1/P915/Q100" }),
    "link|w1|Q100|filming_location|wikidata_statement|Q1/P915/Q100",
  );
  assert.equal(
    linkKeyOf({ workKey: "w1", placeWikidataId: "Q100", relationKind: "filming_location" }),
    "w1|Q100|filming_location",
  );
});

// --- Fetch layer (DI, zero network) -----------------------------------------

function entityResponse(entities) {
  return new Response(JSON.stringify({ entities }), { status: 200 });
}

test("fetchWikidataEntities chunks ids and merges the results", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return entityResponse({ Q1: entity({ label: "One" }), Q2: entity({ label: "Two" }) });
  };
  const entities = await fetchWikidataEntities(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"], { fetchImpl, chunkSize: 5 });
  assert.equal(urls.length, 2); // 6 ids → two chunks
  assert.equal(entities.size, 2);
});

test("fetchWikidataEntities ignores malformed ids and never calls out for an empty set", async () => {
  let called = false;
  const entities = await fetchWikidataEntities(["nope", null], {
    fetchImpl: async () => { called = true; return entityResponse({}); },
  });
  assert.equal(called, false);
  assert.equal(entities.size, 0);
});

test("fetchTypeGraph walks P279 upward and stops at the depth bound", async () => {
  const chain = {
    Q1: entity({ label: "L1", p279: ["Q2"] }),
    Q2: entity({ label: "L2", p279: ["Q3"] }),
    Q3: entity({ label: "L3", p279: ["Q4"] }),
    Q4: entity({ label: "L4", p279: ["Q5"] }),
    Q5: entity({ label: "L5" }),
  };
  const fetchImpl = async (url) => {
    const ids = new URL(url).searchParams.get("ids").split("|");
    return entityResponse(Object.fromEntries(ids.filter((id) => chain[id]).map((id) => [id, chain[id]])));
  };
  const graph = await fetchTypeGraph(["Q1"], { fetchImpl, maxDepth: 3 });
  assert.deepEqual([...graph.keys()], ["Q1", "Q2", "Q3"]); // 3 levels, not 5
});

test("fetchTypeGraph never truncates a level, so no chain is stranded", async () => {
  // Truncating a wide level fails OPEN: a fictional place whose chain to Q3895768 is
  // severed falls through to "real place with a real coordinate" and gets pinned.
  const wide = entity({ label: "wide", p279: ["Q10", "Q11", "Q12", "Q13"] });
  const fetchImpl = async (url) => {
    const ids = new URL(url).searchParams.get("ids").split("|");
    return entityResponse(Object.fromEntries(ids.map((id) => [id, id === "Q1" ? wide : entity({ label: id })])));
  };
  const graph = await fetchTypeGraph(["Q1"], { fetchImpl, maxDepth: 4 });
  assert.deepEqual([...graph.keys()].sort(), ["Q1", "Q10", "Q11", "Q12", "Q13"]);
});

test("fetchTypeGraph resolves a deep fiction chain that a truncating graph would strand", async () => {
  // Q500 → Q501 → Q502 → Q3895768: classification is only correct if every level ran.
  const chain = {
    Q500: entity({ label: "fictional lake", p279: ["Q501"] }),
    Q501: entity({ label: "fictional body of water", p279: ["Q502"] }),
    Q502: entity({ label: "fictional geographic feature", p279: ["Q3895768"] }),
    Q3895768: entity({ label: "fictional location" }),
  };
  const fetchImpl = async (url) => {
    const ids = new URL(url).searchParams.get("ids").split("|");
    return entityResponse(Object.fromEntries(ids.filter((id) => chain[id]).map((id) => [id, chain[id]])));
  };
  const typeGraph = await fetchTypeGraph(["Q500"], { fetchImpl, maxDepth: 4 });
  const plan = buildResolutionPlan({
    works: [FILM_WORK],
    workQids: new Map([["w1", { wikidataId: "Q1" }]]),
    entities: new Map([
      ["Q1", entity({ label: "A Film", locations: ["Q900"] })],
      ["Q900", entity({ label: "Lake Fictional", p31: ["Q500"], coord: { lat: 10, lng: 10 } })],
    ]),
    typeGraph,
  });
  assert.equal(plan.places[0].place_class, "fictional");
  assert.equal(plan.places[0].lat, null); // the coordinate is refused, not pinned
});

test("resolveWorkPlaces runs Stage 0+1 end to end with injected fetch", async () => {
  const store = {
    Q1: entity({ label: "A Film", locations: ["Q100", "Q200"] }),
    Q100: entity({ label: "Bradbury Building", coord: { lat: 34.05, lng: -118.25 } }),
    Q200: entity({ label: "Hogwarts", p31: ["Q3895768"] }),
    Q3895768: entity({ label: "fictional location" }),
  };
  const fetchImpl = async (url) => {
    const ids = new URL(url).searchParams.get("ids").split("|");
    return entityResponse(Object.fromEntries(ids.filter((id) => store[id]).map((id) => [id, store[id]])));
  };

  const { plan } = await resolveWorkPlaces(
    [{ id: "w1", kind: "film", wikidata_id: "Q1" }],
    { fetchImpl },
  );

  const byId = Object.fromEntries(plan.places.map((p) => [p.wikidata_id, p]));
  assert.equal(byId.Q100.place_class, "real_exterior");
  assert.equal(byId.Q100.lat, 34.05);
  assert.equal(byId.Q200.place_class, "fictional");
  assert.equal(byId.Q200.lat, null); // fiction resolved, never geocoded
  assert.equal(plan.links.length, 2);
  assert.equal(plan.skipped.length, 0);
});

test("resolveWorkPlaces cross-walks only works that lack a QID", async () => {
  const store = { Q1: entity({ label: "Known", locations: [] }), Q9: entity({ label: "Found", locations: [] }) };
  const fetchImpl = async (url) => {
    const ids = new URL(url).searchParams.get("ids").split("|");
    return entityResponse(Object.fromEntries(ids.filter((id) => store[id]).map((id) => [id, store[id]])));
  };
  let crosswalkArg = null;
  const crosswalk = async (works) => {
    crosswalkArg = works.map((w) => w.id);
    return new Map([["w2", { wikidataId: "Q9", conflict: false }]]);
  };

  const { workQids } = await resolveWorkPlaces(
    [
      { id: "w1", kind: "film", wikidata_id: "Q1" },
      { id: "w2", kind: "film", tmdb_id: "509" },
    ],
    { fetchImpl, crosswalk },
  );
  assert.deepEqual(crosswalkArg, ["w2"]); // w1 already had its QID
  assert.equal(workQids.get("w2").wikidataId, "Q9");
});
