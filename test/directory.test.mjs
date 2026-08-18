import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CITIES,
  CITIES_BY_SLUG,
  CITY_RADIUS_KM,
  cityAnchors,
  cityPath,
  findCity,
} from "../app/lib/city-gazetteer.mjs";
import {
  CITY_WORKS_PER_PAGE,
  DIRECTORY_LETTERS,
  OTHER_LETTER,
  OTHER_LETTER_SLUG,
  WORKS_PER_PAGE,
  cityCoverage,
  cityWorkLine,
  directorySortKey,
  directorySummary,
  groupByCountry,
  isDirectoryLetter,
  letterBucket,
  letterFromSlug,
  letterToSlug,
  paginate,
} from "../app/lib/directory.mjs";

// ---------- the letter a work is filed under ----------

test("a leading article does not decide the letter", () => {
  // Measured on production before this rule: filing on the raw title_norm put 1,427 of
  // 6,392 works under T — 22% of the catalogue in one bucket, because most of them begin
  // with "the". Stripping the article moved T to 330 and made S the largest at 640.
  assert.equal(letterBucket("the dark knight"), "d");
  assert.equal(letterBucket("a clockwork orange"), "c");
  assert.equal(letterBucket("an american werewolf in london"), "a");
});

test("a title that already carries its article at the end is left alone", () => {
  // movie-locations ships comma-inverted titles. Theirs is already in the right place,
  // and a rule that stripped articles anywhere would file this under G for Golden.
  assert.equal(letterBucket("caper of the golden bulls the"), "c");
  assert.equal(directorySortKey("six sided triangle the"), "six sided triangle the");
});

test("a word that merely starts with an article is not an article", () => {
  // The space is the whole rule. Without it "Theatre of Blood" files under A for "atre".
  assert.equal(letterBucket("theatre of blood"), "t");
  assert.equal(letterBucket("angel heart"), "a");
  assert.equal(letterBucket("theory of everything the"), "t");
});

test("anything that does not open with a Latin letter is one real bucket", () => {
  assert.equal(letterBucket("1917"), OTHER_LETTER);
  assert.equal(letterBucket("28 weeks later"), OTHER_LETTER);
  assert.equal(letterBucket("Ölüm"), OTHER_LETTER);
  assert.equal(letterBucket(""), OTHER_LETTER);
  assert.equal(letterBucket(null), OTHER_LETTER);
});

test("the other bucket travels as a word, because '#' never reaches a server", () => {
  // A '#' in a URL is the fragment delimiter: everything after it stays in the browser,
  // so /directory/films/# would arrive as /directory/films/ with no letter at all.
  assert.equal(letterToSlug(OTHER_LETTER), OTHER_LETTER_SLUG);
  assert.equal(letterFromSlug(OTHER_LETTER_SLUG), OTHER_LETTER);
  assert.equal(letterToSlug("q"), "q");
  assert.equal(letterFromSlug("Q"), "q");
});

test("a letter that is not a letter is refused rather than queried", () => {
  assert.equal(letterFromSlug("zz"), null);
  assert.equal(letterFromSlug("1"), null);
  assert.equal(letterFromSlug(""), null);
  assert.equal(letterFromSlug("#"), null);
  assert.equal(isDirectoryLetter("a"), true);
  assert.equal(isDirectoryLetter("ab"), false);
  assert.equal(DIRECTORY_LETTERS.length, 27);
});

// ---------- paging ----------

test("a page number out of range lands on the last page, not on nothing", () => {
  // The alternative is an empty page under a link we generated ourselves, which reads
  // as lost data rather than as a typo.
  const page = paginate({ total: 250, page: 900, perPage: 100 });
  assert.equal(page.page, 3);
  assert.equal(page.offset, 200);
  assert.deepEqual([page.from, page.to], [201, 250]);
  assert.equal(page.hasNext, false);
});

test("a junk page number is page one and never a negative offset", () => {
  // PostgREST answers a negative offset with an error, so this is a broken page rather
  // than a wrong one.
  for (const input of ["-4", "junk", "", null, undefined, "0"]) {
    const page = paginate({ total: 120, page: input, perPage: 50 });
    assert.equal(page.page, 1, `page for ${JSON.stringify(input)}`);
    assert.equal(page.offset, 0);
  }
});

test("an empty result counts from zero rather than from one", () => {
  const page = paginate({ total: 0, page: 1, perPage: 48 });
  assert.deepEqual([page.from, page.to, page.pages], [0, 0, 1]);
  assert.equal(page.hasPrev, false);
  assert.equal(page.hasNext, false);
});

// ---------- the sentences ----------

test("coverage states the radius, because the radius is what the page means", () => {
  // "Films in London" would be a claim about a city boundary we do not hold. What we
  // hold is what is within a stated distance of a measured point.
  assert.equal(
    cityCoverage({ works: 656, points: 2300, radiusKm: 20 }),
    "656 films with 2300 places recorded within 20 km of the centre.",
  );
  assert.match(cityCoverage({ works: 0, points: 0, radiusKm: 20 }), /^No places recorded/);
});

