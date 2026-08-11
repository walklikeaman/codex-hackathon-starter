// Filming locations from movie-locations.com — pure helpers for the ingest.
//
// The fifth kind of submission and the cheapest to import, because the site
// writes its captions in a shape a regex can read:
//
//     "Vertigo filming location: Scottie's home: 900 Lombard Street, and Coit Tower"
//      ^ film                    ^ scene         ^ place
//
// So unlike [[reelstreets-source]] there is no model call anywhere in this
// pipeline. That is worth stating plainly rather than celebrating: a regex is
// more predictable than a model, not more self-evidently right, which is why
// the caption still travels with every row as the evidence a reviewer checks.
//
// What it does not have, verified across four films: no coordinates — the
// numbers that look like them are telephone numbers — and no IMDb ids. So
// matching is title and year, and geocoding is somebody else's pass.
//
// Every location carries a photograph of the place as the site shot it. Not a
// film still: this site has none, and the distinction matters because a still
// is the studio's and a location photograph is the site's. Neither is ours, so
// both travel as links.

import { normalizeWorkTitle } from "./content-graph.mjs";
import { matchWork as matchByTitleAndYear, yearsAgree } from "./reelstreets-source.mjs";

export const SOURCE = Object.freeze({
  kind: "movielocations",
  site: "https://movie-locations.com",
  // No terms page, no copyright statement, nothing on the homepage — the same
  // silence as moviemaps.org, recorded rather than interpreted.
  license: "unstated",
  licenseUrl: null,
  attribution: "Filming location research from movie-locations.com (no licence stated)",
});

// This site prints the alternative release title in brackets — "Harry Potter
// And The Philosopher's Stone (Harry Potter And The Sorcerer's Stone)" — and
// the bracket is part of the heading, not of the film. Matched literally it
// misses the work we already hold and proposes creating a second one, which is
// exactly the duplicate the works ingest exists to avoid.
export function titleVariants(title) {
  const full = (title ?? "").trim();
  if (!full) return [];
  const withoutBracket = full.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return withoutBracket && withoutBracket !== full ? [full, withoutBracket] : [full];
}

// Otherwise the matcher is [[reelstreets-source]]'s, unchanged. Both sources
// arrive with a title and a year and no external id, so the same refusals
// apply: one candidate whose year disagrees is a different film, several
// candidates are decided by year, and a year that cannot decide decides
// nothing. Variants are tried in order and the FIRST hit wins — the bracketed
// form is more specific, so trying it first cannot mask a better match.
export function matchWork(film, worksByTitle) {
  let last = { work: null, reason: "no title" };
  for (const title of titleVariants(film?.title)) {
    last = matchByTitleAndYear({ ...film, title }, worksByTitle);
    if (last.work) return last;
  }
  return last;
}
export { yearsAgree };

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

// A place long enough to be a description rather than an address. The site
// writes generously — "900 Lombard Street, and Coit Tower on the horizon, San
// Francisco" — and the tail is context a reviewer wants, so this is a ceiling
// against runaway captions rather than a style rule.
const MAX_PLACE = 200;

export function filmToWork(film) {
  const title = trimmed(film?.title);
  const titleNorm = normalizeWorkTitle(title);
  if (!title || !titleNorm) return null;

  return {
    imdb_id: null,
    // The site indexes films, and its few TV entries are filed the same way with
    // nothing on the page to tell them apart. Calling everything a film is the
    // claim the page actually supports.
    kind: "film",
    title,
    title_norm: titleNorm,
    year: Number.isInteger(film?.year) ? film.year : null,
    source: SOURCE.kind,
  };
}

// The photograph, as a link. The site shot it; no licence is stated for it.
export function evidenceMedia(location) {
  const url = trimmed(location?.photo_url);
  if (!url) return null;
  return [{ kind: "location_photo", url, by: "movie-locations.com" }];
}

export function locationToSubmission(location, { workId, film } = {}) {
  const place = trimmed(location?.place);
  const caption = trimmed(location?.caption);
  if (!workId || !place || place.length > MAX_PLACE) return null;
  // The caption is what the schema demands for this kind, and without it the
  // row cannot be checked against anything.
  if (caption.length < 10) return null;

  const scene = trimmed(location?.scene);

  return {
    work_id: workId,
    place_name: place,
    area_hint: (film?.regions ?? [])[0] ?? null,

    source_kind: SOURCE.kind,
    // Film slug and caption index: back to the one photograph, not the page.
    source_record_id: `${film?.id}:${location.index}`,
    source_title: trimmed(film?.title) || place,
    source_url: trimmed(film?.url) || SOURCE.site,
    source_sentence: caption,
    source_license: SOURCE.license,
    source_license_url: SOURCE.licenseUrl,
    source_attribution: scene
      // The scene is the reason this place is on a map at all, so it is carried
      // where a reviewer will read it rather than left in the harvest file.
      ? `${SOURCE.attribution}; scene: ${scene}`
      : SOURCE.attribution,
    source_media: evidenceMedia(location),

    // No coordinate exists anywhere on this site, and inventing one inside an
    // import would bury the guess where nobody looks.
    lat: null,
    lng: null,
    geocode_source: null,
    geocode_source_id: null,
    geocode_license: null,
    geocode_reason: null,
  };
}

// One film's locations, deduped on the upsert key. The harvester already drops
// repeats of an identical place within a page; this catches the ones that differ
// only in case or spacing, which the generated place_key would collapse anyway —
// silently overwriting rather than erroring.
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
