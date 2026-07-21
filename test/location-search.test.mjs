import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocationsSparql,
  buildWikidataEntitiesUrl,
  buildWikidataSearchUrl,
  cityRadiusKm,
  entityClaimIds,
  locationsWithinRadius,
  normalizeWikidataEntityLocations,
  normalizeWikidataLocations,
  rankNearbyLocations,
  selectFirstMatchingWork,
  workMatchesTypeGraph,
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
