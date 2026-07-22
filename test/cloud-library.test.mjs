import test from "node:test";
import assert from "node:assert/strict";
import { loadCloudLibrary, normalizeCloudLibrary, saveCloudLibrary } from "../app/lib/cloud-library.mjs";

function mockClient({ movies = null, error = null } = {}) {
  const calls = [];
  const builder = {
    select() { calls.push(["select"]); return builder; },
    eq(column, value) { calls.push(["eq", column, value]); return builder; },
    async maybeSingle() { return { data: movies === null ? null : { movies }, error }; },
    async upsert(value, options) { calls.push(["upsert", value, options]); return { error }; },
  };
  return { calls, from(table) { calls.push(["from", table]); return builder; } };
}

test("normalizes an account library and rejects malformed records", () => {
  const library = normalizeCloudLibrary([
    { id: "letterboxd:heat:1995", title: " Heat ", year: 1995, rating: 4.5, sources: ["letterboxd", "unknown"] },
    { title: "" },
    null,
  ]);

  assert.equal(library.length, 1);
  assert.equal(library[0].title, "Heat");
  assert.deepEqual(library[0].sources, ["letterboxd"]);
});

test("loads only the signed-in user's library row", async () => {
  const client = mockClient({ movies: [{ title: "Arrival", year: 2016, sources: ["letterboxd"] }] });
  const library = await loadCloudLibrary(client, "user-123");

  assert.equal(library[0].title, "Arrival");
  assert.deepEqual(client.calls.slice(0, 3), [
    ["from", "user_media_libraries"],
    ["select"],
    ["eq", "user_id", "user-123"],
  ]);
});

test("upserts a normalized library under the signed-in user id", async () => {
  const client = mockClient();
  await saveCloudLibrary(client, "user-123", [{ title: "Heat", year: 1995, sources: ["imdb"] }]);

  const upsert = client.calls.find(([operation]) => operation === "upsert");
  assert.equal(upsert[1].user_id, "user-123");
  assert.equal(upsert[1].movies[0].title, "Heat");
  assert.deepEqual(upsert[2], { onConflict: "user_id" });
});
