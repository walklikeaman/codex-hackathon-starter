// The filters, in the address bar (#201).
//
// Six controls can narrow this map to nothing, and until now the URL carried only `lat`,
// `lng` and `z`. Two things followed from that, both bad:
//
//   * **A reader who hid their own map could not get back**, except by hunting each control
//     across a panel they had to scroll. There was no reset and no undo.
//   * **The one view worth sending to somebody — a filtered one — could not be sent.**
//     "Look at these, the films we both like, in this part of Los Angeles" was a sentence
//     the product could not express, while the unfiltered map it does not mean was a link.
//
// ---------------------------------------------------------------------------------------
//
// **Only what differs from the default is written.** A URL that spells out every default is
// noise: it makes a fresh map look configured, it breaks the eye's ability to spot what is
// actually on, and it grows every time a filter is added. An absent parameter means "the
// default", now and after the next release.
//
// **A value we do not understand falls back rather than blanking the map.** Somebody edits
// a URL by hand, a link is truncated by a chat client, a parameter is renamed in a later
// version — in every case the honest answer is the default and a working map, not an empty
// one with no explanation. This is the same rule `readStoredLayerId` already follows.

import { clampImdb, clampMine, NO_MINIMUM } from "./library-view.mjs";

export const FILTER_DEFAULTS = Object.freeze({
  mineOnly: false,
  minRating: NO_MINIMUM,
  minImdb: NO_MINIMUM,
  kinds: [],          // every kind
  workId: "",         // the whole library
  candidates: true,   // the queue is drawn
  studioLots: true,   // lots are drawn
  graphLayer: true,   // the grounded layer is drawn
});

const KINDS = ["film", "series", "book"];

// The parameter names. Short, because they ride in a link somebody pastes into a message,
// and stable, because a renamed parameter silently drops the filter it carried.
const KEYS = Object.freeze({
  mineOnly: "mine",
  minRating: "stars",
  minImdb: "imdb",
  kinds: "kind",
  workId: "work",
  candidates: "queue",
  studioLots: "lots",
  graphLayer: "graph",
});

function parseBoolean(value, fallback) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

function parseKinds(value) {
  if (typeof value !== "string" || !value) return FILTER_DEFAULTS.kinds;
  const kinds = value.split(",").map((kind) => kind.trim()).filter((kind) => KINDS.includes(kind));
  // Every kind and no kind are the same map, and `[]` is how the app already says "every".
  // Writing all three back would make the reset button claim a filter is on.
  return kinds.length === 0 || kinds.length === KINDS.length ? FILTER_DEFAULTS.kinds : kinds;
}

export function filtersFromParams(params) {
  const get = (key) => (typeof params?.get === "function" ? params.get(key) : params?.[key]) ?? null;

  return {
    mineOnly: parseBoolean(get(KEYS.mineOnly), FILTER_DEFAULTS.mineOnly),
    minRating: clampMine(get(KEYS.minRating)),
    minImdb: clampImdb(get(KEYS.minImdb)),
    kinds: parseKinds(get(KEYS.kinds)),
    // A work id is an opaque string from our own database; anything unrecognisable is the
    // whole library rather than an empty map.
    workId: typeof get(KEYS.workId) === "string" ? get(KEYS.workId).slice(0, 100) : FILTER_DEFAULTS.workId,
    candidates: parseBoolean(get(KEYS.candidates), FILTER_DEFAULTS.candidates),
    studioLots: parseBoolean(get(KEYS.studioLots), FILTER_DEFAULTS.studioLots),
    graphLayer: parseBoolean(get(KEYS.graphLayer), FILTER_DEFAULTS.graphLayer),
  };
}

// Which filters are not at their default. This is what the reset button counts, and it is
// derived rather than tracked: a count kept alongside the state is a count that drifts from
// it the first time somebody adds a filter and forgets the counter.
export function activeFilters(filters) {
  const active = [];
  const state = { ...FILTER_DEFAULTS, ...(filters ?? {}) };

  if (state.mineOnly !== FILTER_DEFAULTS.mineOnly) active.push("mineOnly");
  if (Number(state.minRating) > NO_MINIMUM) active.push("minRating");
  if (Number(state.minImdb) > NO_MINIMUM) active.push("minImdb");
  if (Array.isArray(state.kinds) && state.kinds.length > 0 && state.kinds.length < KINDS.length) {
    active.push("kinds");
  }
  if (state.workId) active.push("workId");
  if (state.candidates !== FILTER_DEFAULTS.candidates) active.push("candidates");
  if (state.studioLots !== FILTER_DEFAULTS.studioLots) active.push("studioLots");
  if (state.graphLayer !== FILTER_DEFAULTS.graphLayer) active.push("graphLayer");

  return active;
}

export function activeFilterCount(filters) {
  return activeFilters(filters).length;
}

// The filters as query parameters, defaults omitted. Written onto an existing
// `URLSearchParams` so the viewport parameters already there survive — the place and the
// filters are two different questions about one map and neither may erase the other.
export function writeFilterParams(params, filters) {
  const next = new URLSearchParams(params ?? "");
  const state = { ...FILTER_DEFAULTS, ...(filters ?? {}) };
  const active = new Set(activeFilters(state));

  const put = (key, value, on) => {
    if (on) next.set(key, value);
    else next.delete(key);
  };

  put(KEYS.mineOnly, "1", active.has("mineOnly"));
  put(KEYS.minRating, String(state.minRating), active.has("minRating"));
  put(KEYS.minImdb, String(state.minImdb), active.has("minImdb"));
  put(KEYS.kinds, Array.isArray(state.kinds) ? state.kinds.join(",") : "", active.has("kinds"));
  put(KEYS.workId, String(state.workId), active.has("workId"));
  put(KEYS.candidates, "0", active.has("candidates"));
  put(KEYS.studioLots, "0", active.has("studioLots"));
  put(KEYS.graphLayer, "0", active.has("graphLayer"));

  return next;
}

export { KEYS as FILTER_KEYS };
