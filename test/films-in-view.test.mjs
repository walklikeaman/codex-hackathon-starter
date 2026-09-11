import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  filmsInView,
  filmsInViewLabel,
  isViewMode,
} from "../app/lib/films-in-view.mjs";

const point = (name, films, extra = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-118.25, 34.05] },
  properties: { candidate: true, name, films, work_count: films.length, ...extra },
});

test("one entry per film, however many pins it appears on", () => {
  // 1,304 rows across 291 films in the owner's Los Angeles set. A list repeating "Blade
  // Runner" eleven times is not a list of films.
  const films = filmsInView([
    point("Bradbury Building", [{ work_id: "a", title: "Blade Runner", year: 1982 }]),
    point("Union Station", [{ work_id: "a", title: "Blade Runner", year: 1982 }]),
    point("Ennis House", [{ work_id: "a", title: "Blade Runner", year: 1982 }]),
  ]);
  assert.equal(films.length, 1);
  assert.equal(films[0].place_count, 3);
  assert.deepEqual(films[0].places.map((p) => p.name), ["Bradbury Building", "Union Station", "Ennis House"]);
});

test("two sources naming one film without agreeing on an id still make one entry", () => {
  const films = filmsInView([
    point("A", [{ work_id: null, title: "The Big Lebowski" }]),
    point("B", [{ title: "the big lebowski" }]),
  ]);
  assert.equal(films.length, 1, "matched on the normalised title");
  assert.equal(films[0].place_count, 2);
});

test("the film with the most places in view leads", () => {
  const films = filmsInView([
    point("A", [{ work_id: "x", title: "Zodiac" }, { work_id: "y", title: "Heat" }]),
    point("B", [{ work_id: "y", title: "Heat" }]),
  ]);
  assert.deepEqual(films.map((f) => f.title), ["Heat", "Zodiac"]);
});

test("ties fall through to the title, so the list does not reshuffle as the map is nudged", () => {
  const films = filmsInView([point("A", [{ work_id: "b", title: "Bravo" }, { work_id: "a", title: "Alpha" }])]);
  assert.deepEqual(films.map((f) => f.title), ["Alpha", "Bravo"]);
});

test("a film seen only on a backlot says so", () => {
  // A different answer from one seen on the street, and the reader is owed it before they
  // walk anywhere.
  const [film] = filmsInView([
    point("New York Street", [{ work_id: "a", title: "The Artist" }], {
      depicts_elsewhere: true, studio_lot: { slug: "warner-bros-burbank", name: "Warner Bros." },
    }),
  ]);
  assert.equal(film.on_a_lot_only, true);
  assert.equal(film.places[0].studio_lot.name, "Warner Bros.");
});

test("one street place is enough to stop it being lot-only", () => {
  const [film] = filmsInView([
    point("New York Street", [{ work_id: "a", title: "The Artist" }], { depicts_elsewhere: true }),
    point("Bradbury Building", [{ work_id: "a", title: "The Artist" }]),
  ]);
  assert.equal(film.on_a_lot_only, false);
});

test("a cluster is not a film list", () => {
  // Below the zoom threshold the server sends aggregate bubbles, which carry no films.
  assert.deepEqual(filmsInView([{ properties: { cluster: true, point_count: 40 } }]), []);
});

test("nothing in view is said, not left blank", () => {
  assert.deepEqual(filmsInView([]), []);
  assert.equal(filmsInViewLabel([]), "No films in view");
});

test("the label states films AND places, because they are different numbers", () => {
  // Printing one of them makes "we hold little here" and "you are zoomed too far out" look
  // identical, which is the bug the place card already fixed once.
  const films = filmsInView([
    point("A", [{ work_id: "a", title: "Heat" }, { work_id: "b", title: "Collateral" }]),
    point("B", [{ work_id: "a", title: "Heat" }]),
  ]);
  assert.equal(filmsInViewLabel(films), "2 films · 3 places in view");
});

test("the list opens on posters, and both modes are real", () => {
  // Browsing and looking for a title are different tasks, not a matter of taste.
  assert.equal(DEFAULT_VIEW_MODE, VIEW_MODES.posters);
  assert.equal(isViewMode("list"), true);
  assert.equal(isViewMode("grid"), false);
});

// Carried through so the panel can rank what is worth seeing here; without them every film
// in view scores the same and the ranked list is alphabetical by accident.
test("a film in view keeps the rating and the vote count it arrived with", () => {
  const [film] = filmsInView([{
    geometry: { type: "Point", coordinates: [-118.3, 34.1] },
    properties: {
      name: "Somewhere",
      films: [{ work_id: "w1", title: "Forrest Gump", imdb: 8.8, imdb_votes: 2532967 }],
    },
  }]);
  assert.equal(film.imdb, 8.8);
  assert.equal(film.imdb_votes, 2532967);
});

test("a film with no rating carries null rather than zero", () => {
  const [film] = filmsInView([{
    geometry: { type: "Point", coordinates: [-118.3, 34.1] },
    properties: { name: "Somewhere", films: [{ work_id: "w2", title: "Unrated" }] },
  }]);
  assert.equal(film.imdb, null);
  assert.equal(film.imdb_votes, null);
});
