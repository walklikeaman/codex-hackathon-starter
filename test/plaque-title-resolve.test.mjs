import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseWork,
  plaqueYears,
  preferredKinds,
  workFromResolution,
  yearFits,
} from "../app/lib/plaque-title-resolve.mjs";
import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";

const normalize = normalizeWorkTitle;
const w = (over) => ({ kind: "film", sitelinks: 10, ...over });

test("the year on the wall picks between works of the same name", () => {
  // "The Lady Vanishes" resolved to the 1976 remake although the plaque is about
  // Gainsborough Studios 1924-1949 — a match that looks right in a list and is false on
  // the wall.
  const chosen = chooseWork(
    [w({ id: "Q1", label: "The Lady Vanishes", year: 1976, sitelinks: 45 }),
     w({ id: "Q2", label: "The Lady Vanishes", year: 1938, sitelinks: 30 })],
    { inscription: "The Gainsborough Film Studios 1924-1949 … were filmed here", title: "The Lady Vanishes", normalize },
  );
  assert.equal(chosen.work.id, "Q2", "1938 sits inside the studio's years; 1976 does not");
});

test("two years are a range, not two points", () => {
  // The Wicked Lady (1945) was being rejected against a 1924-1949 plaque while the 1983
  // remake was not, because only the endpoints were compared.
  assert.equal(yearFits(1945, [1924, 1949]), true);
  assert.equal(yearFits(1983, [1924, 1949]), false);
  assert.equal(yearFits(1954, [1956]), true, "three years of tolerance for a single date");
  assert.equal(yearFits(1963, [1928, 1975]), true, "a wide span is still a span");
  assert.equal(yearFits(null, [1970]), false);
  assert.deepEqual(plaqueYears("The Gainsborough Film Studios 1924-1949"), [1924, 1949]);
});

test("no year means a match is only safe when nothing is ambiguous", () => {
  const one = chooseWork([w({ id: "Q1", label: "Midsomer Murders", kind: "series" })],
    { inscription: "Midsomer Murders filming location The Crooked Billet", title: "Midsomer Murders", normalize });
  assert.equal(one.work.id, "Q1");

  const many = chooseWork(
    [w({ id: "Q1", label: "The Village", year: 2004 }), w({ id: "Q2", label: "The Village", year: 1993 })],
    { inscription: "The Prisoner classic TV series stars Patrick McGoohan", title: "The Village", normalize },
  );
  assert.equal(many.work, null);
  assert.match(many.why, /no year .* 2 works share the title/);
});

test("the verb chooses the kind, so an author does not write a film", () => {
  // "Zane Grey, the prolific author of western novels, lived here … Riders of the Purple
  // Sage" is about the novel; the 1918 adaptation is a different work.
  assert.deepEqual(preferredKinds("The prolific author of western novels lived on this site"), ["book"]);
  assert.deepEqual(preferredKinds("The classic film was filmed at Oakworth Station"), ["film", "series"]);
  assert.equal(preferredKinds("Ian Fleming novelist wrote it here, later filmed"), null,
    "a plaque that says both leaves the choice to fame");

  const chosen = chooseWork(
    [w({ id: "Q1", label: "Riders of the Purple Sage", kind: "film", year: 1918, sitelinks: 8 }),
     w({ id: "Q2", label: "Riders of the Purple Sage", kind: "book", year: 1912, sitelinks: 7 })],
    { inscription: "The prolific author of western novels lived here. Among his books written here was Riders of the Purple Sage (1912).", title: "Riders of the Purple Sage", normalize },
  );
  assert.equal(chosen.work.id, "Q2");
});

test("a title that is not a work at all resolves to nothing", () => {
  // "The Spotted Cow" is a pub invented for an episode; "Boomtown USA" is a nickname for
  // a Texas town. Both would otherwise be rows in the graph forever.
  const chosen = chooseWork(
    [w({ id: "Q1", label: "The Spotted Cow", kind: "other" })],
    { inscription: "The Spotted Cow, the last sighting of Oliver Ordish", title: "The Spotted Cow", normalize },
  );
  assert.equal(chosen.work, null);
  assert.match(chosen.why, /no film, series or book/);
});

test("the title must BE the label, not merely contain it", () => {
  const chosen = chooseWork(
    [w({ id: "Q1", label: "Moby Dick's Wildest Adventure", year: 1956 })],
    { inscription: "John Huston's location for film Moby Dick 1954", title: "Moby Dick", normalize },
  );
  assert.equal(chosen.work, null);
});

test("a work row carries its identifier from birth, or is not built", () => {
  const row = workFromResolution({ id: "Q1140649", kind: "film", year: 1974, imdb: "tt0070917" }, "The Wicker Man");
  assert.equal(row.wikidata_id, "Q1140649");
  assert.equal(row.imdb_id, "tt0070917");
  assert.equal(row.source, "open_plaques");
  assert.equal(workFromResolution({ id: "not-a-qid" }, "X"), null);
  assert.equal(workFromResolution(null, "X"), null);
});
