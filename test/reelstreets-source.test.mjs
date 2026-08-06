import assert from "node:assert/strict";
import test from "node:test";

import {
  captureToSubmission,
  dedupeByPlaceKey,
  evidenceMedia,
  filmToWork,
  matchWork,
  SOURCE,
  USABLE_PRECISION,
  yearsAgree,
} from "../app/lib/reelstreets-source.mjs";

const WORK = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const film = (overrides = {}) => ({
  id: 339851,
  slug: "amelie",
  url: "https://www.reelstreets.com/films/amelie/",
  title: "Amelie",
  year: 2001,
  regions: ["France"],
  ...overrides,
});

// Shaped like what extract_places.py writes.
const capture = (overrides = {}) => ({
  index: 4,
  caption: "He hates scornful glances at his sandals. Gare de l'est, Place du 11 Novembre 1918, 75010",
  place: "Gare de l'est, Place du 11 Novembre 1918, 75010",
  kind: "real",
  precision: "building",
  lat: null,
  lng: null,
  also_seen_in: [],
  then_url: "https://www.reelstreets.com/wp-content/uploads/Films/amelie/am004.jpg",
  now_url: null,
  now_note: null,
  now_by: null,
  now_date: null,
  ...overrides,
});

const index = (works) => {
  const map = new Map();
  for (const work of works) {
    const key = work.title_norm;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(work);
  }
  return map;
};

test("a year within one counts as the same release", () => {
  assert.equal(yearsAgree(2001, 2001), true);
  assert.equal(yearsAgree(2001, 2002), true);   // festival run vs general release
  assert.equal(yearsAgree(2001, 2004), false);
  // Unknowable, not false: 6,029 of our works have no year at all.
  assert.equal(yearsAgree(2001, null), null);
  assert.equal(yearsAgree(null, null), null);
});

test("one work with the title is the match", () => {
  const works = index([{ id: WORK, title: "Amelie", title_norm: "amelie", year: 2001 }]);
  assert.equal(matchWork(film(), works).work.id, WORK);
});

test("a work with no year still matches on title alone", () => {
  // The common case after the MovieMaps import: one candidate, year unknown.
  const works = index([{ id: WORK, title: "Amelie", title_norm: "amelie", year: null }]);
  assert.equal(matchWork(film(), works).work.id, WORK);
});

test("one candidate is not a free pass when the years disagree", () => {
  const works = index([{ id: WORK, title: "Amelie", title_norm: "amelie", year: 1954 }]);
  const { work, reason } = matchWork(film(), works);
  assert.equal(work, null);
  assert.match(reason, /year mismatch/);
});

test("several works sharing a title are separated by year, or not at all", () => {
  const separable = index([
    { id: WORK, title: "Amelie", title_norm: "amelie", year: 2001 },
    { id: OTHER, title: "Amelie", title_norm: "amelie", year: 1954 },
  ]);
  assert.equal(matchWork(film(), separable).work.id, WORK);

  // Both from the scrape, both yearless: nothing can decide, so nothing does.
  // Guessing here would attach one film's locations to another and look right.
  const ambiguous = index([
    { id: WORK, title: "Amelie", title_norm: "amelie", year: null },
    { id: OTHER, title: "Amelie", title_norm: "amelie", year: null },
  ]);
  const { work, reason } = matchWork(film(), ambiguous);
  assert.equal(work, null);
  assert.match(reason, /year cannot separate them/);
});

test("a title we do not hold is reported, not forced", () => {
  const { work, reason } = matchWork(film({ title: "Nothing We Have" }), index([]));
  assert.equal(work, null);
  assert.match(reason, /no work with this title/);
});

test("a submission carries the caption as its evidence", () => {
  const row = captureToSubmission(capture(), { workId: WORK, film: film() });

  assert.equal(row.work_id, WORK);
  assert.equal(row.place_name, "Gare de l'est, Place du 11 Novembre 1918, 75010");
  assert.equal(row.source_kind, "reelstreets");
  // Film id and capture index: a row leads back to the one shot, not the page.
  assert.equal(row.source_record_id, "339851:4");
  // The sentence a contributor wrote, not the model's extraction — the schema
  // demands it for this kind precisely so the extraction can be checked.
  assert.match(row.source_sentence, /scornful glances/);
  assert.equal(row.source_license, "unstated");
  assert.equal(row.area_hint, "France");
});

