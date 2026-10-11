// The first run (#15): four screens on what the map is for, then a deck of works to say
// what the reader cares about.
//
// The deck does not build a second filter beside the library. A work the reader likes,
// already knows or saves goes into the same library an import fills, so "Only my films" —
// which the deck switches on — is what makes the choices filter the map. "Not interested"
// is remembered so the card is not dealt again, and changes nothing else.

import { RATING_SCALE } from "./media-sources.mjs";

export const ONBOARDING_KEY = "scenemap-onboarding";

export const INTRO = Object.freeze([
  { id: "map", title: "A map of stories", text: "Every pin is a place where a film, series or book happened — filmed there, or set there." },
  { id: "nearby", title: "What is near you", text: "“What’s nearby?” shows the stories within a walk of where you stand." },
  { id: "tours", title: "Walk it as a tour", text: "Put places on a route, or let the map plan a walk for the time you have — in story order or the short way." },
  { id: "checkins", title: "Check in where it happened", text: "Tap “I’m here” at a place to record the visit, earn Glory and fill your collection." },
]);

export const CHOICE = Object.freeze({ like: "like", skip: "skip", known: "known", saved: "saved" });

// What the four answers are called on the buttons, and which way a card is swiped for each.
export const CHOICES = Object.freeze([
  { id: CHOICE.skip, label: "Not interested", swipe: "left", key: "ArrowLeft" },
  { id: CHOICE.saved, label: "Save for later", swipe: "down", key: "ArrowDown" },
  { id: CHOICE.known, label: "Already know it", swipe: "up", key: "ArrowUp" },
  { id: CHOICE.like, label: "Like", swipe: "right", key: "ArrowRight" },
]);

const INTERESTED = new Set([CHOICE.like, CHOICE.known, CHOICE.saved]);

export function emptyOnboarding() {
  return { done: false, decisions: {} };
}

export function loadOnboarding(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ONBOARDING_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const decisions = Object.fromEntries(Object.entries(parsed.decisions ?? {})
      .filter(([, decision]) => decision && Object.values(CHOICE).includes(decision.choice) && decision.title));
    return { done: parsed.done === true, decisions };
  } catch {
    return null;
  }
}

export function saveOnboarding(storage, state) {
  try {
    storage?.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    // Refused storage: the choices last for this visit only.
  }
}

// Shown by itself only to somebody new: no record of a first run, and nothing in any
// library on this device. A reader with 2,422 imported films has told the map already.
export function shouldOfferOnboarding(record, storedLibraryCount) {
  return record === null && !(storedLibraryCount > 0);
}

// Films and series by fame, as the server sent them, with a book dealt every sixth card
// so the deck is not all one kind of story.
export function orderDeck(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const books = list.filter((card) => card.kind === "book");
  const screen = list.filter((card) => card.kind !== "book");
  const deck = [];
  for (const card of screen) {
    deck.push(card);
    if (deck.length % 6 === 5 && books.length) deck.push(books.shift());
  }
  return [...deck, ...books];
}

export function remainingCards(cards, state) {
  return (Array.isArray(cards) ? cards : []).filter((card) => !state?.decisions?.[card.id]);
}

export function decide(state, card, choice, now = Date.now()) {
  if (!card?.id || !Object.values(CHOICE).includes(choice)) return state;
  return {
    ...state,
    decisions: { ...state.decisions, [card.id]: { choice, title: card.title, year: card.year ?? null, kind: card.kind ?? null, at: now } },
  };
}

export function undoLast(state) {
  const last = Object.entries(state?.decisions ?? {}).sort((left, right) => right[1].at - left[1].at)[0];
  if (!last) return state;
  const decisions = { ...state.decisions };
  delete decisions[last[0]];
  return { ...state, decisions };
}

// The entries the library takes: the same shape an import produces, unrated, from
// "interests" — so they merge, match the catalogue and filter the map like any other.
export function libraryFromDecisions(state) {
  return Object.entries(state?.decisions ?? {})
    .filter(([, decision]) => INTERESTED.has(decision.choice))
    .map(([id, decision]) => ({
      id: `interests:${id}`,
      title: decision.title,
      year: decision.year,
      rating: null,
      ratingScale: RATING_SCALE,
      imdbId: null,
      sources: ["interests"],
    }));
}

// A drag that went far enough, in the direction it mostly went; null for a nudge.
export const SWIPE_THRESHOLD_PX = 90;

export function choiceForSwipe(dx, dy, threshold = SWIPE_THRESHOLD_PX) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < threshold) return null;
  const direction = Math.abs(x) >= Math.abs(y) ? (x > 0 ? "right" : "left") : (y < 0 ? "up" : "down");
  return CHOICES.find((choice) => choice.swipe === direction).id;
}
