import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteTour, createTourSchema } from "../app/lib/tour-schema.mjs";

const locationIds = ["first", "second"];

test("accepts a complete tour in any order", () => {
  const tour = createTourSchema(locationIds).parse({
    title: "Test tour",
    intro: "A short introduction",
    stops: [
      { locationId: "second", narration: "Second stop first" },
      { locationId: "first", narration: "First stop second" },
    ],
  });

  assert.equal(assertCompleteTour(tour, locationIds), tour);
});

test("rejects duplicated stops", () => {
  const tour = {
    title: "Broken tour",
    intro: "A short introduction",
    stops: [
      { locationId: "first", narration: "One" },
      { locationId: "first", narration: "Again" },
    ],
  };

  assert.throws(() => assertCompleteTour(tour, locationIds), /incomplete or duplicated/);
});

test("schema rejects unknown location ids", () => {
  assert.throws(() =>
    createTourSchema(locationIds).parse({
      title: "Unknown stop",
      intro: "A short introduction",
      stops: [
        { locationId: "first", narration: "One" },
        { locationId: "invented", narration: "Two" },
      ],
    }),
  );
});
