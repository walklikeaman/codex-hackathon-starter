import assert from "node:assert/strict";
import test from "node:test";

import {
  NARRATOR_PROFILES,
  narrationText,
  selectNarratorVoice,
} from "../app/lib/voice-guide.mjs";

const location = {
  place: "Example Square",
  film: "Example Film",
  description: "A verified description of the scene.",
};

test("uses the generated story when spoilers are allowed", () => {
  assert.equal(
    narrationText({ location, story: "A short original story.", spoilerFree: false }),
    "A short original story.",
  );
});

test("uses a generic verified-location recap in spoiler-free mode", () => {
  const text = narrationText({ location, story: "The ending is revealed.", spoilerFree: true });

  assert.match(text, /Example Square/);
  assert.match(text, /Example Film/);
  assert.doesNotMatch(text, /ending/);
});

test("offers neutral and original narrator profiles without actor imitation", () => {
  assert.deepEqual(Object.keys(NARRATOR_PROFILES), ["neutral", "archivist"]);
  assert.equal(NARRATOR_PROFILES.neutral.label, "Neutral guide");
  assert.equal(NARRATOR_PROFILES.archivist.label, "Curious archivist");
});

test("selects an alternate English voice for the archivist when available", () => {
  const voices = [
    { name: "Default", lang: "en-GB", default: true },
    { name: "Alternate", lang: "en-US", default: false },
    { name: "French", lang: "fr-FR", default: false },
  ];

  assert.equal(selectNarratorVoice(voices, "neutral").name, "Default");
  assert.equal(selectNarratorVoice(voices, "archivist").name, "Alternate");
});
