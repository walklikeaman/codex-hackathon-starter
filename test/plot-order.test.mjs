import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUOTE_WORDS, MIN_QUOTE_WORDS, appearsAsName, findPlotSection, normalisedText, placeInPlot,
  scenesFromPlacement,
} from "../app/lib/plot-order.mjs";

const PLOT = "In 1890 London, Holmes and Watson stop the ritual murder of a young woman. "
  + "Holmes visits Blackwood in his cell at Pentonville Prison before the hanging. "
  + "Later Holmes returns to the cell where it all began, at Pentonville Prison again.";
const KNOWN = [
  { location: "Somerset House", appears_as: "Appears as \"Pentonville Prison (cell)\"." },
  { location: "St Bartholomew-the-Great", appears_as: "Appears as \"St. Paul's Cathedral (crypt)\"." },
];

test("the plot section is found by its name, and its index — not its number — is returned", () => {
  const toc = { sections: [
    { line: "Plot", index: "1", number: "1" },
    { line: "Cast", index: "2", number: "2" },
  ] };
  assert.equal(findPlotSection(toc), "1");
  assert.equal(findPlotSection({ sections: [{ line: "<i>Synopsis</i>", index: "3" }] }), "3");
  assert.equal(findPlotSection({ sections: [{ line: "Production", index: "1" }] }), null);
  assert.equal(findPlotSection(null), null);
});

test("a quote counts only if the text contains it, with curly quotes and spacing forgiven", () => {
  const placed = placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: "Holmes visits Blackwood in his   cell at Pentonville Prison", fictional: false },
    { location: "St Bartholomew-the-Great", plot_quote: "Holmes and Watson interrupt the ritual in a crypt", fictional: false },
  ] }], KNOWN);
  assert.deepEqual(placed.map((entry) => entry.location), ["Somerset House"]);
  assert.equal(normalisedText("Holmes’s “cell”"), normalisedText("holmes's \"cell\""));
});

test("a location the story returns to is placed at its first passage", () => {
  const placed = placeInPlot(PLOT, [
    { matches: [{ location: "Somerset House", plot_quote: "Holmes returns to the cell where it all began", fictional: false }] },
    { matches: [{ location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville", fictional: false }] },
  ], KNOWN);
  assert.equal(placed.length, 1);
  assert.match(placed[0].quote, /visits Blackwood/);
});

test("a quote outside the length window, or for a place not ours, is refused", () => {
  const tooShort = "his cell at Pentonville";
  assert.ok(tooShort.split(" ").length < MIN_QUOTE_WORDS);
  const tooLong = PLOT.split(" ").slice(0, MAX_QUOTE_WORDS + 3).join(" ");
  const placed = placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: tooShort, fictional: false },
    { location: "Somerset House", plot_quote: tooLong, fictional: false },
    { location: "Somewhere Invented", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false },
  ] }], KNOWN);
  assert.deepEqual(placed, []);
});

test("what a place appears as is read off the guide line, or not at all", () => {
  assert.equal(appearsAsName("Appears as \"Grand Hotel (exterior)\". The college was built in…"), "Grand Hotel (exterior)");
  assert.equal(appearsAsName("Appears as “Wayne Manor”."), "Wayne Manor");
  assert.equal(appearsAsName("Westminster Bridge was designed by Thomas Page."), null);
});

// A film has no chapters: its spoiler tier IS its place in the story, so the trail shows
// the walk only as far as the reader has watched. The teaser names nothing.
test("the scenes keep the order as their spoiler tier, credit the quote, and spoil nothing early", () => {
  const scenes = scenesFromPlacement(placeInPlot(PLOT, [{ matches: [
    { location: "Somerset House", plot_quote: "Holmes visits Blackwood in his cell at Pentonville Prison", fictional: false },
  ] }], KNOWN), { title: "Sherlock Holmes (2009 film)" });
  assert.deepEqual(scenes[0], {
    sequence_index: 1,
    place_name: "Pentonville Prison (cell)",
    known_place: "Somerset House",
    plot_beat: "\"Holmes visits Blackwood in his cell at Pentonville Prison\" (Wikipedia, Sherlock Holmes (2009 film))",
    quote: "Holmes visits Blackwood in his cell at Pentonville Prison",
    safe_teaser: "Scene 1 of the walk.",
    spoiler_tier: 1,
    is_fictional_setting: false,
  });
});
