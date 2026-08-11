import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeByPlaceKey,
  evidenceMedia,
  evidenceSentence,
  imdbIdOf,
  locationToSubmission,
  movieToWork,
  placeNameOf,
  SOURCE,
} from "../app/lib/moviemaps-source.mjs";

const WORK = "11111111-1111-1111-1111-111111111111";

// Shaped like what tools/scraperai/harvest.py writes for a movie-page location.
const location = (overrides = {}) => ({
  location_id: "1",
  location_url: "https://moviemaps.org/locations/1",
  location_name: "118 Stevens Drive",
  as_name: "The Cullen's House",
  lat: 49.3582876312241,
  lng: -123.121367990754,
  city: { id: "99", name: "West Vancouver" },
  country: "Canada",
  source: { name: "Jason Soprovich", url: "http://www.soprovich.com/listings/" },
  frames: [],
  ...overrides,
});

test("an IMDb id is recognised only in its real shape", () => {
  assert.equal(imdbIdOf({ external: { imdb_id: "tt1259571" } }), "tt1259571");
  assert.equal(imdbIdOf({ external: { imdb_id: " tt0111161 " } }), "tt0111161");
  // Anything else is a miss, not a repair: a half-parsed id would attach one film's
  // locations to whichever work happened to hold the malformed string.
  assert.equal(imdbIdOf({ external: { imdb_id: "1259571" } }), null);
  assert.equal(imdbIdOf({ external: { imdb_id: "tt12" } }), null);
  assert.equal(imdbIdOf({ external: {} }), null);
  assert.equal(imdbIdOf({}), null);
  assert.equal(imdbIdOf(null), null);
});

test("the place is the real one, not the one it plays", () => {
  assert.equal(placeNameOf(location()), "118 Stevens Drive");
  // Location-page records name the field differently; both are the real-world name.
  assert.equal(placeNameOf({ name: "Buckaroo Tavern" }), "Buckaroo Tavern");
  assert.equal(placeNameOf({}), null);
});

test("a submission carries coordinates, provenance and the unstated licence", () => {
  const row = locationToSubmission(location(), { workId: WORK });

  assert.equal(row.work_id, WORK);
  assert.equal(row.place_name, "118 Stevens Drive");
  assert.equal(row.source_kind, "moviemaps");
  assert.equal(row.source_record_id, "1");
  assert.equal(row.source_url, "https://moviemaps.org/locations/1");
  assert.equal(row.lat, 49.3582876312241);
  assert.equal(row.lng, -123.121367990754);

  // The licence is recorded as absent rather than guessed at. This is the field that
  // decides whether anything here may be republished.
  assert.equal(row.source_license, SOURCE.license);
  assert.equal(row.source_license, "unstated");
  assert.equal(row.source_license_url, null);

  // A contributor placed the pin — not Wikidata, not a model.
  assert.equal(row.geocode_source, "moviemaps");
  assert.equal(row.geocode_reason, "contributor");
  assert.equal(row.geocode_license, "unstated");

  // The contributor's own citation is the best trust signal on the row, so it is
  // visible in the attribution rather than dropped.
  assert.match(row.source_attribution, /Jason Soprovich/);
});

test("a row that cannot carry its own weight is dropped, not patched", () => {
  assert.equal(locationToSubmission(location({ lat: null, lng: null }), { workId: WORK }), null);
  assert.equal(locationToSubmission(location({ location_name: "" }), { workId: WORK }), null);
  assert.equal(locationToSubmission(location({ location_id: "" }), { workId: WORK }), null);
  assert.equal(locationToSubmission(location(), { workId: null }), null);

  // Null Island is the specific failure numbers.mjs exists to prevent: a coordinate of
  // 0,0 built out of absent values looks entirely valid on a map.
  const zeroed = locationToSubmission(location({ lat: "", lng: undefined }), { workId: WORK });
  assert.equal(zeroed, null);
});

test("out-of-range coordinates are refused", () => {
  assert.equal(locationToSubmission(location({ lat: 91 }), { workId: WORK }), null);
  assert.equal(locationToSubmission(location({ lng: -181 }), { workId: WORK }), null);
});

test("evidence is quoted from the source or left absent", () => {
  assert.equal(
    evidenceSentence({ scene: "Cameron and Michael head to a biker bar.", asName: "Buckaroo" }),
    'Appears as "Buckaroo". Cameron and Michael head to a biker bar.',
  );
  // Nothing to say is said as nothing. The schema accepts a null sentence for this
  // kind precisely so the ingest never has to invent one.
  assert.equal(evidenceSentence({ scene: null, asName: null, note: null }), null);
  assert.equal(evidenceSentence({ scene: "  " }), null);
  // Too short to be evidence.
  assert.equal(evidenceSentence({ scene: "Bar" }), null);
});

