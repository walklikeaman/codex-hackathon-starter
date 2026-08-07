import assert from "node:assert/strict";
import test from "node:test";

import {
  DISTANCE_INFLUENCE,
  DISTANCE_PERSON,
  DISTANCE_SELF,
  MAX_ROUTABLE_DISTANCE,
  distanceLabel,
  factDistance,
  factSentence,
  isRoutableFact,
} from "../app/lib/facts.mjs";

const fact = (overrides = {}) => ({
  subject_type: "work",
  subject_name: "Harry Potter and the Philosopher's Stone",
  name: "Alnwick Castle",
  relation_kind: "filming_location",
  statement: null,
  about: null,
  stated_year: null,
  ...overrides,
});

// --- the sentence a source stated beats the sentence we would have invented -----

test("a source's own words are printed verbatim", () => {
  // The whole argument for storing a statement: this is what somebody crossed a city to
  // read, and every template in this module is worse than it.
  const inscription =
    "J. K. Rowling wrote some of the early chapters of Harry Potter in the rooms on the "
    + "first floor of this building";
  assert.equal(
    factSentence(fact({ statement: inscription, relation_kind: "wrote_here" })),
    inscription,
  );
});

test("stored wording is never reworded, punctuated or capitalised for us", () => {
  // Trimmed, and nothing else. A quote that has been tidied cannot be checked against
  // the wall it was copied from, which is the only thing that makes it evidence.
  assert.equal(factSentence(fact({ statement: "  lived here 1962-1971  " })), "lived here 1962-1971");
});

test("blank wording is not wording", () => {
  // '' and NULL must mean the same thing here for the same reason they must in the
  // uniqueness key: two ways of saying "nothing" is one way of getting two rows.
  assert.match(factSentence(fact({ statement: "   " })), /was filmed at Alnwick Castle\.$/);
});

// --- the template, for the sources that hand over a triple and nothing else -----

test("each relation gets a verb it actually earns", () => {
  assert.equal(
    factSentence(fact({ relation_kind: "narrative_location" })),
    "Harry Potter and the Philosopher's Stone is set at Alnwick Castle.",
  );
  assert.equal(
    factSentence(fact({ subject_type: "creator", subject_name: "J. K. Rowling", relation_kind: "lived_here" })),
    "J. K. Rowling lived at Alnwick Castle.",
  );
});

test("a replica says what it is instead of claiming a shoot", () => {
  // The trolley in the wall at King's Cross is on a concourse; the films used platforms
  // 4 and 5. "Filmed here" about it is the confident false claim the grounding rule
  // exists to stop, and it is worse than an imprecise pin because nothing looks wrong.
  const sentence = factSentence(fact({
    relation_kind: "replica",
    name: "Platform 9¾ trolley",
  }));
  assert.match(sentence, /built for visitors/);
  assert.match(sentence, /was not filmed there/);
});

test("an unmapped relation states the connection and invents no verb", () => {
  const sentence = factSentence(fact({ relation_kind: "some_future_kind" }));
  assert.equal(sentence, "Alnwick Castle is connected with Harry Potter and the Philosopher's Stone.");
});

test("the payload qualifies the sentence rather than rewriting it", () => {
  assert.equal(
    factSentence(fact({
      subject_name: "Abbey Road",
      name: "Abbey Road Studios",
      relation_kind: "recorded_at",
      about: "Let It Be",
      stated_year: 1969,
    })),
    "Abbey Road was recorded at Abbey Road Studios — Let It Be (1969).",
  );
});

test("a half-known fact produces no sentence at all", () => {
  // Half a sentence reads like a fact. Nothing reads like nothing.
  assert.equal(factSentence(fact({ subject_name: null })), null);
  assert.equal(factSentence(fact({ name: null })), null);
  assert.equal(factSentence(null), null);
});

test("a year that is not a year is not printed", () => {
  assert.equal(factSentence(fact({ stated_year: "" })), "Harry Potter and the Philosopher's Stone was filmed at Alnwick Castle.");
  assert.equal(factSentence(fact({ stated_year: 0 })), "Harry Potter and the Philosopher's Stone was filmed at Alnwick Castle.");
});

// --- distance: what a route may contain ----------------------------------------

test("the work's own places are distance 0", () => {
  assert.equal(factDistance(fact({ relation_kind: "filming_location" })), DISTANCE_SELF);
  assert.equal(factDistance(fact({ relation_kind: "recorded_at" })), DISTANCE_SELF);
});

test("a fact about a person is distance 1 whichever table it lives in", () => {
  // creator_place_links is the right home; author_place hanging off a work_id is the
  // shape that existed before it, and it is a fact about a person either way.
  assert.equal(factDistance(fact({ subject_type: "creator", relation_kind: "lived_here" })), DISTANCE_PERSON);
  assert.equal(factDistance(fact({ subject_type: "work", relation_kind: "author_place" })), DISTANCE_PERSON);
});

test("inspiration is distance 2 even when it is filed against the work", () => {
  // Thomas Riddell's grave gave a character its name; Harry Potter does not happen in
  // Greyfriars Kirkyard. This is the boundary that stops "Harry Potter places" from
  // becoming "places connected to anything Rowling ever touched".
  assert.equal(factDistance(fact({ relation_kind: "inspiration_for" })), DISTANCE_INFLUENCE);
  assert.equal(
    factDistance(fact({ subject_type: "creator", relation_kind: "inspiration_for" })),
    DISTANCE_INFLUENCE,
  );
});

test("a route takes 0 and 1 and stops there", () => {
  assert.equal(MAX_ROUTABLE_DISTANCE, DISTANCE_PERSON);
  assert.equal(isRoutableFact(fact({ relation_kind: "filming_location" })), true);
  assert.equal(isRoutableFact(fact({ subject_type: "creator", relation_kind: "lived_here" })), true);
  assert.equal(isRoutableFact(fact({ relation_kind: "inspiration_for" })), false);
});

test("a distance the database already computed is trusted over the local rule", () => {
  // work_facts() returns it; re-deriving would make the client the second opinion on a
  // question the schema answers.
  assert.equal(isRoutableFact({ distance: 2, relation_kind: "filming_location" }), false);
  assert.equal(isRoutableFact({ distance: 0, relation_kind: "inspiration_for" }), true);
});

test("each distance is introduced differently, so 2 never reads as a stop", () => {
  assert.notEqual(distanceLabel(DISTANCE_SELF), distanceLabel(DISTANCE_PERSON));
  assert.notEqual(distanceLabel(DISTANCE_PERSON), distanceLabel(DISTANCE_INFLUENCE));
  assert.match(distanceLabel(DISTANCE_INFLUENCE), /nearby/i);
});
