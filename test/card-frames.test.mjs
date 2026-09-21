import assert from "node:assert/strict";
import test from "node:test";

import { cardFrameRow, payloadFromStored, storedFrameIsCurrent } from "../app/lib/card-frames.mjs";

const PAIR = { work_id: "w", place_id: "p", place_name: "Somewhere", linked: true, file_path: null };
const frame = (path, description = "Visible arcade columns match the place.") => ({
  file_path: path, description, location_type: "street",
});

test("a batch frame counts whatever the card's matcher version is", () => {
  const batch = { file_path: "/a.jpg", evidence: "Iron arcade and glass roof visible.", method: "enrich_scene_match", matcher_version: null };
  assert.equal(storedFrameIsCurrent(batch, { matcherVersion: "4" }), true);
  assert.equal(storedFrameIsCurrent({ ...batch, method: "film_image", matcher_version: "3" }, { matcherVersion: "4" }), false);
  assert.equal(storedFrameIsCurrent({ ...batch, method: "film_image", matcher_version: "4" }, { matcherVersion: "4" }), true);
});

test("nothing half-recorded is served as an answer", () => {
  assert.equal(storedFrameIsCurrent(null, { matcherVersion: "4" }), false);
  assert.equal(storedFrameIsCurrent({ ...PAIR }, { matcherVersion: "4" }), false);
  assert.equal(storedFrameIsCurrent({ file_path: "not a path", evidence: "long enough evidence" }, { matcherVersion: "4" }), false);
  assert.equal(storedFrameIsCurrent({ file_path: "/a.jpg", evidence: "short" }, { matcherVersion: "4" }), false);
});

test("a row says why it was not written", () => {
  assert.equal(cardFrameRow(null, [frame("/a.jpg")], { matcherVersion: "4" }).reason, "not_in_graph");
  assert.equal(cardFrameRow({ ...PAIR, linked: false }, [frame("/a.jpg")], { matcherVersion: "4" }).reason, "not_linked");
  assert.equal(cardFrameRow({ ...PAIR, file_path: "/x.jpg" }, [frame("/a.jpg")], { matcherVersion: "4" }).reason, "already_recorded");
  assert.equal(cardFrameRow(PAIR, [frame("/a.jpg", "tiny")], { matcherVersion: "4" }).reason, "no_evidence");
});

// The database allows two gallery frames; three verified frames is one primary and two.
test("the first usable frame is THE frame and the gallery is capped", () => {
  const { row } = cardFrameRow(PAIR, [
    frame("/bad path"), frame("/a.jpg"), frame("/b.jpg"), frame("/c.jpg"), frame("/d.jpg"),
  ], { matcherVersion: "4" });
  assert.equal(row.file_path, "/a.jpg");
  assert.deepEqual(row.also.map((entry) => entry.file_path), ["/b.jpg", "/c.jpg"]);
  assert.equal(row.method, "film_image");
  assert.equal(row.matcher_version, "4");
});

test("a stored row reads back as the payload the card already understands", () => {
  const payload = payloadFromStored({
    ...PAIR, file_path: "/a.jpg", evidence: "Iron arcade and glass roof visible.",
    location_type: null, also: [{ file_path: "/b.jpg", evidence: "no" }],
  }, { tmdbId: "185" });
  assert.equal(payload.frames.length, 1, "a gallery entry without evidence is dropped");
  assert.equal(payload.frames[0].location_type, "other");
  assert.equal(payload.source_url, "https://www.themoviedb.org/movie/185/images/backdrops");
  assert.equal(payload.image_url, "https://image.tmdb.org/t/p/w780/a.jpg");
});
