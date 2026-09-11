import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE,
  cellReferences,
  classifyHeader,
  fandomSentence,
  licenceAllows,
  locationSection,
  namesAPlaceInAList,
  parseLocationList,
  parseLocationRows,
  matchWork,
  namesAPlace,
  pageTitleToWorkTitle,
  parseLocationTable,
  toSubmission,
} from "../app/lib/fandom-source.mjs";

// Every fixture below is trimmed from a real page, fetched 10.09.2026. Three wikis produce
// three different tables and none of them agree on column order, which is the whole reason
// this module reads headers instead of positions.

const BOND = `
===Filming===
Tomorrow Never Dies marked a first time in 10 years to have the entire production at [[Pinewood Studios]].

==Locations==
{| class=wikitable
|-
! Country and region !! Location !! Real/shooting Location
|-
| rowspan=1 | [[Russia]], unknown mountainous border region
| [[Terrorist Arms Bazaar]]
| Altiport de Peyresourde-Balestas, France<ref name="ML">[https://movie-locations.com/movies/t/Tomorrow-Never-Dies.php MovieLocations]</ref>
|-
| rowspan=3 | [[UK]]
| [[Oxford University]]
| Brasenose College of Oxford<br>Holywell Street in front of New College
|-
| [[SIS Building]], MI6 Headquarters
| Somerset House in the Strand, London WC2
|-
| M's convoy
| Same
|}
`;

const LOTR = `
==Locations==
{| border="1"
|- bgcolor="#ccc"
!align="center" |Fictional<br />Location
!align="center" |Specific Location<br />in New Zealand
!align="center" |General Area<br />in New Zealand
|-
|Hobbiton
|Matamata
|Waikato
|-
|Gardens of Isengard
|Harcourt Park
|Wellington
|}
`;

// Skyfall: two bullet lists side by side, in no order and of different lengths.
const SKYFALL = `
==Locations==
{| class="wikitable"
|-
!In-Film Locations
! style="width:50%;" |Shooting Locations
|-
| style="vertical-align:top;" |
*Istanbul, Turkey
*[[London]], [[England]]
*Shanghai, China
| style="vertical-align:top;" |
*[[Pinewood Studios]] &mdash; London
|}
`;

// ---------- which section, and there is more than one ----------

test("the section with the table wins over the one that merely mentions filming", () => {
  // The Bond pages carry a prose `===Filming===` before `==Locations==`. Taking the first
  // match read three paragraphs about a script and returned nothing for the page with the
  // best table on the wiki.
  const section = locationSection(BOND).text;
  assert.ok(section.includes("{|"), "the chosen section holds the table");
  assert.equal(/marked a first time/.test(section), false, "and not the prose one");
});

test("a nested matching heading closes its parent instead of replacing it", () => {
  // "== Locations" holds the table and "=== Shooting locations" sits underneath holding
  // prose. Overwriting lost the table on every page shaped that way.
  const nested = `==Locations==\n{| class=wikitable\n|-\n! Location !! Real/shooting Location\n|-\n| Bond Street | Somewhere\n|}\n===Shooting locations===\nSome prose about the shoot.\n`;
  assert.ok(locationSection(nested).text.includes("{|"));
});

test("a page with no such section answers null", () => {
  assert.equal(locationSection("==Plot==\nThings happen.\n"), null);
});

// ---------- what a column means ----------

test("headers are read, never positions", () => {
  assert.equal(classifyHeader("Real/shooting Location"), "real");
  assert.equal(classifyHeader("Shooting Locations"), "real");
  assert.equal(classifyHeader("Specific Location<br />in New Zealand"), "real");
  assert.equal(classifyHeader("Fictional<br />Location"), "story");
  assert.equal(classifyHeader("In-Film Locations"), "story");
  assert.equal(classifyHeader("Location"), "story");
});

test("'Real/shooting Location' is real even though it contains 'Location'", () => {
  // If the story test ran first every column would answer "story".
  assert.equal(classifyHeader("Real/shooting Location"), "real");
});

test("a region belongs to one side and the header says which", () => {
  // The Bond "Country and region" is where the SCENE is set — the row reading "Russia" is
  // the one whose shooting location is an altiport in France.
  assert.equal(classifyHeader("Country and region"), "story_region");
  assert.equal(classifyHeader("General Area<br />in New Zealand"), "real_region");
});

// ---------- the tables ----------

test("the Bond table reads its three columns the right way round", () => {
  const rows = parseLocationTable(locationSection(BOND).text);
  const sis = rows.find((r) => r.story?.startsWith("SIS Building"));
  assert.equal(sis.real, "Somerset House in the Strand, London WC2");
  assert.equal(sis.storyRegion, "UK");
  assert.equal(sis.region, null, "no real-side region in this table");
});

