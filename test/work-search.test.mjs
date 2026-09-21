import assert from "node:assert/strict";
import test from "node:test";

import { createSearchHandler } from "../app/api/search/route.js";
import {
  formatSuggestions,
  matchRange,
  MAX_SUGGESTIONS,
  prepareSearchQuery,
  holdsTheTitle,
} from "../app/lib/work-search.mjs";

const highlight = (title, query) => {
  const range = matchRange(title, query);
  return range ? `${title.slice(0, range.start)}[${title.slice(range.start, range.end)}]${title.slice(range.end)}` : null;
};

test("prepareSearchQuery folds input the same way title_norm was built", () => {
  // The import pipeline normalised titles this way, so the query must match it or
  // "amelie" would never find "Amélie".
  assert.equal(prepareSearchQuery("Sky").query, "sky");
  assert.equal(prepareSearchQuery("  The  Matrix!! ").query, "the matrix");
  assert.equal(prepareSearchQuery("Amélie").query, "amelie");
});

test("prepareSearchQuery returns null when there is nothing to ask the database", () => {
  // Still typing is not an error — and not a reason to hit the database.
  for (const empty of ["", "   ", "!!!", null, undefined]) {
    assert.equal(prepareSearchQuery(empty), null);
  }
});

test("prepareSearchQuery clamps the limit", () => {
  assert.equal(prepareSearchQuery("sky", { limit: 500 }).limit, 25);
  assert.equal(prepareSearchQuery("sky", { limit: 0 }).limit, MAX_SUGGESTIONS);
  assert.equal(prepareSearchQuery("sky", { limit: "junk" }).limit, MAX_SUGGESTIONS);
});

test("matchRange highlights the characters actually typed, at the start of a title", () => {
  assert.equal(highlight("Skyfall", "sky"), "[Sky]fall");
  assert.equal(highlight("Notting Hill", "notting hill"), "[Notting Hill]");
});

test("matchRange highlights a match that starts a later word", () => {
  // IMDb does this too: typing "pot" should point at Potter, not at nothing.
  assert.equal(highlight("Harry Potter and the Philosopher's Stone", "pot"), "Harry [Pot]ter and the Philosopher's Stone");
  assert.equal(highlight("The Crown", "crown"), "The [Crown]");
});

test("matchRange stays correct when the title carries accents or punctuation", () => {
  // The offsets must land on the ORIGINAL characters, not the folded ones.
  assert.equal(highlight("Amélie", "amelie"), "[Amélie]");
  assert.equal(highlight("WALL·E", "wall"), "[WALL]·E");
});

test("matchRange returns null rather than highlighting the wrong characters", () => {
  // A fuzzy hit (typo) has no honest range to point at.
  assert.equal(matchRange("Skyfall", "skfall"), null);
  assert.equal(matchRange("Skyfall", ""), null);
  assert.equal(matchRange(null, "sky"), null);
});

test("formatSuggestions shapes a row for the dropdown", () => {
  const [row] = formatSuggestions([{
    work_id: "w1", title: "Skyfall", kind: "film", year: 2012,
    poster_path: "/abc.jpg", place_count: 16, rank: 3,
  }], "sky");

  assert.equal(row.title, "Skyfall");
  assert.equal(row.kind_label, "Film");
  assert.equal(row.year, 2012);
  assert.equal(row.place_count, 16);
  // 34 px in the dropdown, so w92 — not the w185 every poster used to get (#198).
  assert.equal(row.poster_thumb_url, "https://image.tmdb.org/t/p/w92/abc.jpg");
  assert.deepEqual(row.match, { start: 0, end: 3 });
});

test("formatSuggestions tolerates a work with no poster or year", () => {
  const [row] = formatSuggestions([{ work_id: "w1", title: "A Book", kind: "book" }], "a");
  assert.equal(row.poster_thumb_url, null);
  assert.equal(row.year, null);
  assert.equal(row.place_count, 0);
  // Not a uuid, so there is no page to point at — and a link to nowhere is worse than
  // no link. The dropdown renders the row without its card.
  assert.equal(row.path, null);
});

