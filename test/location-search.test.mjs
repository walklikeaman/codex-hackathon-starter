import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocationsSparql,
  buildWikidataEntitiesUrl,
  EVERY_KIND,
  resolveWorkKind,
  workKindLabel,
  WORK_KINDS,
  buildWikidataSearchUrl,
  cityRadiusKm,
  entityClaimIds,
  locationsWithinRadius,
  normalizeWikidataEntityLocations,
  normalizeWikidataLocations,
  rankNearbyLocations,
  selectFirstMatchingWork,
  workMatchesTypeGraph,
  buildWorkFameQuery,
  fameFromBindings,
  rankWorksByFame,
  WORK_SEARCH_CANDIDATES,
} from "../app/lib/location-search.mjs";

function binding({
  work = "Q1",
  title = "Example",
  location = "Q2",
  place = "Example Place",
  point = "Point(-0.12 51.51)",
  description = "public square in London",
} = {}) {
  return {
    work: { value: `http://www.wikidata.org/entity/${work}` },
    workLabel: { value: title },
    location: { value: `http://www.wikidata.org/entity/${location}` },
    locationLabel: { value: place },
    coord: { value: point },
    locationDescription: { value: description },
    releaseDate: { value: "2012-10-23T00:00:00Z" },
  };
}

function itemClaim(id) {
  return { rank: "normal", mainsnak: { datavalue: { value: { id } } } };
}

function valueClaim(value) {
  return { rank: "normal", mainsnak: { datavalue: { value } } };
}

test("deduplicates core work-location pairs before optional metadata and limit", () => {
  const query = buildLocationsSparql({
    lat: 51.5,
    lng: -0.12,
    radius: 15,
    sourceLimit: 120,
    kind: "film",
  });

  assert.match(query, /SELECT DISTINCT \?work \?location \?coord/);
  assert.match(query, /wd:Q11424/);
  assert.match(query, /wdt:P915/);
  assert.match(query, /wdt:P4947/);
  assert.ok(query.indexOf("LIMIT 120") < query.indexOf("OPTIONAL"));
});

test("uses narrative location for books and filming location for series", () => {
  const bookQuery = buildLocationsSparql({
    lat: 0,
    lng: 0,
    radius: 5,
    sourceLimit: 20,
    kind: "book",
  });
  const seriesQuery = buildLocationsSparql({
    lat: 0,
    lng: 0,
    radius: 5,
    sourceLimit: 20,
    kind: "series",
  });

  assert.match(bookQuery, /wd:Q7725634/);
  assert.match(bookQuery, /wdt:P840/);
  assert.match(seriesQuery, /wd:Q5398426/);
  assert.match(seriesQuery, /wdt:P915/);
});

test("normalizes duplicate Wikidata rows into one described place", () => {
  const locations = normalizeWikidataLocations([binding(), binding()], { kind: "film" });

  assert.equal(locations.length, 1);
  assert.equal(locations[0].work_year, 2012);
  assert.equal(locations[0].relation_kind, "filming_location");
  assert.match(locations[0].relation_description, /Example Place is listed as a filming location for Example/);
  assert.match(locations[0].relation_description, /Public square in London/);
});

test("filters unresolved QID labels from Wikidata results", () => {
  const locations = normalizeWikidataLocations([
    binding({ title: "Q6769811", place: "Named place" }),
    binding({ title: "Named work", place: "Q137104896" }),
  ], { kind: "series" });

  assert.deepEqual(locations, []);
});

test("describes a book place as a story setting", () => {
  const [location] = normalizeWikidataLocations([binding()], { kind: "book" });

  assert.equal(location.relation_kind, "narrative_location");
  assert.equal(location.relation_property, "P840");
  assert.match(location.relation_description, /The story of Example is set in Example Place/);
});

test("title search selects every place for the first matching typed work", () => {
  const locations = normalizeWikidataLocations([
    binding({ work: "Q20", location: "Q201", place: "Second result" }),
    binding({ work: "Q10", location: "Q101", place: "First A" }),
    binding({ work: "Q10", location: "Q102", place: "First B" }),
  ], { kind: "film" });

  const selected = selectFirstMatchingWork(locations, ["Q10", "Q20"], 10);
  assert.deepEqual(selected.map((location) => location.loc_name), ["First A", "First B"]);
});