test("a rowspan carries down instead of shifting every later column left", () => {
  // The country cell spans three rows, so the next two arrive with fewer cells. Without
  // the grid the story location slides into the real column.
  const rows = parseLocationTable(locationSection(BOND).text);
  const oxford = rows.find((r) => r.story === "Oxford University");
  const sis = rows.find((r) => r.story?.startsWith("SIS Building"));
  assert.equal(oxford.storyRegion, "UK");
  assert.equal(sis.storyRegion, "UK", "inherited from the spanning cell two rows up");
});

test("a <br> inside a cell is two places, not one", () => {
  const rows = parseLocationTable(locationSection(BOND).text);
  const oxford = rows.filter((r) => r.story === "Oxford University").map((r) => r.real);
  assert.deepEqual(oxford, ["Brasenose College of Oxford", "Holywell Street in front of New College"]);
});

test("a row whose licence we could not read still records that it could not", () => {
  const rows = parseLocationTable(locationSection(LOTR).text);
  const row = toSubmission(rows[0], { work: { id: "w", title: "F" }, wiki: "lotr", page: "P", revid: 1 });
  // Never null — the column refuses it, and "unknown" is an honest answer where a blank
  // would read as "no restrictions".
  assert.equal(row.source_license, "unknown");
});

test("the citation the fan left is carried on the row", () => {
  // This is what answers the original objection to this source: the independent source is
  // already in the row rather than left for a reviewer to go and find. Measured: 3 refs
  // across 70 Bond rows, so it is the exception — but it is the valuable exception.
  const rows = parseLocationTable(locationSection(BOND).text);
  const bazaar = rows.find((r) => r.story === "Terrorist Arms Bazaar");
  assert.ok(bazaar.references.some((u) => u.includes("movie-locations.com")));
});

test("the LOTR table puts its real region in the real column's side", () => {
  const rows = parseLocationTable(locationSection(LOTR).text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    real: "Matamata", story: "Hobbiton", region: "Waikato", storyRegion: null, references: [],
  });
});

// ---------- what it refuses ----------

test("two bullet lists side by side are not pairs", () => {
  // Skyfall lists seven in-film locations beside one shooting location, in no order.
  // Zipping them produced "Istanbul, Turkey was filmed at Pinewood Studios", which nobody
  // claimed. The real place is kept; the pairing is what would be invented.
  const rows = parseLocationTable(locationSection(SKYFALL).text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].real, "Pinewood Studios — London");
  assert.equal(rows[0].story, null, "no pairing is asserted");
});

test("a split on ';' must not cut an HTML entity in half", () => {
  // "&mdash;" became "Pinewood Studios &mdash" before entities were decoded first.
  const rows = parseLocationTable(locationSection(SKYFALL).text);
  assert.equal(/&mdash/.test(rows[0].real), false);
});

test("a cell that names nothing is not a place", () => {
  for (const junk of ["Same", "Same (currently known as The O2 Arena)", "TBA", "N/A", "—", "?", "Unknown",
    "some interior shots are studio", "currently known as Altiport 007",
    // Shipped once, and caught on a live card: the wiki's aside promoted to an address.
    "(sometimes misidentified as Banyan Tree Bangkok, Sathorn)"]) {
    assert.equal(namesAPlace(junk), false, `${junk} is not a place`);
  }
  for (const real of ["Somerset House in the Strand, London WC2", "Matamata", "Eilean Donan"]) {
    assert.equal(namesAPlace(real), true, `${real} is a place`);
  }
});

test("'Same' never becomes a pin, because it would inherit the row above's address", () => {
  const rows = parseLocationTable(locationSection(BOND).text);
  assert.equal(rows.some((r) => /^same/i.test(r.real)), false);
  assert.equal(rows.some((r) => r.story === "M's convoy"), false, "the row is dropped entirely");
});

test("a table with no identifiable real column yields nothing at all", () => {
  // The guardrail. A table we cannot find the shooting location in is one whose cells we
  // would be guessing at, and a guess here says somebody filmed where they did not.
  const opaque = `==Locations==\n{| class=wikitable\n|-\n! A !! B !! C\n|-\n| one | two | three\n|}\n`;
  assert.deepEqual(parseLocationTable(locationSection(opaque).text), []);
});

// ---------- licence ----------

test("a non-commercial wiki is refused", () => {
  // memory-alpha is CC-BY-NC and minecraft is CC BY-NC-SA.
  assert.equal(licenceAllows({ text: "CC-BY-NC", url: "https://creativecommons.org/licenses/by-nc/3.0/" }), false);
  assert.equal(licenceAllows({ text: "CC BY-NC-SA", url: "https://www.fandom.com/licensing" }), false);
});