test("one is written as one", () => {
  // 2,667 of the 6,392 works hold exactly one place. Rounding that up anywhere is how a
  // directory starts promising tours it cannot walk.
  assert.equal(cityCoverage({ works: 1, points: 1 }), "1 film with 1 place recorded within 20 km of the centre.");
  assert.equal(cityWorkLine({ place_count: 1, places: ["Blackfriars Bridge"] }), "Blackfriars Bridge");
});

test("a long place list is cut with the count of what was cut", () => {
  const line = cityWorkLine({
    place_count: 78,
    places: ["147 Cromwell Road", "4 Warwick House Street", "43 St. George's Walk", "Australia House"],
  });
  assert.equal(line, "147 Cromwell Road · 4 Warwick House Street · 43 St. George's Walk — and 75 more");
});

test("a work with no names still says how many places it has", () => {
  assert.equal(cityWorkLine({ place_count: 3, places: [] }), "3 places");
  assert.equal(cityWorkLine({}), "0 places");
});

test("the index summary never presents the city counts as a share of the whole", () => {
  // The discs do not overlap, but they cover only part of what we hold, so "656 of 6,392
  // in London" would be true and "the cities cover N%" would not.
  const line = directorySummary({ works: 6392, points: 32148, cities: 56 });
  assert.equal(line, "6392 films with 32148 places between them, and 56 cities with enough to browse.");
});

// ---------- grouping ----------

test("countries are ordered by what we hold, not alphabetically", () => {
  // Alphabetical order opens the directory on Bulgaria.
  const groups = groupByCountry([
    { name: "Sofia", country: "Bulgaria", works: 29 },
    { name: "London", country: "UK", works: 656 },
    { name: "Cardiff", country: "UK", works: 45 },
    { name: "Toronto", country: "Canada", works: 262 },
  ]);
  assert.deepEqual(groups.map((g) => g.country), ["UK", "Canada", "Bulgaria"]);
  assert.deepEqual(groups[0].cities.map((c) => c.name), ["London", "Cardiff"]);
  assert.equal(groups[0].works, 701);
});

// ---------- the gazetteer ----------

test("every city has a unique, url-safe slug", () => {
  assert.equal(CITIES_BY_SLUG.size, ALL_CITIES.length);
  for (const city of ALL_CITIES) {
    assert.match(city.slug, /^[a-z0-9-]+$/, `${city.name} → ${city.slug}`);
    assert.equal(findCity(city.slug), city);
    assert.equal(cityPath(city), `/city/${city.slug}`);
  }
});

test("accents are stripped the same way a film title's are", () => {
  // One slug rule for every readable URL in the product, so nobody has to remember which
  // half of the app is which.
  assert.equal(findCity("almeria")?.name, "Almería");
  assert.equal(findCity("montreal")?.name, "Montréal");
});

test("an unknown slug is refused here and never becomes a query", () => {
  assert.equal(findCity("atlantis"), null);
  assert.equal(findCity(""), null);
  assert.equal(findCity(null), null);
  assert.equal(cityPath(null), null);
});

test("no two city discs overlap, so no film is counted into two cities", () => {
  // The derivation keeps accepted anchors more than 40 km apart and the radius is 20, so
  // the discs touch at most. If a city is ever added by hand that breaks this, the counts
  // on the index stop being addable and the reader is quietly misled.
  const km = (a, b) => {
    const dLat = (a.lat - b.lat) * 111;
    const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  };
  for (let i = 0; i < ALL_CITIES.length; i += 1) {
    for (let j = i + 1; j < ALL_CITIES.length; j += 1) {
      const gap = km(ALL_CITIES[i], ALL_CITIES[j]);
      assert.ok(
        gap >= 2 * CITY_RADIUS_KM,
        `${ALL_CITIES[i].name} and ${ALL_CITIES[j].name} are ${gap.toFixed(1)} km apart`,
      );
    }
  }
});

test("every anchor is a real coordinate and none of them is Null Island", () => {
  // Four Null Island incidents in this project, all from Number("") being 0 and 0 being
  // finite. A city anchored there would collect every one of them.
  for (const city of ALL_CITIES) {
    assert.ok(Number.isFinite(city.lat) && Math.abs(city.lat) <= 90, city.name);
    assert.ok(Number.isFinite(city.lng) && Math.abs(city.lng) <= 180, city.name);
    assert.ok(city.lat !== 0 || city.lng !== 0, city.name);
    assert.ok(city.country && city.name, city.name);
  }
});

test("the anchors sent to the database carry no names", () => {
  // The database is asked where to measure, never what a city is called: the set of
  // cities is a commit, not a migration.
  const anchors = cityAnchors();
  assert.equal(anchors.length, ALL_CITIES.length);
  for (const anchor of anchors) {
    assert.deepEqual(Object.keys(anchor).sort(), ["lat", "lng", "radius_km", "slug"]);
    assert.equal(anchor.radius_km, CITY_RADIUS_KM);
  }
});

test("the page sizes are the ones the pages ask for", () => {
  assert.equal(WORKS_PER_PAGE, 100);
  assert.equal(CITY_WORKS_PER_PAGE, 48);
});