test("title search drops a coarse city point when precise places exist", () => {
  const locations = normalizeWikidataLocations([
    binding({ work: "Q10", location: "Q84", place: "London" }),
    binding({ work: "Q10", location: "Q101", place: "National Gallery" }),
  ], { kind: "film" });

  assert.deepEqual(
    selectFirstMatchingWork(locations, ["Q10"], 10, "Q84").map((location) => location.loc_name),
    ["National Gallery"],
  );
  assert.deepEqual(
    selectFirstMatchingWork(locations.slice(0, 1), ["Q10"], 10, "Q84").map((location) => location.loc_name),
    ["London"],
  );
});

test("nearby browsing prioritizes works with several distinct places", () => {
  const locations = normalizeWikidataLocations([
    binding({ work: "Q1", location: "Q11" }),
    binding({ work: "Q2", location: "Q21" }),
    binding({ work: "Q2", location: "Q22" }),
    binding({ work: "Q2", location: "Q23" }),
  ], { kind: "film" });

  const ranked = rankNearbyLocations(locations, { limit: 4 });
  assert.deepEqual(ranked.map((location) => location.work_wikidata_id), ["Q2", "Q2", "Q2", "Q1"]);
});

test("filters a work's global locations to the selected city radius", () => {
  const locations = normalizeWikidataLocations([
    binding({ location: "Q10", point: "Point(-0.13 51.51)" }),
    binding({ location: "Q11", point: "Point(2.35 48.86)" }),
  ], { kind: "film" });
  const nearby = locationsWithinRadius(locations, { lat: 51.5072, lng: -0.1276 }, 20);

  assert.deepEqual(nearby.map((location) => location.loc_wikidata_id), ["Q10"]);
});

test("derives a bounded search radius from a geocoder bounding box", () => {
  assert.equal(cityRadiusKm({
    lat: 51.5,
    lng: -0.12,
    boundingBox: [51.49, 51.51, -0.13, -0.11],
  }), 5);
  assert.equal(cityRadiusKm({
    lat: 0,
    lng: 0,
    boundingBox: [-10, 10, -10, 10],
  }), 50);
});

test("encodes arbitrary work titles through URLSearchParams", () => {
  const url = buildWikidataSearchUrl('Paris, Texas & "friends"');
  assert.equal(url.searchParams.get("search"), 'Paris, Texas & "friends"');
  assert.equal(url.searchParams.get("action"), "wbsearchentities");
});

test("builds a bounded entity API request", () => {
  const url = buildWikidataEntitiesUrl(["Q1", "Q2", "Q1"]);
  assert.equal(url.searchParams.get("ids"), "Q1|Q2");
  assert.equal(url.searchParams.get("props"), "labels|descriptions|claims");
});

test("matches work kinds through Wikidata subclass claims", () => {
  const novel = { id: "Q10", claims: { P31: [itemClaim("Q8261")] } };
  const typeGraph = new Map([
    ["Q8261", { id: "Q8261", claims: { P279: [itemClaim("Q7725634")] } }],
  ]);

  assert.equal(workMatchesTypeGraph(novel, typeGraph, "book"), true);
  assert.equal(workMatchesTypeGraph(novel, typeGraph, "series"), false);
  assert.deepEqual(entityClaimIds(novel, "P31"), ["Q8261"]);
});

test("normalizes title locations directly from Wikidata entities", () => {
  const work = {
    id: "Q10",
    labels: { en: { value: "Example Film" } },
    claims: {
      P31: [itemClaim("Q11424")],
      P577: [valueClaim({ time: "+2012-10-23T00:00:00Z" })],
      P915: [itemClaim("Q20")],
      P4947: [valueClaim("123")],
    },
  };
  const place = {
    id: "Q20",
    labels: { en: { value: "Example Place" } },
    descriptions: { en: { value: "public square in London" } },
    claims: {
      P625: [valueClaim({ latitude: 51.51, longitude: -0.12 })],
      P18: [valueClaim("Example image.jpg")],
    },
  };

  const [location] = normalizeWikidataEntityLocations(work, new Map([["Q20", place]]), { kind: "film" });
  assert.equal(location.work_year, 2012);
  assert.equal(location.loc_name, "Example Place");
  assert.equal(location.film_tmdb_id, "123");
  assert.match(location.commons_image, /Example%20image\.jpg/);
  assert.match(location.relation_description, /Public square in London/);
});

test("filters unresolved QID labels from Wikidata entity locations", () => {
  const work = {
    id: "Q10",
    labels: { en: { value: "Q6769811" } },
    claims: { P915: [itemClaim("Q20")] },
  };
  const place = {
    id: "Q20",
    labels: { en: { value: "Named Place" } },
    claims: { P625: [valueClaim({ latitude: 51.51, longitude: -0.12 })] },
  };

  assert.deepEqual(
    normalizeWikidataEntityLocations(work, new Map([["Q20", place]]), { kind: "series" }),
    [],
  );
});