test("no coordinate is invented", () => {
  const row = captureToSubmission(capture(), { workId: WORK, film: film() });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  // The constraint only demands geocode provenance when lat is set, so a row
  // with no point must claim no geocoder either.
  assert.equal(row.geocode_source, null);
  assert.equal(row.geocode_license, null);
});

test("a coordinate a contributor stated is kept, with its provenance", () => {
  const row = captureToSubmission(
    capture({ lat: 48.8857089, lng: 2.3439967 }),
    { workId: WORK, film: film() },
  );
  assert.equal(row.lat, 48.8857089);
  assert.equal(row.geocode_source, "reelstreets");
  assert.equal(row.geocode_reason, "contributor");
  assert.equal(row.geocode_license, "unstated");
});

test("a place that is only a mood never becomes a pin", () => {
  assert.deepEqual([...USABLE_PRECISION].sort(), ["area", "building", "street"]);
  for (const precision of ["region", "studio", null]) {
    assert.equal(
      captureToSubmission(capture({ precision, place: "Japan" }), { workId: WORK, film: film() }),
      null,
      `precision ${precision} must not become a submission`,
    );
  }
});

test("a capture with nothing identified is dropped", () => {
  assert.equal(captureToSubmission(capture({ place: null, kind: "unknown" }), { workId: WORK, film: film() }), null);
  assert.equal(captureToSubmission(capture({ kind: "studio" }), { workId: WORK, film: film() }), null);
  assert.equal(captureToSubmission(capture(), { workId: null, film: film() }), null);
});

test("imagery rides along as links, and says which is which", () => {
  const media = evidenceMedia(capture({
    now_url: "https://www.reelstreets.com/now.jpg",
    now_by: "SJ",
    now_date: "29 Apr 2011",
    now_note: "The long standing Portfolio",
  }));
  assert.equal(media.length, 2);
  assert.equal(media[0].kind, "now");
  assert.equal(media[0].by, "SJ");
  assert.equal(media[1].kind, "then");
  // The site states the captures remain the studios'; nothing is downloaded.
  assert.match(media[1].url, /^https:\/\//);
});

test("a shared location is surfaced, because it is what makes a walk", () => {
  const row = captureToSubmission(
    capture({ also_seen_in: ["Just Like a Woman", "London Kills Me"] }),
    { workId: WORK, film: film() },
  );
  assert.match(row.source_attribution, /also seen in Just Like a Woman, London Kills Me/);
  assert.match(row.source_attribution, new RegExp(SOURCE.attribution.slice(0, 20)));
});

test("a film revisiting one street yields one pin, and the richer one", () => {
  const plain = captureToSubmission(capture({ index: 7 }), { workId: WORK, film: film() });
  const withPhoto = captureToSubmission(
    capture({ index: 8, now_url: "https://www.reelstreets.com/now.jpg" }),
    { workId: WORK, film: film() },
  );
  const other = captureToSubmission(
    capture({ index: 9, place: "Rue Lepic" }),
    { workId: WORK, film: film() },
  );

  const deduped = dedupeByPlaceKey([plain, withPhoto, other, null]);
  assert.equal(deduped.length, 2);
  // The capture with a photograph is more use to a reviewer than the one without.
  assert.equal(deduped.find((r) => r.place_name.startsWith("Gare")).source_record_id, "339851:8");
});

test("a scraped film becomes a work that carries its year", () => {
  const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const work = filmToWork(film({ title: "Victoria", year: 2015 }), normalise);

  assert.deepEqual(work, {
    imdb_id: null,
    kind: "film",
    title: "Victoria",
    title_norm: "victoria",
    // The year is the point: MovieMaps gave none, so those 6,029 works cannot be
    // separated by one. These can.
    year: 2015,
    source: "reelstreets",
  });
});

test("a film that cannot be named is not invented", () => {
  const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  assert.equal(filmToWork(film({ title: "" }), normalise), null);
  assert.equal(filmToWork(film({ title: "!!!" }), normalise), null);
  assert.equal(filmToWork({ year: 2015 }, normalise), null);
  // No year is allowed — absent is honest — but it must still be null, not 0.
  assert.equal(filmToWork(film({ year: undefined }), normalise).year, null);
});
