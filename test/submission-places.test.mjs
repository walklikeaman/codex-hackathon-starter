import assert from "node:assert/strict";
import test from "node:test";

import {
  isRefusedSource,
  MATCHED_BY,
  REFUSED_SOURCES,
  selectSubmissionPlaces,
  submissionToLocation,
} from "../app/lib/submission-places.mjs";

const WORK = { id: "Q41668", title: "Notting Hill", year: 1999 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

const row = (over = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  place_name: "Portobello Road",
  area_hint: "London",
  lat: 51.5165,
  lng: -0.2055,
  source_url: "https://moviemaps.org/movies/xyz",
  source_sentence: null,
  source_kind: "moviemaps",
  ...over,
});

test("a pending submission reaches the map as a candidate, never as a verified place", () => {
  // 38,270 rows are pending because nobody has checked them. Showing an unchecked claim
  // labelled unchecked is honest; showing 30,000 of them as pins that look like the
  // verified ones would undo the grounding rule in one commit.
  const location = submissionToLocation(row(), { work: WORK, kind: "film" });

  assert.equal(location.relation_kind, "candidate");
  assert.equal(location.relation_label, "In review");
  assert.equal(location.loc_wikidata_id, null, "a queue row is not a Wikidata item");
  assert.match(location.loc_source_id, /^submission:/);
  assert.match(location.relation_description, /not yet verified/i);
});

test("the source's own sentence leads when it has one", () => {
  const location = submissionToLocation(
    row({ source_sentence: "The blue door on Westbourne Park Road" }),
    { work: WORK, kind: "film" },
  );
  assert.match(location.relation_description, /^The blue door on Westbourne Park Road/);
});

test("a row without a usable coordinate is dropped rather than placed at Null Island", () => {
  // Number("") is 0 and 0 is finite — the coercion that has put places at 0,0 four times
  // in this codebase.
  assert.equal(submissionToLocation(row({ lat: "", lng: "" }), { work: WORK, kind: "film" }), null);
  assert.equal(submissionToLocation(row({ lat: null }), { work: WORK, kind: "film" }), null);
  assert.equal(submissionToLocation(row({ place_name: "  " }), { work: WORK, kind: "film" }), null);
});

test("every source reaches the map, and every card names who said it", () => {
  // Owner's decision 05.08: collect any source and mark it unverified rather than
  // discarding the lead. "Somebody said something happened here" is worth showing as
  // long as the card says exactly that and links to whoever said it.
  assert.deepEqual([...REFUSED_SOURCES], [], "nothing is withheld by default");
  assert.equal(isRefusedSource("reelstreets"), false);

  // Different places, because two sources naming the SAME place are deduplicated into
  // one pin — correct, and a separate question from which sources we accept.
  const chosen = selectSubmissionPlaces(
    [
      row({ source_kind: "reelstreets", place_name: "Westbourne Park Road", lat: 51.5188, lng: -0.2011 }),
      row({ id: "22222222-2222-2222-2222-222222222222" }),
    ],
    { work: WORK, kind: "film", center: LONDON },
  );
  assert.equal(chosen.length, 2);
  assert.match(chosen.find((place) => place.evidence_source === "reelstreets").relation_description, /Reelstreets/);
  assert.match(chosen.find((place) => place.evidence_source === "moviemaps").relation_description, /MovieMaps/);
  for (const place of chosen) assert.match(place.relation_description, /not yet verified/i);
});

test("a row matched only by title says so, because a title is not an identifier", () => {
  // Doctor Who is two series under one name: Wikidata points at tt0056751 (1963) and the
  // queue was filled under tt0436992 (2005). Both are Doctor Who and both should show —
  // but "same title" and "same identifier" are not the same claim, and Gladiator is two
  // different films.
  const [byTitle] = selectSubmissionPlaces([row()], {
    work: WORK, kind: "film", center: LONDON, matchedBy: MATCHED_BY.title,
  });
  assert.equal(byTitle.matched_by, "title");
  assert.match(byTitle.relation_label, /matched by title/i);
  assert.match(byTitle.relation_description, /by title, not by identifier/i);

  const [byId] = selectSubmissionPlaces([row()], { work: WORK, kind: "film", center: LONDON });
  assert.equal(byId.matched_by, "id");
  assert.equal(byId.relation_label, "In review");
  assert.doesNotMatch(byId.relation_description, /by title/i);
});

test("nearest first, and bounded — one series has 961 rows in the queue", () => {
  const far = row({ id: "33333333-3333-3333-3333-333333333333", place_name: "Far Away", lat: 55.9, lng: -3.2 });
  const near = row({ id: "44444444-4444-4444-4444-444444444444", place_name: "Near Here", lat: 51.51, lng: -0.13 });
  const chosen = selectSubmissionPlaces([far, near], { work: WORK, kind: "film", center: LONDON, limit: 5 });

  assert.deepEqual(chosen.map((place) => place.loc_name), ["Near Here", "Far Away"]);

  const many = Array.from({ length: 40 }, (_, index) => row({
    id: `5${index}`.padEnd(36, "0"), place_name: `Place ${index}`, lat: 51.5 + index / 500,
  }));
  assert.equal(selectSubmissionPlaces(many, { work: WORK, kind: "film", center: LONDON, limit: 12 }).length, 12);
});

test("a place the live search already found is not shown twice", () => {
  // MovieMaps and Wikidata both know Alnwick Castle, and two pins for one place — one
  // labelled verified, one not — is the map contradicting itself.
  const chosen = selectSubmissionPlaces(
    [row({ place_name: "Alnwick Castle", lat: 55.4158, lng: -1.7061 })],
    {
      work: WORK, kind: "film", center: LONDON,
      exclude: [{ loc_name: "Alnwick Castle", lat: 55.4157, lng: -1.7060 }],
    },
  );
  assert.deepEqual(chosen, []);
});