// --- which of several things with one name did they mean ---------------------------------

test("the famous one wins, because a label match cannot tell a film from a lyric video", () => {
  // Measured on the live search. "Skyfall" returns Adele's song, her lyric video and the
  // soundtrack before the film — and a music video IS a film in Wikidata's hierarchy, so
  // the type check passes it and the answer is a work with no filming locations. Sitelink
  // counts are the separator: film 78, song 36, soundtrack 9.
  const matches = [
    { id: "Q326790", label: "Skyfall", description: "song by Adele" },
    { id: "Q57840000", label: "Skyfall", description: "lyric video" },
    { id: "Q4941", label: "Skyfall", description: "2012 film" },
  ];
  const ranked = rankWorksByFame(matches, new Map([["Q326790", 36], ["Q57840000", 2], ["Q4941", 78]]));

  assert.deepEqual(ranked.map((work) => work.id), ["Q4941", "Q326790", "Q57840000"]);
});

test("a candidate nobody has written about sorts last, not first", () => {
  const ranked = rankWorksByFame(
    [{ id: "Q1" }, { id: "Q2" }, { id: "Q3" }],
    new Map([["Q2", 40]]),
  );
  assert.equal(ranked[0].id, "Q2");
});

test("the fame query asks about every candidate and nothing else", () => {
  const query = buildWorkFameQuery(["Q4941", "Q326790", "Q4941", "not-a-qid"]);
  assert.match(query, /wd:Q4941 wd:Q326790/);
  assert.match(query, /wikibase:sitelinks/);
  assert.equal(buildWorkFameQuery([]), null);
  assert.equal(buildWorkFameQuery(null), null);
});

test("fame is read from the binding, and an unreadable count is zero rather than NaN", () => {
  const fame = fameFromBindings({ results: { bindings: [
    { item: { value: "http://www.wikidata.org/entity/Q4941" }, sitelinks: { value: "78" } },
    { item: { value: "http://www.wikidata.org/entity/Q7537701" } },
    { item: { value: "not-an-entity" }, sitelinks: { value: "9" } },
  ] } });

  assert.equal(fame.get("Q4941"), 78);
  assert.equal(fame.get("Q7537701"), 0);
  assert.equal(fame.size, 2, "a row without a q-id is dropped");
});

test("fifteen candidates, because the film was not in the top eight", () => {
  assert.equal(WORK_SEARCH_CANDIDATES, 15);
  assert.match(String(buildWikidataSearchUrl("Skyfall")), /limit=15/);
});


// Every kind at once (#240). The panel asked for films only and said so nowhere, so a
// first-time visitor could not see a single series or book location and was never told
// one existed.

test("the every-kind query asks for all three, each with its own share of the budget", () => {
  const query = buildLocationsSparql({
    lat: 51.5074, lng: -0.1278, radius: 15, sourceLimit: 60, kind: EVERY_KIND, workIds: [],
  });

  for (const root of ["Q11424", "Q5398426", "Q7725634"]) {
    assert.ok(query.includes(`wd:${root}`), `asks about ${root}`);
  }
  // A single LIMIT over the union is spent in branch order: measured live, 60 rows came
  // back and all 60 were films. Each branch carries the FULL budget — a third each was
  // measured too, and it starved the merged list to 5 places where film alone returned 11.
  assert.equal((query.match(/LIMIT 60/g) ?? []).length, WORK_KINDS.length);
  assert.ok(query.includes('BIND("book" AS ?workKind)'));
});

test("every kind is asked the same question a single kind is asked", () => {
  const query = buildLocationsSparql({
    lat: 0, lng: 0, radius: 5, sourceLimit: 12, kind: EVERY_KIND, workIds: [],
  });
  assert.equal((query.match(/LIMIT 12/g) ?? []).length, WORK_KINDS.length);
  // And the outer cap has to hold all three branches, or it re-imposes the starvation.
  assert.ok(query.includes(`LIMIT ${12 * WORK_KINDS.length}`));
});

// A title search names ONE work, and a work is of one kind.
test("a work list under every kind is refused rather than guessed", () => {
  assert.throws(() => buildLocationsSparql({
    lat: 0, lng: 0, radius: 5, sourceLimit: 10, kind: EVERY_KIND, workIds: ["Q1"],
  }), /kind of its own/);
});

