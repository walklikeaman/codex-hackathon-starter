// Filming locations from reelstreets.com — pure helpers for the ingest.
//
// The fourth kind of submission, and the weakest at the two things the other
// three are strong at: it carries no IMDb id and no coordinate. What it carries
// instead is a contributor standing in the same spot decades later with a
// camera — 53,126 of the 95,258 captures have a photograph of the place today.
//
// Matching therefore runs on title and year, which [[film-permits]] shows is the
// dangerous path, and geocoding does not run here at all. The addresses arrive
// as prose a model has read the place out of, and `location_submissions` allows
// lat/lng to be null so long as nothing claims to have geocoded them. A row that
// says "here is a place, nobody has located it yet" is honest; a row with a
// coordinate this ingest invented would not be.
//
// Licence: reelstreets.com states its own position at /how-to-submit — "All the
// screen captures depicted on this site remain copyright with the current title
// holders." So the captures are studio material by the site's own account, and
// the modern photographs are contributors' work with no licence granted to
// anyone. Both are recorded as links for a reviewer and neither is downloaded.

import { normalizeWorkTitle } from "./content-graph.mjs";

export const SOURCE = Object.freeze({
  kind: "reelstreets",
  site: "https://www.reelstreets.com",
  // No licence is published for the location text either. Recorded as absent
  // rather than guessed at, the same as moviemaps.
  license: "unstated",
  licenseUrl: null,
  attribution: "Filming location research from reelstreets.com (no licence stated)",
});

// Precisions worth putting in front of a reviewer. A region — "Japan", "London"
// — is not a place anyone can stand at, and source-evaluation.md already says
// why it must not become a pin: it would be the best-looking row in the queue
// and the least useful. `studio` is excluded because the scene depicts somewhere
// it was not shot, and `unknown` has no place to offer at all.
export const USABLE_PRECISION = Object.freeze(new Set(["building", "street", "area"]));

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// A year within one of the other. Release years disagree across sources by a
// year routinely — festival run in one, general release in the next — and
// demanding equality would reject correct matches.
export function yearsAgree(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null; // unknowable
  return Math.abs(a - b) <= 1;
}

// Which work this film is, or null with the reason it could not be decided.
//
// There is no IMDb id on either side of this join, so the whole burden falls on
// the title. The rule is: a title that matches exactly one work is that work; a
// title that matches several is decided by year, and if the year cannot decide
// it, NOTHING is returned. 6,029 of our works came from a scrape with no year,
// so "several candidates, no years" is common and it is precisely the case
// where a guess would attach one film's locations to another.
export function matchWork(film, worksByTitle) {
  const title = trimmed(film?.title);
  const key = normalizeWorkTitle(title);
  if (!key) return { work: null, reason: "no title" };

  const candidates = worksByTitle.get(key) ?? [];
  if (candidates.length === 0) return { work: null, reason: "no work with this title" };

  const year = Number.isInteger(film?.year) ? film.year : null;

  if (candidates.length === 1) {
    const only = candidates[0];
    // One candidate is not a free pass: if both sides state a year and they
    // disagree, this is a different film that happens to share a title.
    if (yearsAgree(year, only.year) === false) {
      return { work: null, reason: `year mismatch (${year} vs ${only.year})` };
    }
    return { work: only, reason: null };
  }

  const agreeing = candidates.filter((work) => yearsAgree(year, work.year) === true);
  if (agreeing.length === 1) return { work: agreeing[0], reason: null };

  return {
    work: null,
    reason: agreeing.length > 1
      ? `${agreeing.length} works share this title and year`
      : `${candidates.length} works share this title, year cannot separate them`,
  };
}

// One scraped film as a `works` row, or null if it cannot be identified.
//
// Unlike the MovieMaps import this carries a YEAR — ReelStreets states one for
// every film — which matters more here than it looks. Those works arrive
// separable: a later source with a title collision can be resolved by year,
// which is exactly what 6,029 yearless MovieMaps rows cannot do.
//
// What it has instead of an IMDb id is nothing, so there is no unique index to
// upsert against and duplicates cannot be pushed onto the database to sort out.
// The caller must check with matchWork() first; this only shapes the row.
export function filmToWork(film, normalise) {
  const title = trimmed(film?.title);
  const titleNorm = normalise(title);
  if (!title || !titleNorm) return null;

  return {
    imdb_id: null,
    // reelstreets.com is a film-locations site and files everything as a film;
    // it has no episode structure to read a series off, unlike MovieMaps.
    kind: "film",
    title,
    title_norm: titleNorm,
    year: Number.isInteger(film?.year) ? film.year : null,
    source: SOURCE.kind,
  };
}

