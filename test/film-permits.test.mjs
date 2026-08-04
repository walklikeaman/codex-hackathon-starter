import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecordsUrl,
  CITIES,
  dedupeByAddress,
  isSearchableTitle,
  permitToSubmission,
  titleMatches,
} from "../app/lib/film-permits.mjs";

const paris = CITIES.paris;
const WORK = "11111111-1111-1111-1111-111111111111";

const record = (overrides = {}) => ({
  id_lieu: "2020-000123",
  nom_tournage: "Emily in Paris",
  type_tournage: "Série TV",
  annee_tournage: "2020-01-01T00:00:00+00:00",
  adresse_lieu: "1 place de l'estrapade, 75005 paris",
  ardt_lieu: "75005",
  geo_point_2d: { lat: 48.8437, lon: 2.3462 },
  ...overrides,
});

const submission = (overrides = {}, work = "Emily in Paris") =>
  permitToSubmission(record(overrides), { city: paris, workId: WORK, workTitle: work });

// --- what the licence obliges ----------------------------------------------------------

test("the row carries its own licence, because ODbL is not CC BY-SA", () => {
  // The table used to default every row to 'CC BY-SA 4.0', which was true while
  // Wikipedia was the only writer and becomes a false statement in the database the
  // moment a second source appears. ODbL is share-alike on the DATABASE.
  const row = submission();
  assert.equal(row.source_license, "ODbL 1.0");
  assert.match(row.source_license_url, /opendatacommons\.org/);
  assert.match(row.source_attribution, /Ville de Paris/);
});

test("the coordinate's provenance is the issuer, not our gazetteer", () => {
  // It is neither a Wikidata lookup nor a model's guess, and a later reader must be
  // able to tell which.
  const row = submission();
  assert.equal(row.geocode_source, "opendata_paris");
  assert.equal(row.geocode_reason, "issuing_authority");
  assert.equal(row.source_kind, "permit_record");
  assert.equal(row.source_record_id, "paris:2020-000123");
});

// --- the title search is loose, so the match must not be ---------------------------------

test("a season or part is the same production", () => {
  // The same set is filed under several spellings, which is why the API search is
  // deliberately loose.
  assert.equal(titleMatches("EMILY IN PARIS SAISON 2", "Emily in Paris"), true);
  assert.equal(titleMatches("emily in paris", "Emily in Paris"), true);
  assert.equal(titleMatches("Amélie", "Amelie"), true, "accents must not decide");
});

test("a different production that shares a word is not the same production", () => {
  // The loose search answers "does this title contain those characters", which is a
  // different question, and the records come back looking just as authoritative.
  assert.equal(titleMatches("Paris Police 1900", "Emily in Paris"), false);
  assert.equal(titleMatches("Emily", "Emily in Paris"), false);
  assert.equal(titleMatches("", "Emily in Paris"), false);
});

test("a record whose production is not ours yields no submission", () => {
  assert.equal(submission({ nom_tournage: "Paris Police 1900" }), null);
});

test("a title is filtered for cost, not for correctness", () => {
  // The first version demanded two words, on the theory that a single short word was
  // dangerous. It is not — titleMatches re-checks every returned record against the
  // full title — so all that rule did was silently skip "Skyfall" and "Amélie".
  assert.equal(isSearchableTitle("Sun"), false, "too short to be worth asking");
  assert.equal(isSearchableTitle("Skyfall"), true, "a real one-word title");
  assert.equal(isSearchableTitle("Amélie"), true);
  assert.equal(isSearchableTitle("Emily in Paris"), true);
  assert.equal(buildRecordsUrl(paris, "Sun"), null);
});

test("a loose search still cannot produce a wrong row", () => {
  // This is what makes the cost guard safe to relax: whatever the API returns, the
  // record's own title has to match the work's.
  const foreign = permitToSubmission(
    { ...record(), nom_tournage: "SUNSET BOULEVARD" },
    { city: paris, workId: WORK, workTitle: "Sun" },
  );
  assert.equal(foreign, null);
});

// --- the request -------------------------------------------------------------------------

test("the query asks the API in its own dialect and respects its ceiling", () => {
  const url = buildRecordsUrl(paris, "Emily in Paris", { limit: 500 });
  assert.match(url, /search%28nom_tournage/);
  assert.match(url, /limit=100/, "the API caps a page at 100");
  assert.match(url, /order_by=/, "paging without an order returns rows twice");
});

test("a quote in a title cannot break out of the query", () => {
  const url = buildRecordsUrl(paris, 'The "Great" Escape');
  assert.match(decodeURIComponent(url), /\\"Great\\"/);
});

// --- what cannot be plotted ---------------------------------------------------------------

test("a permit the city never geocoded is dropped, not queued", () => {
  // Unlike a prose claim there is nothing for a reviewer to resolve: the issuing
  // authority simply did not place it.
  assert.equal(submission({ geo_point_2d: {} }), null);
  assert.equal(submission({ geo_point_2d: { lat: 48.8, lon: null } }), null);
  assert.equal(submission({ adresse_lieu: "  " }), null);
  assert.equal(submission({ id_lieu: "" }), null);
});

test("an empty latitude never becomes zero", () => {
  // Number("") is 0, which is a real coordinate in the Gulf of Guinea.
  assert.equal(submission({ geo_point_2d: { lat: "", lon: "" } }), null);
});

// --- one place, several permits ------------------------------------------------------------

test("four days of shooting one street is one pin", () => {
  const rows = [
    submission({ id_lieu: "a", date_debut: "2020-01-01" }),
    submission({ id_lieu: "b", date_debut: "2020-01-02" }),
    submission({ id_lieu: "c", adresse_lieu: "1 PLACE DE L'ESTRAPADE, 75005 PARIS" }),
    submission({ id_lieu: "d", adresse_lieu: "12 rue des ecoles, 75005 paris" }),
  ];
  const deduped = dedupeByAddress(rows);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((row) => row.source_record_id), ["paris:a", "paris:d"]);
});

// --- a city is configuration -----------------------------------------------------------------

test("the coverage window is stated, because asking outside it returns nothing", () => {
  // The set begins in 2016: it holds Emily in Paris and The Eddy, and nothing at all
  // for Amélie or Inception. An empty answer for a classic is honest, not a failure.
  assert.equal(paris.coverage.from, 2016);
  assert.equal(paris.api, "opendatasoft_v2.1");
});
