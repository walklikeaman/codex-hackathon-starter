import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMONS_WIDTHS, MAX_DPR, SURFACES, TMDB_WIDTHS,
  commonsFileUrl, commonsSrcSet, commonsSrcSetForSurface, commonsWidth,
  mayStore, measuredBytes, responsiveWidths, sizesForSurface, STORAGE_POLICY,
  surfaceCost, tmdbWidth, widthForSurface,
} from "../app/lib/image-budget.mjs";
import { normalizeWikidataEntityLocations, normalizeWikidataLocations } from "../app/lib/location-search.mjs";
import { posterEntry } from "../app/lib/work-posters.mjs";
import { tmdbSrcSetForSurface, tmdbUrlForSurface } from "../app/lib/tmdb-images.mjs";

// THE check. Every image in the product is drawn in a box whose width is written down in
// SURFACES, and none of them may cost more than that box is worth. A surface added later
// without a budget fails here rather than arriving unmeasured, which is how images got
// heavy in the first place (#198).
test("every surface asks for a size its box can justify", () => {
  const over = [];
  for (const key of Object.keys(SURFACES)) {
    const cost = surfaceCost(key);
    assert.ok(cost.width, `${key} has no size`);
    assert.ok(
      cost.bytes !== null,
      `${key} asks for a width nobody has measured — add it to TMDB_BYTES or COMMONS_BYTES`,
    );
    if (cost.over > 0) over.push(`${key}: ${Math.round(cost.bytes / 1024)} kB at w${cost.width}, budget ${Math.round(cost.budgetBytes / 1024)} kB`);
  }
  assert.deepEqual(over, []);
});

test("a size a surface asks for is a size the CDN serves", () => {
  for (const key of Object.keys(SURFACES)) {
    const width = widthForSurface(key);
    const ladder = SURFACES[key].shape === "commons" ? COMMONS_WIDTHS : TMDB_WIDTHS;
    assert.ok(ladder.includes(width), `${key} asks for w${width}, which is not a rung`);
  }
});

// The whole place card, which is the heaviest screen in the product: a backdrop, the
// place photo, and two more frames in the strip below. Stated as a number so a feature
// that doubles it has to change this line and say so.
test("one place card stays under a third of a megabyte", () => {
  const card = ["sheetHero", "placePhoto", "galleryFrame", "galleryFrame"]
    .reduce((total, key) => total + surfaceCost(key).bytes, 0);
  assert.ok(card < 320_000, `${Math.round(card / 1024)} kB`);
});

test("the rungs are the smallest that still cover the box at two device pixels", () => {
  assert.equal(MAX_DPR, 2);
  assert.equal(tmdbWidth(28), 92);     // the desktop chip tile
  assert.equal(tmdbWidth(34), 92);     // a suggestion row
  assert.equal(tmdbWidth(62), 154);    // .work-card-poster
  assert.equal(tmdbWidth(84), 185);    // .place-scene-frame
  // A box wider than the top rung gets the top rung: asking TMDB for more is a 400.
  assert.equal(tmdbWidth(4000), TMDB_WIDTHS[TMDB_WIDTHS.length - 1]);
  // A screen claiming four device pixels is still served two.
  assert.equal(tmdbWidth(62, { dpr: 4 }), tmdbWidth(62, { dpr: 2 }));
  assert.equal(tmdbWidth(0), null);
  assert.equal(tmdbWidth("wide"), null);
});

test("Commons rounds up to one of its own buckets", () => {
  assert.equal(commonsWidth(192), 400);
  assert.equal(commonsWidth(350), 800);
  assert.equal(commonsWidth(0), COMMONS_WIDTHS[0]);
});

// The regression this file exists for. `Special:FilePath/<file>` with no width is the
// full original upload — measured at 5.1 MB mean and 7.0 MB at worst — and it was on
// every place the SPARQL path returned.
test("a Commons file URL always carries a width", () => {
  const url = commonsFileUrl("Big Ben.jpg");
  assert.match(url, /\?width=\d+$/);
  assert.equal(commonsFileUrl("Big Ben.jpg", { width: 400 }), "https://commons.wikimedia.org/wiki/Special:FilePath/Big%20Ben.jpg?width=400");
  // A width that is not a bucket is rounded to one rather than passed through.
  assert.match(commonsFileUrl("X.jpg", { width: 517 }), /\?width=(?:640|800)$/);
  assert.equal(commonsFileUrl("  "), null);
  assert.equal(commonsFileUrl(null), null);
});