test("evidence does not repeat itself", () => {
  // scene and note are separate fields on the page and are often the same text.
  const repeated = "Cameron and Michael head to a biker bar to talk to Patrick.";
  assert.equal(evidenceSentence({ scene: repeated, note: repeated }), repeated);

  // "The Ritz" playing The Ritz is not information.
  assert.equal(
    evidenceSentence({ asName: "The Ritz", placeName: "The Ritz", scene: "Anna and William meet the press." }),
    "Anna and William meet the press.",
  );
  assert.equal(evidenceSentence({ asName: "the ritz", placeName: "The Ritz" }), null);
});

test("frames ride along as links, never as bytes", () => {
  const frames = [
    { id: "fji", page: "https://moviemaps.org/images/fji", thumb: "t.jpg", full: "f.jpg" },
    { id: "fjj", page: null, thumb: null, full: "" },
  ];
  const media = evidenceMedia(frames);
  assert.equal(media.length, 1);
  assert.deepEqual(media[0], { page: "https://moviemaps.org/images/fji", thumb: "t.jpg", full: "f.jpg" });
  assert.equal(evidenceMedia([]), null);
  assert.equal(evidenceMedia(null), null);
});

test("detail from the location page fills address, scene and frames", () => {
  const row = locationToSubmission(location(), {
    workId: WORK,
    detail: {
      address: "4201 Fremont Ave N Seattle, WA 98103-7221",
      scene: "Cameron and Michael head to a biker bar to talk to Patrick.",
      frames: [{ page: "p", thumb: "t", full: "f" }],
    },
  });

  assert.equal(row.area_hint, "4201 Fremont Ave N Seattle, WA 98103-7221");
  assert.match(row.source_sentence, /biker bar/);
  assert.equal(row.source_media.length, 1);
});

test("without a location page the city stands in for the address", () => {
  const row = locationToSubmission(location(), { workId: WORK });
  assert.equal(row.area_hint, "West Vancouver");
  assert.equal(row.source_media, null);
});

test("a scraped film becomes a work, stamped as scraped", () => {
  const work = movieToWork({ title: "Zombieland", kind: "film", external: { imdb_id: "tt1156398" } });

  assert.deepEqual(work, {
    imdb_id: "tt1156398",
    kind: "film",
    title: "Zombieland",
    title_norm: "zombieland",
    // MovieMaps publishes no year anywhere on a film page. Null says that;
    // any number here would be invented.
    year: null,
    // Without this nobody could later tell a curated work from a scraped one.
    source: "moviemaps",
  });
});

test("a page that links to episodes is a series", () => {
  assert.equal(movieToWork({ title: "The Crown", kind: "series", external: { imdb_id: "tt4786824" } }).kind, "series");
  assert.equal(movieToWork({ title: "Skyfall", kind: "film", external: { imdb_id: "tt1074638" } }).kind, "film");
  // An absent or unexpected kind falls back to film rather than to a value the
  // works.kind check constraint would reject.
  assert.equal(movieToWork({ title: "Zombieland", external: { imdb_id: "tt1156398" } }).kind, "film");
  assert.equal(movieToWork({ title: "Zombieland", kind: "episode", external: { imdb_id: "tt1156398" } }).kind, "film");
});

test("title_norm uses the catalogue's own normaliser", () => {
  // Same function that produced title_norm for every existing row, so a scraped
  // "Amélie" and an imported "Amelie" collide as they should.
  assert.equal(movieToWork({ title: "Amélie", external: { imdb_id: "tt0211915" } }).title_norm, "amelie");
  assert.equal(movieToWork({ title: "28 Days Later…", external: { imdb_id: "tt0289043" } }).title_norm, "28 days later");
});

test("a film that cannot be identified is not invented", () => {
  assert.equal(movieToWork({ title: "Zombieland", external: {} }), null);
  assert.equal(movieToWork({ title: "", external: { imdb_id: "tt1156398" } }), null);
  // A title that normalises to nothing would violate works_title_norm's purpose
  // and match every other such row.
  assert.equal(movieToWork({ title: "!!!", external: { imdb_id: "tt1156398" } }), null);
  assert.equal(movieToWork(null), null);
});

test("duplicate places are dropped before the upsert, not by it", () => {
  // (work_id, place_key) is the upsert key and place_key is lower(btrim(place_name)),
  // so two rows differing only in case would not error — the second would silently
  // overwrite the first inside one batch.
  const rows = [
    locationToSubmission(location(), { workId: WORK }),
    locationToSubmission(location({ location_id: "9", location_name: "118 STEVENS DRIVE" }), { workId: WORK }),
    locationToSubmission(location({ location_id: "2", location_name: "Gilleys Trail" }), { workId: WORK }),
    null,
  ];

  const deduped = dedupeByPlaceKey(rows);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((row) => row.source_record_id), ["1", "2"]);
});