// P915 is "the camera was here" and P840 is "the story is set here". The union must not
// blur them.
test("each row keeps the relation of the branch that matched it", () => {
  const rows = [
    {
      work: { value: "http://www.wikidata.org/entity/Q1" }, workLabel: { value: "A Film" },
      location: { value: "http://www.wikidata.org/entity/Q10" }, locationLabel: { value: "A Street" },
      coord: { value: "Point(-0.1 51.5)" }, workKind: { value: "film" },
    },
    {
      work: { value: "http://www.wikidata.org/entity/Q2" }, workLabel: { value: "A Novel" },
      location: { value: "http://www.wikidata.org/entity/Q11" }, locationLabel: { value: "A Square" },
      coord: { value: "Point(-0.2 51.6)" }, workKind: { value: "book" },
    },
  ];

  const places = normalizeWikidataLocations(rows, { kind: EVERY_KIND });
  assert.deepEqual(places.map((place) => [place.kind, place.relation_label]), [
    ["film", "Filming location"],
    ["book", "Story setting"],
  ]);
  assert.deepEqual(places.map((place) => place.relation_property), ["P915", "P840"]);
});

test("a row whose branch is unreadable is dropped, never labelled as a film", () => {
  const rows = [{
    work: { value: "http://www.wikidata.org/entity/Q1" }, workLabel: { value: "Untyped" },
    location: { value: "http://www.wikidata.org/entity/Q10" }, locationLabel: { value: "Somewhere" },
    coord: { value: "Point(-0.1 51.5)" },
  }];
  assert.deepEqual(normalizeWikidataLocations(rows, { kind: EVERY_KIND }), []);
});

// Asking for every kind still has to end with one: which property holds a work's places is
// a fact about the work, not about the search.
test("a title search under every kind resolves the kind the work turned out to be", () => {
  const seriesEntity = { id: "Q9", claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5398426" } } } }] } };
  assert.equal(resolveWorkKind(seriesEntity, new Map(), EVERY_KIND), "series");
  assert.equal(resolveWorkKind(seriesEntity, new Map(), "film"), null);
  assert.equal(workMatchesTypeGraph(seriesEntity, new Map(), EVERY_KIND), true);
});

test("the set is named the way a reader would name it", () => {
  assert.equal(workKindLabel(EVERY_KIND), "work");
  assert.equal(workKindLabel(EVERY_KIND, { plural: true }), "works");
  assert.equal(workKindLabel("series", { plural: true }), "series");
  assert.equal(workKindLabel("book"), "book");
});

// Five works fit in the panel. With three kinds merged the five biggest were all series
// and books: measured on London, "every kind" returned 6 places and not one film, where
// film alone returned 11.
test("the five-work cap is shared between kinds instead of taken by the biggest", () => {
  const place = (kind, work, n) => Array.from({ length: n }, (_, i) => ({
    kind, work_wikidata_id: work, loc_wikidata_id: `${work}-${i}`, work_title: work,
  }));
  const locations = [
    ...place("series", "S1", 9), ...place("series", "S2", 8), ...place("series", "S3", 7),
    ...place("book", "B1", 6), ...place("book", "B2", 5),
    ...place("film", "F1", 4), ...place("film", "F2", 3),
  ];

  const unbalanced = rankNearbyLocations(locations, { limit: 30 });
  assert.deepEqual([...new Set(unbalanced.map((row) => row.kind))].sort(), ["book", "series"]);

  const balanced = rankNearbyLocations(locations, { limit: 30, balanced: true });
  assert.deepEqual([...new Set(balanced.map((row) => row.kind))].sort(), ["book", "film", "series"]);
  // Biggest first within each kind, and the turns go in kind order.
  assert.deepEqual([...new Set(balanced.map((row) => row.work_wikidata_id))], ["F1", "S1", "B1", "F2", "S2"]);
});

// A kind with nothing here yields its turn rather than holding a slot empty.
test("a kind that is absent costs the others nothing", () => {
  const place = (kind, work, n) => Array.from({ length: n }, (_, i) => ({
    kind, work_wikidata_id: work, loc_wikidata_id: `${work}-${i}`,
  }));
  const balanced = rankNearbyLocations([
    ...place("film", "F1", 3), ...place("film", "F2", 2), ...place("film", "F3", 2),
    ...place("book", "B1", 4),
  ], { limit: 30, balanced: true });

  assert.deepEqual([...new Set(balanced.map((row) => row.work_wikidata_id))], ["F1", "B1", "F2", "F3"]);
});
