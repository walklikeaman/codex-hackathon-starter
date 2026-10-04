import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSuggestions, saveSuggestions, SUGGESTION_STATUS, SUGGESTIONS_KEY, suggestionStatusLabel, validateSuggestion,
} from "../app/lib/suggestions.mjs";

const good = { place: " Leadenhall Market ", work: "Harry Potter", scene: "Diagon Alley", lat: 51.51278, lng: -0.08347, sourceUrl: "https://example.com/hp" };

test("a complete suggestion is saved here, and says it is not under review", () => {
  const { suggestion, errors } = validateSuggestion(good, { now: 1000 });
  assert.equal(errors, undefined);
  assert.equal(suggestion.place, "Leadenhall Market");
  assert.equal(suggestion.status, SUGGESTION_STATUS.savedHere);
  assert.equal(suggestion.at, 1000);
  assert.match(suggestionStatusLabel(suggestion.status), /not open yet/);
});

test("each missing or bad field is named, so the form can say what to fix", () => {
  const { errors } = validateSuggestion({ place: "x", work: "", lat: 0, lng: 0, sourceUrl: "javascript:alert(1)" });
  assert.deepEqual(Object.keys(errors).sort(), ["place", "position", "sourceUrl", "work"]);
  assert.ok(validateSuggestion({ ...good, sourceUrl: "" }).suggestion, "a source is optional");
  assert.ok(validateSuggestion({ ...good, lat: 95 }).errors.position);
});

test("suggestions survive a reload, and broken storage reads as none", () => {
  const values = {};
  const storage = { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
  const { suggestion } = validateSuggestion(good);
  saveSuggestions(storage, [suggestion]);
  assert.deepEqual(loadSuggestions(storage), [suggestion]);
  assert.deepEqual(loadSuggestions({ getItem: () => "{oops" }), []);
  assert.deepEqual(loadSuggestions({ getItem: () => JSON.stringify([{ place: "no id" }]) }), []);
  assert.equal(SUGGESTIONS_KEY, "scenemap-suggestions");
});
