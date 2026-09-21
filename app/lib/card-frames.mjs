// A frame the place card matched, kept on the rows it is about (#198).
//
// /api/film-image runs two vision calls, a Wikidata query and a TMDB query to decide
// which film frame shows a place, and until now it wrote the answer nowhere but a CDN
// entry: evicted, per-region, and invisible to everything else that reads frames. The
// batch stage's table, `place_frames`, sat empty beside it because it keys on our uuids
// and the card works in Wikidata Q-ids. `works.wikidata_id` and `places.wikidata_id` are
// both unique, so the join is exact; this module is what goes either side of it.
//
// ---------------------------------------------------------------------------------------
//
// **Only where the graph already holds the link.** A frame on `place_frames` is a claim
// that this work was shot at this place. The card only asks about pairs Wikidata states
// (P915), but a pair in Wikidata is not a link in our graph, and writing a frame for one
// would assert the link by the back door. So a row is written when both rows exist AND
// `work_place_links` joins them; otherwise the card still answers live, as it did.
//
// **Never over what is already there.** The batch stage and the card verify differently.
// Whichever answered first stays; the write is an insert that yields on conflict.
//
// **Versioned.** Bumping the card's matcher version is how a changed matcher disowns its
// old answers, and a stored row that ignored the version would survive every bump.

import { tmdbUrlForSurface } from "./tmdb-images.mjs";

export const CARD_METHOD = "film_image";

// The database refuses shorter; checking here means a refusal is a decision, not a log line.
const MIN_EVIDENCE = 10;
const MAX_ALSO = 2;
const TMDB_PATH = /^\/[A-Za-z0-9._-]+$/;

function usableEvidence(text) {
  const value = typeof text === "string" ? text.trim() : "";
  return value.length >= MIN_EVIDENCE ? value : null;
}

// Whether a resolved pair already carries an answer this matcher may serve. A batch row
// is unversioned and always counts; a card row counts only for the version that made it.
export function storedFrameIsCurrent(resolved, { matcherVersion }) {
  if (!resolved || !TMDB_PATH.test(resolved.file_path ?? "")) return false;
  if (!usableEvidence(resolved.evidence)) return false;
  if (resolved.method === CARD_METHOD) return resolved.matcher_version === matcherVersion;
  return true;
}

// A stored row → the payload the card already reads, so the client cannot tell a
// remembered answer from a fresh one except by the `stored` flag and the speed.
export function payloadFromStored(resolved, { tmdbId }) {
  const sourceUrl = `https://www.themoviedb.org/movie/${tmdbId}/images/backdrops`;
  const also = Array.isArray(resolved.also) ? resolved.also : [];
  const entries = [
    { file_path: resolved.file_path, evidence: resolved.evidence, location_type: resolved.location_type },
    ...also,
  ].filter((entry) => TMDB_PATH.test(entry?.file_path ?? "") && usableEvidence(entry?.evidence));

  const frames = entries.map((entry, index) => ({
    image_url: tmdbUrlForSurface(entry.file_path, index === 0 ? "sheetHero" : "galleryFrame"),
    source_url: sourceUrl,
    location_name: resolved.place_name ?? null,
    location_type: entry.location_type ?? "other",
    description: usableEvidence(entry.evidence),
    match_confidence: "high",
    match_method: "openai_vision",
  }));

  return {
    image_url: frames[0]?.image_url ?? null,
    source_url: sourceUrl,
    frames,
    match_confidence: "high",
    match_method: "openai_vision",
    stored: true,
  };
}

// Verified frames from a live match → the row to write, or null with the reason it is
// not written. `frames` are `{ file_path, description, location_type }`, first = primary.
export function cardFrameRow(resolved, frames, { matcherVersion }) {
  if (!resolved?.work_id || !resolved?.place_id) return { row: null, reason: "not_in_graph" };
  if (!resolved.linked) return { row: null, reason: "not_linked" };
  if (resolved.file_path) return { row: null, reason: "already_recorded" };

  const usable = (Array.isArray(frames) ? frames : [])
    .filter((frame) => TMDB_PATH.test(frame?.file_path ?? "") && usableEvidence(frame?.description));
  if (usable.length === 0) return { row: null, reason: "no_evidence" };

  const [primary, ...rest] = usable;
  return {
    row: {
      work_id: resolved.work_id,
      place_id: resolved.place_id,
      file_path: primary.file_path,
      evidence: usableEvidence(primary.description),
      location_type: primary.location_type ?? null,
      method: CARD_METHOD,
      matcher_version: matcherVersion,
      also: rest.slice(0, MAX_ALSO).map((frame) => ({
        file_path: frame.file_path,
        evidence: usableEvidence(frame.description),
        location_type: frame.location_type ?? null,
      })),
    },
    reason: null,
  };
}
