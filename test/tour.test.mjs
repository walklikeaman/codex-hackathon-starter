import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompleteTour,
  createTourSchema,
  tourRequestSchema,
} from "../app/lib/tour-schema.mjs";

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

test("accepts a tour request built from live locations", () => {
  const request = tourRequestSchema.parse({
    city: "London",
    film: { id: "Q123", title: "Example Film", year: 2024 },
    locations: [
      {
        id: "Q123-Q456",
        place: "Example Square",
        scene: "Example Film",
        description: "Filming location for Example Film (2024).",
      },
    ],
  });

  assert.equal(request.locations[0].id, "Q123-Q456");
});

test("rejects duplicated location ids in a tour request", () => {
  const location = {
    id: "same-location",
    place: "Example Square",
    scene: "Example Film",
    description: "A known filming location.",
  };

  assert.equal(tourRequestSchema.safeParse({
    city: "London",
    film: { id: "Q123", title: "Example Film", year: null },
    locations: [location, location],
  }).success, false);
});
