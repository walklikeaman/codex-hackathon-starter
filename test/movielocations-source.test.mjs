import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeByPlaceKey,
  evidenceMedia,
  filmToWork,
  locationToSubmission,
  matchWork,
  SOURCE,
  titleVariants,
} from "../app/lib/movielocations-source.mjs";

const WORK = "11111111-1111-1111-1111-111111111111";

const film = (o = {}) => ({
  id: "Vertigo", url: "https://movie-locations.com/movies/v/Vertigo.php",
  title: "Vertigo", year: 1958, regions: ["San Francisco"], ...o,
});

const location = (o = {}) => ({
  index: 1,
  place: "900 Lombard Street, and Coit Tower on the horizon, San Francisco",
  scene: "Scottie's home",
  caption: "Vertigo filming location: Scottie's home: 900 Lombard Street, and Coit Tower on the horizon, San Francisco",
  photo_url: "https://movie-locations.com/movies/v/Vertigo-Lombard-Street.jpg",
  ...o,
});

test("a submission keeps the caption the place was cut out of", () => {
  const row = locationToSubmission(location(), { workId: WORK, film: film() });
  assert.equal(row.source_kind, "movielocations");
  assert.equal(row.place_name, "900 Lombard Street, and Coit Tower on the horizon, San Francisco");
  // Slug and caption index: back to the one photograph, not the page.
  assert.equal(row.source_record_id, "Vertigo:1");
  // A regex did the cutting, which is predictable but not self-evidently right,
  // so the sentence travels for a reviewer to check it against.
  assert.match(row.source_sentence, /Vertigo filming location/);
  assert.match(row.source_attribution, /scene: Scottie's home/);
  assert.equal(row.source_license, "unstated");
});

test("no coordinate is invented, because the site has none", () => {
  const row = locationToSubmission(location(), { workId: WORK, film: film() });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  // The constraint demands geocode provenance only when lat is set; a row with
  // no point must claim no geocoder either.
  assert.equal(row.geocode_source, null);
  assert.equal(row.geocode_license, null);
});

test("a row that cannot carry its weight is dropped", () => {
  assert.equal(locationToSubmission(location({ place: "" }), { workId: WORK, film: film() }), null);
  assert.equal(locationToSubmission(location({ caption: "short" }), { workId: WORK, film: film() }), null);
  assert.equal(locationToSubmission(location(), { workId: null, film: film() }), null);
  // A runaway caption is a description, not an address.
  assert.equal(locationToSubmission(location({ place: "x".repeat(201) }), { workId: WORK, film: film() }), null);
});

test("the photograph is a link, and says whose it is", () => {
  const media = evidenceMedia(location());
  assert.equal(media.length, 1);
  // Not a film still — this site has none. A location photograph is the site's,
  // a still would be the studio's, and neither is ours to re-host.
  assert.equal(media[0].kind, "location_photo");
  assert.equal(media[0].by, "movie-locations.com");
  assert.equal(evidenceMedia(location({ photo_url: null })), null);
});

test("a scraped film becomes a work carrying its year", () => {
  assert.deepEqual(filmToWork(film()), {
    imdb_id: null, kind: "film", title: "Vertigo",
    title_norm: "vertigo", year: 1958, source: "movielocations",
  });
  assert.equal(filmToWork(film({ title: "" })), null);
  assert.equal(filmToWork(film({ year: undefined })).year, null);
});

test("matching is ReelStreets' matcher, refusals included", () => {
  const works = new Map([["vertigo", [{ id: WORK, title: "Vertigo", title_norm: "vertigo", year: 1958 }]]]);
  assert.equal(matchWork(film(), works).work.id, WORK);
  // Same title, wrong decade: a different film.
  assert.equal(matchWork(film({ year: 2010 }), works).work, null);
  assert.match(matchWork(film({ title: "Absent" }), new Map()).reason, /no work with this title/);
});

test("places differing only in case collapse before the upsert, not by it", () => {
  const rows = [
    locationToSubmission(location(), { workId: WORK, film: film() }),
    locationToSubmission(location({ index: 2, place: "900 LOMBARD STREET, AND COIT TOWER ON THE HORIZON, SAN FRANCISCO" }), { workId: WORK, film: film() }),
    locationToSubmission(location({ index: 3, place: "Claude Lane off Sutter Street" }), { workId: WORK, film: film() }),
    null,
  ];
  const deduped = dedupeByPlaceKey(rows);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].source_record_id, "Vertigo:1");
});

test("the source records silence rather than guessing at a licence", () => {
  assert.equal(SOURCE.license, "unstated");
  assert.equal(SOURCE.licenseUrl, null);
});

test("a bracketed alternative title does not become a second work", () => {
  // The site prints both release titles; matched literally this misses the work
  // we already hold and proposes creating a duplicate.
  const works = new Map([["harry potter and the philosopher s stone",
    [{ id: WORK, title: "Harry Potter and the Philosopher's Stone",
       title_norm: "harry potter and the philosopher s stone", year: 2001 }]]]);
  const scraped = film({
    title: "Harry Potter And The Philosopher's Stone (Harry Potter And The Sorcerer's Stone)",
    year: 2001,
  });
  assert.equal(matchWork(scraped, works).work.id, WORK);
});

test("title variants keep the bracketed form first", () => {
  assert.deepEqual(titleVariants("Leon (The Professional)"), ["Leon (The Professional)", "Leon"]);
  assert.deepEqual(titleVariants("Vertigo"), ["Vertigo"]);
  assert.deepEqual(titleVariants(""), []);
});
