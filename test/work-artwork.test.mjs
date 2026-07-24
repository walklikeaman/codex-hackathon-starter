import assert from "node:assert/strict";
import test from "node:test";

import {
  artworkCandidates,
  artworkFromTmdb,
  artworkUpdates,
  POSTER_SIZES,
  posterUrl,
  tmdbIdFromEntity,
  tmdbPropertyForKind,
} from "../app/lib/work-artwork.mjs";

// External-id claims come back as plain strings, unlike item claims ({id: "Q…"}).
function entityWithTmdb(property, value) {
  return {
    claims: {
      [property]: [{ rank: "normal", mainsnak: { datavalue: { value } } }],
    },
  };
}

test("a film reads P4947 and a series reads P4983 — never each other's", () => {
  // TMDB numbers movies and TV in separate namespaces, so the same integer is a
  // valid id for two different works. The kind must pick the property.
  assert.equal(tmdbPropertyForKind("film"), "P4947");
  assert.equal(tmdbPropertyForKind("series"), "P4983");
  assert.equal(tmdbPropertyForKind("book"), null); // books have no TMDB entry
  assert.equal(tmdbPropertyForKind("nonsense"), null);

  const film = entityWithTmdb("P4947", "37724");
  assert.equal(tmdbIdFromEntity(film, "film"), "37724");
  assert.equal(tmdbIdFromEntity(film, "series"), null); // must not read the movie id
});

test("tmdbIdFromEntity rejects malformed ids instead of guessing", () => {
  for (const bad of ["0", "-5", "abc", "12x", ""]) {
    assert.equal(tmdbIdFromEntity(entityWithTmdb("P4947", bad), "film"), null);
  }
  assert.equal(tmdbIdFromEntity(null, "film"), null);
  assert.equal(tmdbIdFromEntity({}, "film"), null);
});

test("artworkCandidates skips works that cannot possibly have a poster", () => {
  const candidates = artworkCandidates([
    { id: "w1", kind: "film", wikidata_id: "Q4941" },
    { id: "w2", kind: "book", wikidata_id: "Q15228" },   // no TMDB entry at all
    { id: "w3", kind: "film", wikidata_id: null },        // nothing to look up with
    { id: "w4", kind: "series", wikidata_id: "Q192837", tmdb_id: "19885" },
  ]);
  assert.deepEqual(candidates.map((c) => c.workId), ["w1", "w4"]);
  assert.equal(candidates[0].tmdbId, null);      // still needs a Wikidata lookup
  assert.equal(candidates[1].tmdbId, "19885");   // already known, skips the lookup
});

test("artworkFromTmdb accepts only canonical paths", () => {
  assert.deepEqual(
    artworkFromTmdb({ poster_path: "/abc123.jpg", backdrop_path: "/def456.jpg" }),
    { poster_path: "/abc123.jpg", backdrop_path: "/def456.jpg" },
  );
  // A path that isn't canonical must never reach an <img src>.
  assert.deepEqual(
    artworkFromTmdb({ poster_path: "https://evil.example/x.jpg", backdrop_path: "../../etc" }),
    { poster_path: null, backdrop_path: null },
  );
  assert.deepEqual(artworkFromTmdb({}), { poster_path: null, backdrop_path: null });
  assert.deepEqual(artworkFromTmdb(null), { poster_path: null, backdrop_path: null });
});

test("posterUrl builds a keyless CDN url at the requested size", () => {
  assert.equal(posterUrl("/abc.jpg", POSTER_SIZES.thumb), "https://image.tmdb.org/t/p/w185/abc.jpg");
  assert.equal(posterUrl("/abc.jpg"), "https://image.tmdb.org/t/p/w500/abc.jpg");
  assert.equal(posterUrl(null), null);
  assert.equal(posterUrl("not-a-path"), null);
});

test("artworkUpdates never overwrites good artwork with a failed lookup", () => {
  const updates = artworkUpdates([
    { workId: "w1", tmdb_id: "1", poster_path: "/a.jpg", backdrop_path: "/b.jpg" },
    { workId: "w2", tmdb_id: null, poster_path: null, backdrop_path: null }, // found nothing
    null,
  ]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    id: "w1", tmdb_id: "1", poster_path: "/a.jpg", backdrop_path: "/b.jpg",
  });
});

test("a work whose lookup found only an id is still recorded", () => {
  // Knowing the tmdb id is worth saving even when TMDB has no poster yet: the next
  // pass skips the Wikidata call entirely.
  const updates = artworkUpdates([{ workId: "w1", tmdb_id: "42", poster_path: null }]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].tmdb_id, "42");
});
