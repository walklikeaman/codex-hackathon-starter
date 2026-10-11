import assert from "node:assert/strict";
import test from "node:test";

import {
  CHOICE, choiceForSwipe, CHOICES, decide, emptyOnboarding, INTRO, libraryFromDecisions, loadOnboarding,
  ONBOARDING_KEY, orderDeck, remainingCards, saveOnboarding, shouldOfferOnboarding, undoLast,
} from "../app/lib/onboarding.mjs";
import { mergeLibraries, workIsInLibrary } from "../app/lib/media-library.mjs";

const film = (id, title, year) => ({ id, title, year, kind: "film" });
const book = (id, title) => ({ id, title, year: 1890, kind: "book" });

test("four short screens: the map of stories, what is near, tours, check-ins", () => {
  assert.deepEqual(INTRO.map((screen) => screen.id), ["map", "nearby", "tours", "checkins"]);
});

test("it opens by itself only for somebody new", () => {
  assert.equal(shouldOfferOnboarding(null, 0), true);
  assert.equal(shouldOfferOnboarding(null, 2422), false, "an imported library has said enough");
  assert.equal(shouldOfferOnboarding(emptyOnboarding(), 0), false, "seen once, even if skipped");
});

test("a book is dealt every sixth card, and none is lost", () => {
  const cards = [...Array.from({ length: 12 }, (_, i) => film(`f${i}`, `F${i}`, 2000)), book("b1", "Dorian Gray"), book("b2", "Dracula")];
  const deck = orderDeck(cards);
  assert.equal(deck.length, 14);
  assert.equal(deck[5].id, "b1");
  assert.equal(deck[11].id, "b2");
});

test("all four answers work, and a decided card is not dealt again", () => {
  const cards = [film("a", "Skyfall", 2012), film("b", "Notting Hill", 1999), film("c", "Paddington", 2014), film("d", "Wonka", 2023)];
  let state = emptyOnboarding();
  for (const [card, choice] of [[cards[0], CHOICE.like], [cards[1], CHOICE.skip], [cards[2], CHOICE.known], [cards[3], CHOICE.saved]]) {
    state = decide(state, card, choice);
  }
  assert.deepEqual(remainingCards(cards, state), []);
  assert.equal(decide(state, cards[0], "maybe"), state, "an unknown answer changes nothing");
});

test("liked, known and saved works join the library and match the map; not interested does not", () => {
  let state = emptyOnboarding();
  state = decide(state, film("a", "Skyfall", 2012), CHOICE.like, 1);
  state = decide(state, film("b", "Notting Hill", 1999), CHOICE.skip, 2);
  state = decide(state, film("c", "Paddington", 2014), CHOICE.saved, 3);
  const entries = libraryFromDecisions(state);
  assert.deepEqual(entries.map((entry) => entry.title).sort(), ["Paddington", "Skyfall"]);
  assert.deepEqual(entries[0].sources, ["interests"]);

  const library = mergeLibraries([], entries);
  assert.equal(workIsInLibrary({ title: "Skyfall", year: 2012 }, library), true);
  assert.equal(workIsInLibrary({ title: "Notting Hill", year: 1999 }, library), false);
});

test("the last answer can be taken back", () => {
  let state = decide(emptyOnboarding(), film("a", "Skyfall", 2012), CHOICE.like, 1);
  state = decide(state, film("b", "Notting Hill", 1999), CHOICE.skip, 2);
  assert.deepEqual(Object.keys(undoLast(state).decisions), ["a"]);
  assert.equal(undoLast(emptyOnboarding()).decisions && true, true);
});

test("the choices survive a reload; broken storage reads as no record", () => {
  const values = {};
  const storage = { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
  const state = { ...decide(emptyOnboarding(), film("a", "Skyfall", 2012), CHOICE.like, 1), done: true };
  saveOnboarding(storage, state);
  assert.deepEqual(loadOnboarding(storage), state);
  assert.equal(loadOnboarding({ getItem: () => "{oops" }), null);
  assert.equal(loadOnboarding({ getItem: () => null }), null);
  assert.deepEqual(loadOnboarding({ getItem: () => JSON.stringify({ done: true, decisions: { x: { choice: "hate", title: "X" } } }) }).decisions, {});
  assert.equal(ONBOARDING_KEY, "scenemap-onboarding");
});

test("a swipe answers by its direction, once it goes far enough", () => {
  assert.equal(choiceForSwipe(120, 10), CHOICE.like);
  assert.equal(choiceForSwipe(-120, 30), CHOICE.skip);
  assert.equal(choiceForSwipe(20, -140), CHOICE.known);
  assert.equal(choiceForSwipe(-10, 130), CHOICE.saved);
  assert.equal(choiceForSwipe(40, -30), null, "a nudge is not an answer");
  assert.deepEqual(CHOICES.map((choice) => choice.key), ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]);
});