test("text and url must agree, because on its own example the obvious rule fails", () => {
  // Minecraft declares CC BY-NC-SA in the TEXT while pointing at the farm-default CC-BY-SA
  // URL. Reading only the url would have taken a non-commercial wiki.
  assert.equal(licenceAllows({ text: "CC BY-NC-SA", url: "https://creativecommons.org/licenses/by-sa/3.0/" }), false);
  assert.equal(licenceAllows({ text: "CC-BY-SA", url: "https://creativecommons.org/licenses/by-sa/3.0/" }), true);
});

test("no licence at all is not permission", () => {
  assert.equal(licenceAllows({}), false);
  assert.equal(licenceAllows({ text: "", url: "" }), false);
  assert.equal(licenceAllows({ text: "All rights reserved", url: "" }), false);
});

// ---------- the row that reaches the queue ----------

test("a submission says who claimed it, at which revision", () => {
  const rows = parseLocationTable(locationSection(BOND).text);
  const sis = rows.find((r) => r.story?.startsWith("SIS Building"));
  const row = toSubmission(sis, {
    work: { id: "w1", title: "Tomorrow Never Dies" },
    wiki: "jamesbond", page: "Tomorrow Never Dies (film)", revid: 163492, licence: "CC-BY-SA",
  });
  assert.equal(row.source_kind, SOURCE);
  assert.equal(row.status, "pending");
  // The revision, not the live page: a fan wiki changes under you and a citation that
  // cannot be re-read is not a citation.
  assert.match(row.source_url, /\?oldid=163492$/);
  // And in a column of its own: the table's evidence constraint requires it, because a
  // revision no query can reach is not evidence the review can use.
  assert.equal(row.source_revid, 163492);
  assert.match(row.source_sentence, /according to the jamesbond wiki page/);
  // Both NOT NULL on the table. The licence is the reason the row may exist at all, so it
  // gets a column rather than a note.
  assert.equal(row.source_title, "jamesbond wiki: Tomorrow Never Dies (film)");
  assert.equal(row.source_license, "CC-BY-SA");
});

test("a submission carries no coordinate, because Fandom has none", () => {
  // The same rule movie-locations is ingested under: a point invented during an import is
  // a guess buried where nobody looks.
  const rows = parseLocationTable(locationSection(LOTR).text);
  const row = toSubmission(rows[0], { work: { id: "w2", title: "The Fellowship of the Ring" }, wiki: "lotr", page: "X", revid: 1 });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
});

test("the story's country never becomes the real place's area hint", () => {
  // The row reading "Russia" has its shooting location at an altiport in France. Handing
  // "Russia" to a geocoder as the area would send it to the wrong country.
  const rows = parseLocationTable(locationSection(BOND).text);
  const bazaar = rows.find((r) => r.story === "Terrorist Arms Bazaar");
  const row = toSubmission(bazaar, { work: { id: "w1", title: "Tomorrow Never Dies" }, wiki: "jamesbond", page: "X", revid: 1 });
  assert.equal(row.area_hint, null);
  assert.match(row.source_sentence, /Russia[^]*was filmed at Altiport/, "it is stated on the story's side");
});

test("a real-side region does become the area hint", () => {
  const rows = parseLocationTable(locationSection(LOTR).text);
  const row = toSubmission(rows[0], { work: { id: "w2", title: "F" }, wiki: "lotr", page: "X", revid: 1 });
  assert.equal(row.area_hint, "Waikato");
});

test("identity is left to the database, not invented here", () => {
  // `place_key` is generated as lower(btrim(place_name)) and the unique index is
  // (work_id, place_key). Sending our own value fails outright — "cannot insert a
  // non-DEFAULT value into column place_key" — and inventing a second notion of identity
  // beside the one the table enforces is how a re-run starts duplicating.
  const rows = parseLocationTable(locationSection(LOTR).text);
  const row = toSubmission(rows[0], { work: { id: "w2", title: "F" }, wiki: "lotr", page: "The Fellowship", revid: 1 });
  assert.equal("place_key" in row, false);
  assert.equal(row.place_name, "Matamata");
});

// ---------- matching a page to a work ----------

test("a film page's qualifier comes off before matching", () => {
  assert.equal(pageTitleToWorkTitle("Skyfall (film)"), "Skyfall");
  assert.equal(pageTitleToWorkTitle("Casino Royale (2006 film)"), "Casino Royale");
  assert.equal(pageTitleToWorkTitle("Hobbiton"), "Hobbiton");
});

