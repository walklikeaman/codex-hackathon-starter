// Filming locations from moviemaps.org — pure helpers for the ingest.
//
// This is the third kind of submission and it sits between the other two. A permit
// record is a primary document from the authority that issued it. A Wikipedia sentence
// is prose that has to be read. MovieMaps is neither: it is a contributor-maintained
// gazetteer where someone identified a place, put a pin on it, and often credited where
// they got it. That makes it strong on GEOMETRY and weak on AUTHORITY, and the two have
// to be recorded separately rather than averaged into a confidence score.
//
// Strong on geometry, because the pin is the contribution. The coordinates come out of
// the map payload the site hands its own JavaScript, alongside city, country and a
// Street View camera pose — nothing here is geocoded by us and nothing is inferred from
// a name, so `geocode_reason` is "contributor" and means it.
//
// Weak on authority, because moviemaps.org publishes no terms, no licence page and no
// copyright statement (checked 2026-08-05: /about, /terms, /legal, /copyright all 404,
// and the homepage says nothing). So `source_license` is "unstated" — not a guess at a
// permissive one, and not the CC BY-SA default this table deliberately dropped. A
// moviemaps row is a LEAD: strong enough to put in front of a reviewer, not licensed
// for its text or its images to be republished.

import { normalizeWorkTitle } from "./content-graph.mjs";
import { coordinateOrNull } from "./numbers.mjs";

export const SOURCE = Object.freeze({
  kind: "moviemaps",
  site: "https://moviemaps.org",
  // No licence is published. Recording that as a fact is the point: a reviewer can
  // filter on it, and nobody can later mistake silence for permission.
  license: "unstated",
  licenseUrl: null,
  attribution: "Filming location data from moviemaps.org (no licence stated)",
});

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// An IMDb title id, or null. The ingest matches on this and nothing else, so a
// half-recognised id is worse than no id: it would attach a film's locations to
// whatever work happened to hold the malformed string.
export function imdbIdOf(movie) {
  const id = trimmed(movie?.external?.imdb_id);
  return /^tt\d{7,}$/.test(id) ? id : null;
}

// One scraped film as a `works` row, or null if it cannot be identified.
//
// Three things are worth saying about what this does NOT fill in.
//
// `year` is null. MovieMaps does not publish a year anywhere on a film page --
// not in the heading, not in the title tag, not in the map payload. Guessing one
// from the IMDb id is not possible and inferring it from the poster is absurd, so
// the column stays null and says so. Dedup does not suffer: these rows all carry
// an IMDb id, which is what workNaturalKey prefers anyway.
//
// `kind` is decided by whether the page links to /episodes/. MovieMaps files
// series under /movies/ like everything else and never labels them, and this is
// the only signal the page carries. Checked against the twelve works we already
// held: it puts Sherlock and The Crown in `series` and the other ten in `film`,
// agreeing with every one.
//
// `wikidata_id` and `tmdb_id` stay null because a scrape is not where those come
// from. `source` records that this row was scraped rather than curated.
export function movieToWork(movie) {
  const imdbId = imdbIdOf(movie);
  const title = trimmed(movie?.title);
  const titleNorm = normalizeWorkTitle(title);
  if (!imdbId || !title || !titleNorm) return null;

  return {
    imdb_id: imdbId,
    kind: movie.kind === "series" ? "series" : "film",
    title,
    title_norm: titleNorm,
    year: null,
    source: SOURCE.kind,
  };
}

// The name to pin. MovieMaps gives a real-world name ("Buckaroo Tavern") and often the
// fictional one it plays ("The Cullen's House"); the place is the real one. The
// fictional name belongs in the scene text, where a reader can see it is fictional.
export function placeNameOf(location) {
  return trimmed(location?.location_name) || trimmed(location?.name) || null;
}

// What this row offers a reviewer as evidence, in one sentence, built only from text
// MovieMaps actually wrote. Returns null rather than manufacturing a sentence — the
// schema was written to accept that, and an invented sentence outranks a real absence
// in every query that looks for evidence.
export function evidenceSentence({ scene, asName, note, placeName = null }) {
  const parts = [];
  const fictional = trimmed(asName);
  // MovieMaps sometimes fills the fictional name with the real one — "The Ritz" plays
  // The Ritz. Saying so is noise, and noise in an evidence field costs a reviewer the
  // same attention as evidence.
  if (fictional && fictional.toLowerCase() !== trimmed(placeName).toLowerCase()) {
    parts.push(`Appears as "${fictional}".`);
  }
  // Scene and note are separate fields on the page and are frequently the same text.
  // Joined blindly they produce a paragraph that says everything twice.
  for (const candidate of [trimmed(scene), trimmed(note)]) {
    if (candidate && !parts.includes(candidate)) parts.push(candidate);
  }
  const sentence = parts.join(" ").trim();
  return sentence.length >= 10 ? sentence : null;
}

// Frames as links for review. Never bytes, never the product gallery — see the comment
// on location_submissions.source_media.
export function evidenceMedia(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const media = frames
    .filter((frame) => trimmed(frame?.full))
    .map((frame) => ({ page: frame.page ?? null, thumb: frame.thumb ?? null, full: frame.full }));
  return media.length > 0 ? media : null;
}

// One movie-page location (plus whatever its own location page added) as a submission.
//
// Returns null when the row cannot carry its own weight: no name, no coordinates, or no
// MovieMaps id. Each of those is a row that would arrive in the queue looking exactly
// as reviewable as a good one.
export function locationToSubmission(location, { workId, detail = null } = {}) {
  const placeName = placeNameOf(location);
  const recordId = trimmed(location?.location_id) || trimmed(location?.id);
  const point = coordinateOrNull(location?.lat, location?.lng);
  if (!placeName || !recordId || !point || !workId) return null;

  const url = trimmed(location?.location_url) || `${SOURCE.site}/locations/${recordId}`;
  // The credited source is the contributor's own citation ("Source: Jason Soprovich").
  // It is the single best signal of how much to trust the row, so it is surfaced in
  // the attribution rather than buried.
  const credited = trimmed(location?.source?.name);

  return {
    work_id: workId,
    place_name: placeName,
    // The address MovieMaps holds is on the location page, not the movie page, so it
    // is only present when the detail index has been loaded. City is the fallback.
    area_hint: trimmed(detail?.address) || trimmed(location?.city?.name) || null,

    source_kind: SOURCE.kind,
    source_record_id: recordId,
    source_title: placeName,
    source_url: url,
    source_sentence: evidenceSentence({
      scene: detail?.scene,
      asName: location?.as_name ?? detail?.as_name,
      note: location?.note ?? detail?.note,
      placeName,
    }),
    source_license: SOURCE.license,
    source_license_url: SOURCE.licenseUrl,
    source_attribution: credited
      ? `${SOURCE.attribution}; identified by ${credited}`
      : SOURCE.attribution,
    source_media: evidenceMedia(detail?.frames ?? location?.frames),

    lat: point.lat,
    lng: point.lng,
    // A contributor placed this pin. That is neither our Wikidata lookup nor a model's
    // guess, and a later reader must be able to tell which of the three it was.
    geocode_source: "moviemaps",
    geocode_source_id: recordId,
    geocode_license: SOURCE.license,
    geocode_reason: "contributor",
  };
}

// One film's locations, deduped. MovieMaps lists a place once per film, but a place can
// appear twice under different ids when contributors entered it separately, and the
// upsert key is (work_id, place_key) — so a duplicate would not fail, it would make the
// second row silently overwrite the first mid-batch.
export function dedupeByPlaceKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = row.place_name.trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}