test("a suggestion carries the address of the film's own page", () => {
  // The search now has somewhere to lead: the card shipped in #146. The path is built
  // by the same function the page parses, so a title corrected later cannot break a
  // link already sent.
  const [row] = formatSuggestions([{
    work_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    title: "Skyfall", kind: "film", year: 2012,
  }], "sky");
  assert.equal(row.path, "/work/skyfall-2012--3f2504e0-4f89-41d3-9a0c-0305e82c3301");
});

// --- route -------------------------------------------------------------------

const searchRequest = (q) =>
  new Request(`http://localhost/api/search?${new URLSearchParams(q === undefined ? {} : { q })}`);

function handlerWith(overrides = {}) {
  return createSearchHandler({
    env: {},
    createReader: overrides.createReader ?? (() => overrides.reader ?? {
      search: async () => [{
        work_id: "w1", title: "Skyfall", kind: "film", year: 2012,
        poster_path: "/abc.jpg", place_count: 16, rank: 3,
      }],
    }),
    logError: () => {},
  });
}

test("search answers an empty query without touching the database", async () => {
  let called = false;
  const handler = handlerWith({ reader: { search: async () => { called = true; return []; } } });
  const body = await (await handler(searchRequest(""))).json();
  assert.deepEqual(body.suggestions, []);
  assert.equal(called, false);
});

test("search passes the normalised query and returns suggestions", async () => {
  let seen = null;
  const handler = handlerWith({
    reader: {
      search: async (args) => {
        seen = args;
        return [{ work_id: "w1", title: "Skyfall", kind: "film", year: 2012, place_count: 16 }];
      },
    },
  });
  const body = await (await handler(searchRequest("Sky"))).json();
  assert.equal(seen.query, "sky");
  assert.equal(body.suggestions[0].title, "Skyfall");
  assert.deepEqual(body.suggestions[0].match, { start: 0, end: 3 });
  assert.equal(body.held, true);
});

test("search says so when its rows only look like what was typed", async () => {
  const handler = handlerWith({
    reader: {
      search: async () => [
        { work_id: "a", title: "The Sacred Spirit", kind: "film", year: 2021 },
        { work_id: "b", title: "Cast Away", kind: "film", year: 2000 },
      ],
    },
  });
  const body = await (await handler(searchRequest("Spirited Away"))).json();
  assert.equal(body.suggestions.length, 2);
  assert.equal(body.held, false);
});

test("search reports a graph failure with its cause", async () => {
  const handler = handlerWith({
    reader: { search: async () => { throw new Error("Invalid API key"); } },
  });
  const response = await handler(searchRequest("sky"));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.reason, "graph_auth_rejected");
});

test("search returns 503 when the graph is not configured", async () => {
  const handler = handlerWith({ createReader: () => null });
  assert.equal((await handler(searchRequest("sky"))).status, 503);
});

// ---------- whether we hold what was typed ----------

test("seven look-alikes are not the film that was asked for", () => {
  // /api/search?q=Spirited Away on production, 21.09. The film is not in our catalogue;
  // every row is a neighbouring spelling, and none of them carries a match.
  const query = prepareSearchQuery("Spirited Away").query;
  const rows = formatSuggestions([
    { work_id: "a", title: "The Sacred Spirit", kind: "film", year: 2021 },
    { work_id: "b", title: "Spirit Glitch", kind: "film", year: 2019 },
    { work_id: "c", title: "Cast Away", kind: "film", year: 2000 },
    { work_id: "d", title: "Suspiria", kind: "film", year: 2018 },
  ], query);
  assert.equal(holdsTheTitle(rows), false);
});

test("a title we hold is held, however it is typed", () => {
  const held = (typed, title) => holdsTheTitle(
    formatSuggestions([{ work_id: "x", title, kind: "film", year: 2001 }], prepareSearchQuery(typed).query),
  );
  assert.equal(held("Skyfall", "Skyfall"), true);
  assert.equal(held("skyfal", "Skyfall"), true);          // still typing
  assert.equal(held("amelie", "Amélie"), true);           // accents fold
  assert.equal(held("matrix", "The Matrix"), true);       // a word inside the title
  assert.equal(held("Spirited Away", "Cast Away"), false);
});

test("no rows at all holds nothing", () => {
  assert.equal(holdsTheTitle([]), false);
  assert.equal(holdsTheTitle(null), false);
  assert.equal(holdsTheTitle(undefined), false);
});
