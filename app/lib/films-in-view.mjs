// Every film with a pin in the part of the map you are looking at.
//
// The map answers "what happened at THIS point" when a pin is clicked. It never answered
// the other half — **"what is in this view"** — and that is the question somebody actually
// asks when they pan across a city or zoom out over a district.
//
// It is a different list from the film chips beside it. Those are the works somebody
// SEARCHED for; this is what is on screen, and it changes as the map moves. Conflating the
// two is the "header contradicting the thing it heads" bug [[place-card]] fixed once
// already, when a count of the viewport sat above a list of the whole selection.
//
// **Grouped by film, not by pin**, because the same film is listed at many places — 1,304
// rows across 291 films in the owner's Los Angeles set — and a list repeating "Blade
// Runner" eleven times is not a list of films.

import { normalizeWorkTitle } from "./content-graph.mjs";

// How the list may be read. Posters when the reader is browsing and titles when they are
// looking for one, which are different tasks and not a matter of taste.
export const VIEW_MODES = Object.freeze({ posters: "posters", list: "list" });
export const DEFAULT_VIEW_MODE = VIEW_MODES.posters;

export function isViewMode(mode) {
  return Object.values(VIEW_MODES).includes(mode);
}

// One entry per work, carrying every place it holds in view.
//
// Keyed by `work_id` where there is one and by the normalised title otherwise: two sources
// can name the same film at one point without agreeing on an id, and a list showing it
// twice is the same failure as a map drawing it twice.
export function filmsInView(features) {
  const byWork = new Map();

  for (const feature of Array.isArray(features) ? features : []) {
    const props = feature?.properties ?? {};
    if (props.cluster) continue;
    const [lng, lat] = feature?.geometry?.coordinates ?? [];

    for (const film of Array.isArray(props.films) ? props.films : []) {
      const key = film?.work_id || normalizeWorkTitle(film?.title);
      if (!key) continue;
      if (!byWork.has(key)) {
        byWork.set(key, {
          work_id: film.work_id ?? null,
          title: film.title ?? null,
          year: film.year ?? null,
          kind: film.kind ?? null,
          places: [],
          // A film seen only on a backlot is a different answer from one seen on the
          // street, and the list says which before the reader walks anywhere.
          on_a_lot_only: true,
        });
      }
      const entry = byWork.get(key);
      entry.places.push({
        name: props.name ?? film.place_name ?? null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        studio_lot: props.studio_lot ?? null,
      });
      if (!props.depicts_elsewhere) entry.on_a_lot_only = false;
    }
  }

  return [...byWork.values()]
    .map((entry) => ({ ...entry, place_count: entry.places.length }))
    // Most places first — the film this part of the map is really about — then the title,
    // so the list does not reshuffle itself as the map is nudged.
    .sort((a, b) => b.place_count - a.place_count
      || String(a.title ?? "").localeCompare(String(b.title ?? "")));
}

// What the panel says above the list. Films and places are two different numbers and the
// panel has printed only one of them before: "we hold little here" and "you are zoomed too
// far out" look identical without both.
export function filmsInViewLabel(films) {
  const list = Array.isArray(films) ? films : [];
  if (list.length === 0) return "No films in view";
  const places = list.reduce((sum, film) => sum + film.place_count, 0);
  return `${list.length} film${list.length === 1 ? "" : "s"}`
    + ` · ${places} place${places === 1 ? "" : "s"} in view`;
}
