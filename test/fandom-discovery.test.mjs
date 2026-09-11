import assert from "node:assert/strict";
import test from "node:test";

import { chunk, classifyPage, pairsQuery, rankWikis, splitFandomId } from "../app/lib/fandom-discovery.mjs";
import { toProseSubmission } from "../app/lib/fandom-source.mjs";

// Wikidata's P6262 is `wiki:Page_Title`, and the values are real ones taken from the
// endpoint on 11.09.
test("a Fandom article id splits into a wiki and a page", () => {
  assert.deepEqual(splitFandomId("simpsons:Future-Drama"), { wiki: "simpsons", page: "Future-Drama" });
  // Underscores are the URL form; the API wants spaces.
  assert.deepEqual(splitFandomId("jamesbond:Skyfall_(film)"), { wiki: "jamesbond", page: "Skyfall (film)" });
  // A page title may itself contain a colon — only the FIRST one separates.
  assert.deepEqual(
    splitFandomId("memory-beta:Dr._Strangelove_or:_How_I_Learned"),
    { wiki: "memory-beta", page: "Dr. Strangelove or: How I Learned" },
  );
});

test("a language-prefixed wiki is skipped rather than guessed at", () => {
  // `de.ghibli` and `no.norske-dubber` are real values from the endpoint. They are separate
  // wikis with their own licences, and the section headings this parser looks for are
  // English — so they are refused here rather than fetched and silently yielding nothing.
  assert.equal(splitFandomId("de.ghibli:Das_wandelnde_Schloss"), null);
  assert.equal(splitFandomId("no.norske-dubber:Det_levende_slottet"), null);
  assert.equal(splitFandomId("nocolon"), null);
  assert.equal(splitFandomId(":leading"), null);
  assert.equal(splitFandomId("wiki:"), null);
});

test("wikis are ranked by OUR overlap, not by their size", () => {
  // The whole point of the pass. The biggest wikis in the join are not the ones our
  // catalogue overlaps, and reading down a size-ordered list spends the budget in the
  // wrong place.
  const pairs = [
    { wiki: "simpsons", page: "A", imdb: "tt1" },
    { wiki: "simpsons", page: "B", imdb: "tt2" },
    { wiki: "huge-wiki", page: "C", imdb: "tt9" },
    { wiki: "lotr", page: "D", imdb: "tt1" },
  ];
  const ranked = rankWikis(pairs, { heldImdbIds: new Set(["tt1", "tt2"]) });
  assert.deepEqual(ranked.map((w) => [w.wiki, w.works]), [["simpsons", 2], ["lotr", 1]]);
  // tt9 is not in the catalogue, so huge-wiki scores nothing however large it is.
  assert.equal(ranked.find((w) => w.wiki === "huge-wiki"), undefined);
});

test("a page is classified by what it would cost to read", () => {
  // `prose` is not a failure, it is the measurement the report exists to produce: how many
  // pages a model pass would be buying, counted before anybody spends on it.
  assert.equal(classifyPage({ section: null, rows: [] }), "no_section");
  assert.equal(classifyPage({ section: { text: "{| wikitable" }, rows: [{}] }), "table");
  assert.equal(classifyPage({ section: { text: "*Somerset House" }, rows: [{}] }), "list");
  assert.equal(classifyPage({ section: { text: "Shooting began in London." }, rows: [] }), "prose");
});

test("the query asks about our ids only, and refuses anything that is not one", () => {
  // Paging the whole property answered 502 on the second page: an OFFSET over 206,443
  // statements re-sorts the lot every time. This asks about what we hold instead.
  const query = pairsQuery(["tt0111161", "tt0113277", "nonsense", "", null]);
  assert.match(query, /VALUES \?imdb \{ "tt0111161" "tt0113277" \}/);
  assert.ok(!query.includes("nonsense"), "a non-id must not reach the endpoint");
  assert.ok(!query.includes("OFFSET"));
});

test("the ids are chunked, because one query for six thousand is the query that 502s", () => {
  const ids = Array.from({ length: 950 }, (_, i) => `tt${i}`);
  const batches = chunk(ids, 400);
  assert.deepEqual(batches.map((b) => b.length), [400, 400, 150]);
  assert.equal(batches.flat().length, ids.length);
  assert.deepEqual(chunk([], 400), []);
});

// ---------- what a prose row becomes ----------

test("a prose row stores the model's own quote, not a generated sentence", () => {
  // The verbatim gate is the reason a model is allowed near this at all, and the sentence
  // stored is the one a reader finds on the linked revision.
  const quote = "Hashima Island was used for the exterior of the villain's lair.";
  const row = toProseSubmission(
    { place_name: "Hashima Island", area_hint: "Japan", source_sentence: quote },
    { work: { id: "w1", title: "Skyfall" }, wiki: "jamesbond", page: "Skyfall (film)", revid: 42, licence: "CC-BY-SA" },
  );
  assert.equal(row.source_sentence, quote);
  assert.equal(row.place_name, "Hashima Island");
  assert.equal(row.area_hint, "Japan");
  assert.equal(row.status, "pending");
  // No coordinate, ever: a model may name a place, never locate one.
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  // The revision, in its own column and in the link.
  assert.equal(row.source_revid, 42);
  assert.match(row.source_url, /oldid=42$/);
});

test("a prose row with no quote is not a row", () => {
  const context = { work: { id: "w1", title: "Skyfall" }, wiki: "jamesbond", page: "P", revid: 1, licence: "CC-BY-SA" };
  assert.equal(toProseSubmission({ place_name: "Somewhere", source_sentence: "" }, context), null);
  assert.equal(toProseSubmission({ place_name: "Somewhere" }, context), null);
  assert.equal(toProseSubmission({ place_name: "", source_sentence: "A real sentence." }, context), null);
});