test("neither path out of Wikidata can hand the map an original", () => {
  const [fromEntities] = normalizeWikidataEntityLocations(
    { id: "Q1", labels: { en: { value: "Example Film" } }, claims: {
      P915: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }],
    } },
    { Q2: { id: "Q2", labels: { en: { value: "Example Place" } }, claims: {
      P625: [{ mainsnak: { datavalue: { value: { latitude: 51.5, longitude: -0.1 } } } }],
      P18: [{ mainsnak: { datavalue: { value: "Example image.jpg" } } }],
    } } },
    { kind: "film" },
  );
  assert.match(fromEntities.commons_image, /Example%20image\.jpg\?width=\d+$/);

  const [fromSparql] = normalizeWikidataLocations([{
    work: { value: "http://www.wikidata.org/entity/Q1" },
    workLabel: { value: "Example Film" },
    location: { value: "http://www.wikidata.org/entity/Q2" },
    locationLabel: { value: "Example Place" },
    coord: { value: "Point(-0.1 51.5)" },
    // Exactly as the endpoint states it: no width, which is the original file.
    image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Example%20image.jpg" },
  }], { kind: "film" });
  assert.match(fromSparql.commons_image, /Example%20image\.jpg\?width=\d+$/);
});

test("a srcset is offered only where a rewritten width actually renders", () => {
  const commons = "https://commons.wikimedia.org/wiki/Special:FilePath/Big%20Ben.jpg?width=400";
  assert.equal(
    commonsSrcSetForSurface(commons, "placePhoto"),
    `${commons} 400w, https://commons.wikimedia.org/wiki/Special:FilePath/Big%20Ben.jpg?width=800 800w`,
  );
  // A Mapillary or Unsplash URL is one fixed rendering; a rewritten width would 404.
  assert.equal(commonsSrcSetForSurface("https://images.unsplash.com/photo-1?w=800", "placePhoto"), null);
  assert.equal(commonsSrcSet(null), null);
});

// A srcset without `sizes` tells the browser the image fills the viewport, so it takes
// the largest rung on every screen — the overspend wearing a srcset.
test("anything offering two files also says which screen gets which", () => {
  for (const key of Object.keys(SURFACES)) {
    if (responsiveWidths(key).length < 2) continue;
    const sizes = sizesForSurface(key);
    assert.match(sizes, /^\(max-width: \d+px\) \d+px, \d+px$/, `${key}: ${sizes}`);
  }
  assert.equal(sizesForSurface("searchSuggestion"), "34px");
  assert.equal(sizesForSurface("nothing-of-the-sort"), null);
});

test("the chip ships both files, the pieces that go together and nothing half-built", () => {
  const entry = posterEntry("/abc.jpg");
  assert.equal(entry.thumb, "https://image.tmdb.org/t/p/w185/abc.jpg");
  assert.equal(
    entry.thumb_srcset,
    "https://image.tmdb.org/t/p/w92/abc.jpg 92w, https://image.tmdb.org/t/p/w185/abc.jpg 185w",
  );
  assert.equal(entry.thumb_sizes, "(max-width: 860px) 84px, 28px");
  assert.equal(posterEntry(null), null);
  assert.equal(posterEntry("not a path"), null);
});

test("a surface name that does not exist yields nothing rather than a default size", () => {
  assert.equal(widthForSurface("imaginary"), null);
  assert.equal(surfaceCost("imaginary"), null);
  assert.equal(tmdbUrlForSurface("/abc.jpg", "imaginary"), null);
  assert.equal(tmdbSrcSetForSurface("/abc.jpg", "imaginary"), null);
  assert.deepEqual(responsiveWidths("imaginary"), []);
});

test("measured bytes are held per shape, because a 2:3 poster is not a 16:9 frame", () => {
  assert.ok(measuredBytes("poster", 185) > measuredBytes("frame", 185));
  assert.equal(measuredBytes("poster", 999), null);
  assert.equal(measuredBytes("nothing", 185), null);
});

// The licensing rule, in one place rather than four comments. Street View is the reason
// this is a policy and not a performance note.
test("what may be stored is stated once, and Street View never may", () => {
  assert.equal(mayStore("mapillary"), true);
  assert.equal(mayStore("wikimedia"), true);
  assert.equal(mayStore("streetview"), false);
  assert.equal(mayStore("tmdb"), false);
  assert.equal(mayStore("anything-new"), false);
  for (const [source, policy] of Object.entries(STORAGE_POLICY)) {
    assert.ok(policy.why.length > 20, `${source} states no reason`);
    assert.ok(policy.licence, `${source} names no licence`);
  }
});