test("an ambiguous title matches nothing", () => {
  // Two works sharing a title is the collision the year backfill was for, and a wiki page
  // carries no year to break the tie with.
  const byTitle = new Map([
    ["skyfall", [{ id: "a", title: "Skyfall" }]],
    ["fargo", [{ id: "b", title: "Fargo" }, { id: "c", title: "Fargo" }]],
  ]);
  assert.equal(matchWork("Skyfall (film)", byTitle).id, "a");
  assert.equal(matchWork("Fargo", byTitle), null);
  assert.equal(matchWork("Nothing Here", byTitle), null);
});

test("references are pulled out of a cell whole", () => {
  assert.deepEqual(
    cellReferences(`x<ref>[https://movie-locations.com/a A]</ref> y [http://commanderbond.net/b]`),
    ["https://movie-locations.com/a", "http://commanderbond.net/b"],
  );
});

test("the sentence never claims a pairing it was not given", () => {
  const unpaired = fandomSentence(
    { real: "Pinewood Studios", story: null, region: null, storyRegion: null },
    { workTitle: "Skyfall", wiki: "jamesbond", page: "Skyfall (film)" },
  );
  assert.match(unpaired, /^Skyfall was filmed at Pinewood Studios/);
});


// ---------- the list, and the paragraph wearing a bullet ----------

// Verbatim from lotr/Halifirien (film), 11.09 — the shape a list parser can actually read,
// junk links and all.
const HALIFIRIEN = `==Filming Locations==
*Keash Mountain, Ballymote, Co. Sligo, Republic of Ireland, Ireland
*Carrowkeel Mountain, Co. Sligo, Republic of Ireland, Ireland
*[http://www.imdb.com/title/tt1467334/ Halifirien on IMDB]
*[http://www.youtube.com/user/HalifirienTheMovie Halifirien on Youtube]
`;

// Verbatim from jamesbond/Skyfall, shortened. One bullet, one paragraph.
const SKYFALL_PROSE = `==Filming==
*Shooting began in and around London, with scenes shot in Southwark and Whitehall, the National Gallery and Smithfield meat markets. The Vauxhall Bridge was closed to traffic for filming.
`;

test("a clean list under a filming heading yields its places", () => {
  const rows = parseLocationRows(locationSection(HALIFIRIEN));
  assert.deepEqual(rows.map((row) => row.real), [
    "Keash Mountain, Ballymote, Co. Sligo, Republic of Ireland, Ireland",
    "Carrowkeel Mountain, Co. Sligo, Republic of Ireland, Ireland",
  ]);
  // Unpaired, and deliberately: a list says nothing about which half is the story.
  assert.ok(rows.every((row) => row.story === null));
});

test("a bullet holding a paragraph is not a place", () => {
  // This is the common case, not the edge — taking it would hand a geocoder 180 characters
  // of prose about road closures.
  assert.deepEqual(parseLocationRows(locationSection(SKYFALL_PROSE)), []);
});

test("a bare Locations heading is refused, because on a fan wiki it means Tatooine", () => {
  // The whole safety of reading a list. A table has a column header saying which side is
  // real; a list has only the heading, and "Locations" on a fan wiki is in-universe.
  const inUniverse = `==Locations==
*Tatooine
*Hoth
`;
  assert.deepEqual(parseLocationList(locationSection(inUniverse).text, { title: "Locations" }), []);
  // The same list under a heading that claims real places is read.
  assert.equal(parseLocationList("*Hashima Island, Japan", { title: "Filming locations" }).length, 1);
});

test("a sentence is refused however short, and a place with a full stop is kept", () => {
  assert.equal(namesAPlaceInAList("St. Michael's Mount, Cornwall"), true);
  assert.equal(namesAPlaceInAList("The bridge was closed for filming"), false);
  assert.equal(namesAPlaceInAList("Filming began here. Crowds gathered nearby"), false);
  assert.equal(namesAPlaceInAList("[http://www.imdb.com/title/tt1467334/ Halifirien on IMDB]"), false);
  // The refusals the table parser already makes still apply.
  assert.equal(namesAPlaceInAList("Same as above"), false);
  assert.equal(namesAPlaceInAList("TBA"), false);
});

test("a table still wins over a list on a page that keeps both", () => {
  // The table carries the pairing, which is the part a list cannot give and the part this
  // source is worth having for.
  const both = `==Filming locations==
{| class="wikitable"
! In-Film Location !! Shooting Location
|-
| MI6 Headquarters || Somerset House
|}
*Hashima Island, Japan
`;
  const rows = parseLocationRows(locationSection(both));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].real, "Somerset House");
  assert.equal(rows[0].story, "MI6 Headquarters");
});

test("a nested bullet is a qualifier on its parent, not a second place", () => {
  const nested = `==Filming locations==
*Somerset House, London
**used for the MI6 exterior
`;
  assert.deepEqual(parseLocationRows(locationSection(nested)).map((r) => r.real), ["Somerset House, London"]);
});