// The modern photograph, as a link. Never the bytes: it is a contributor's work
// and no licence has been granted for it.
export function evidenceMedia(capture) {
  const media = [];
  if (trimmed(capture?.now_url)) {
    media.push({
      kind: "now",
      url: capture.now_url,
      taken: trimmed(capture.now_date) || null,
      by: trimmed(capture.now_by) || null,
      note: trimmed(capture.now_note) || null,
    });
  }
  if (trimmed(capture?.then_url)) {
    // The film capture. Studio copyright by the site's own statement, so it is
    // here to be looked at during review and for no other purpose.
    media.push({ kind: "then", url: capture.then_url });
  }
  return media.length > 0 ? media : null;
}

// One extracted capture as a submission, or null if it cannot carry its weight.
export function captureToSubmission(capture, { workId, film } = {}) {
  const place = trimmed(capture?.place);
  const caption = trimmed(capture?.caption);
  if (!workId || !place) return null;
  if (capture.kind !== "real") return null;
  if (!USABLE_PRECISION.has(capture.precision)) return null;

  // The caption is the evidence: the contributor's own sentence saying where
  // the shot was taken. The model only lifted the place out of it, so the
  // sentence — not the extraction — is what a reviewer should be shown.
  const sentence = caption && caption.length >= 10 ? caption : null;

  // Coordinates only when a contributor wrote them into the caption. Rare (50
  // of 95,258) and the only case here where a point is stated rather than
  // needing to be found.
  const hasPoint = Number.isFinite(capture.lat) && Number.isFinite(capture.lng);

  const alsoSeenIn = Array.isArray(capture.also_seen_in) ? capture.also_seen_in.filter(Boolean) : [];

  return {
    work_id: workId,
    place_name: place,
    area_hint: (film?.regions ?? [])[0] ?? null,

    source_kind: SOURCE.kind,
    // Film id and capture index: the record is one shot on one page, and a
    // reviewer must be able to get back to exactly that shot.
    source_record_id: `${film?.id}:${capture.index}`,
    source_title: trimmed(film?.title) || place,
    source_url: trimmed(film?.url) || SOURCE.site,
    source_sentence: sentence,
    source_license: SOURCE.license,
    source_license_url: SOURCE.licenseUrl,
    source_attribution: alsoSeenIn.length > 0
      // A spot used by several films is the signal that makes a walking route
      // possible, so it is surfaced rather than left in the harvest file.
      ? `${SOURCE.attribution}; also seen in ${alsoSeenIn.join(", ")}`
      : SOURCE.attribution,
    source_media: evidenceMedia(capture),

    lat: hasPoint ? capture.lat : null,
    lng: hasPoint ? capture.lng : null,
    geocode_source: hasPoint ? "reelstreets" : null,
    geocode_source_id: hasPoint ? `${film?.id}:${capture.index}` : null,
    geocode_license: hasPoint ? SOURCE.license : null,
    geocode_reason: hasPoint ? "contributor" : null,
  };
}

// One film's captures, deduped. A film revisits the same street across several
// shots, and (work_id, place_key) is the upsert key — duplicates would not
// error, the later row would silently overwrite the earlier one mid-batch.
export function dedupeByPlaceKey(rows) {
  // Every capture carries a film still, so "has imagery" is true of all of them
  // and cannot tell two rows apart. What differs — and what a reviewer actually
  // needs — is whether somebody went back and photographed the place today.
  const hasPhotoOfToday = (row) => Boolean(row?.source_media?.some((m) => m.kind === "now"));

  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = row.place_name.trim().toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || (!hasPhotoOfToday(existing) && hasPhotoOfToday(row))) byKey.set(key, row);
  }
  return [...byKey.values()];
}
