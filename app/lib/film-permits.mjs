// Filming locations from the authority that issued the permit.
//
// Every other source in this project is somebody's account of where a film was shot —
// an encyclopedia sentence, a web page, a model's reading of either. A permit record is
// not an account. The city granted permission to shoot at an address on a date, and the
// record IS the primary document. There is no prose to extract, no gazetteer round
// trip, no model call, and no coordinate for anything to invent: the address arrives
// already geocoded by the issuer.
//
// What it is NOT is proof the footage reached the film. A permit is authorisation, and
// productions abandon locations. So these still land as `pending` — but as
// `permit_record`, which is a different kind of evidence from a sentence, not a
// stronger grade of the same kind.
//
// A city is configuration. Adding one should mean adding an entry below, not a module.

import { finiteOrNull } from "./numbers.mjs";

// Paris, verified live: 14,760 records over 2016–2024, ODbL, published by the city's
// own Direction des Affaires Culturelles.
//
// The date range matters more than the count. The set begins in 2016, so it holds
// Emily in Paris (255 locations), The Eddy, Arsène Lupin and Irma Vep, and holds
// nothing at all for Amélie or Inception. It is a source for recent productions, and
// asking it about a classic returns an honest empty answer rather than a wrong one.
//
// Note the portal's own `modified` metadata says 2023-05-15 while records run to 2024 —
// the data is fresher than the catalogue claims, which is the harmless direction, but
// it means the metadata cannot be used to decide whether a refresh is needed.
export const CITIES = Object.freeze({
  paris: {
    id: "paris",
    label: "Paris",
    api: "opendatasoft_v2.1",
    endpoint: "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/lieux-de-tournage-a-paris/records",
    // ODbL is share-alike ON THE DATABASE, not merely attribution. Storing the licence
    // per row is what lets anyone later answer "what may we publish this under".
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "Lieux de tournage à Paris — Ville de Paris, Direction des Affaires Culturelles (ODbL)",
    coverage: { from: 2016, to: null },
    fields: {
      recordId: "id_lieu",
      title: "nom_tournage",
      kind: "type_tournage",
      year: "annee_tournage",
      director: "nom_realisateur",
      address: "adresse_lieu",
      area: "ardt_lieu",
      point: "geo_point_2d",
      start: "date_debut",
    },
    // Opendatasoft's `search()` is case- and accent-insensitive, verified live:
    // "emily in paris" and "Emily in Paris" both return 255 records.
    titleQuery: (title) => `search(nom_tournage, "${title.replace(/"/g, '\\"')}")`,
  },
});

// Whether a title is worth ASKING about. This is a cost guard and nothing more, and
// separating it from correctness took a wrong turn first.
//
// The search is deliberately loose so that "Emily in Paris" also catches "Emily in
// Paris saison 2" — the same set is filed under several spellings. The first version
// therefore also demanded two words, on the theory that a single short word was
// dangerous. It is not: `titleMatches` below re-checks every returned record against
// the full title, so a loose search cannot produce a wrong row, only a wasted request.
// What the two-word rule actually did was silently skip "Skyfall", "Amélie" and
// "Parasite" — real one-word titles — for a risk that was already covered.
//
// So the only question left is whether the query is so short it drags back thousands of
// records for nothing. "Sun" is; "Skyfall" is not.
export const MIN_TITLE_LENGTH = 5;

export function isSearchableTitle(title) {
  return String(title ?? "").trim().length >= MIN_TITLE_LENGTH;
}

export function buildRecordsUrl(city, title, { limit = 100, offset = 0 } = {}) {
  if (!city?.endpoint || !isSearchableTitle(title)) return null;
  const url = new URL(city.endpoint);
  url.searchParams.set("where", city.titleQuery(String(title).trim()));
  url.searchParams.set("limit", String(Math.min(limit, 100))); // the API's own ceiling
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order_by", `${city.fields.recordId} asc`);
  return url.toString();
}

// Whether a record's production is really the work we asked about.
//
// The API's substring search answers "does this title contain those characters", which
// is not the same question. "Emily in Paris" must match "EMILY IN PARIS SAISON 2" and
// must not match a different production that merely shares a word.
function comparableTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // accents: Amélie === amelie
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titleMatches(recordTitle, wantedTitle) {
  const found = comparableTitle(recordTitle);
  const wanted = comparableTitle(wantedTitle);
  if (!found || !wanted) return false;
  // The record may add a season or a part; it may not be a different production.
  return found === wanted || found.startsWith(`${wanted} `);
}

// One submission row per record, or null when the record cannot support one.
//
// A permit with no coordinate is not a location we can plot, and unlike a prose claim
// there is nothing to review — the issuing authority simply did not geocode it. Those
// are dropped rather than queued.
export function permitToSubmission(record, { city, workId, workTitle }) {
  const f = city.fields;
  const point = record?.[f.point] ?? {};
  const lat = finiteOrNull(point.lat);
  const lng = finiteOrNull(point.lon ?? point.lng);
  const recordId = String(record?.[f.recordId] ?? "").trim();
  const address = String(record?.[f.address] ?? "").trim();

  if (!recordId || !address || lat === null || lng === null) return null;
  if (!titleMatches(record?.[f.title], workTitle)) return null;

  return {
    work_id: workId,
    // The address as the permit wrote it. It is the place's name here, because a permit
    // names a location by where it is rather than by what it is called.
    place_name: address,
    area_hint: String(record?.[f.area] ?? "").trim() || city.label,
    source_kind: "permit_record",
    source_record_id: `${city.id}:${recordId}`,
    source_title: `${city.label} — ${String(record?.[f.title] ?? "").trim()}`,
    source_url: city.endpoint,
    source_license: city.license,
    source_license_url: city.licenseUrl,
    source_attribution: city.attribution,
    lat,
    lng,
    // The issuer geocoded this. Recording that honestly matters: it is neither our
    // Wikidata lookup nor a model's guess, and a later reader must be able to tell.
    geocode_source: `opendata_${city.id}`,
    geocode_source_id: recordId,
    geocode_license: city.license,
    geocode_reason: "issuing_authority",
  };
}

// Several permits at one address are one place. A production shooting a street over
// four days files four records; the map wants one pin.
export function dedupeByAddress(rows) {
  const byAddress = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = comparableTitle(row.place_name);
    if (!key || byAddress.has(key)) continue;
    byAddress.set(key, row);
  }
  return [...byAddress.values()];
}
