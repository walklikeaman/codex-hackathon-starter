import assert from "node:assert/strict";
import test from "node:test";

import { createDeckHandler, deckCards, deckCenter } from "../app/api/deck/route.js";

test("a card carries the work and a poster sized for the card, or none", () => {
  const [withPoster, without] = deckCards([
    { id: "1", title: "Skyfall", year: 2012, kind: "film", poster_path: "/abc.jpg", places: 9 },
    { id: "2", title: "Dorian Gray", year: null, kind: "book", poster_path: null, places: 3 },
  ]);
  assert.match(withPoster.poster, /^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/abc\.jpg$/);
  assert.equal(without.poster, null);
  assert.deepEqual(Object.keys(withPoster).sort(), ["id", "kind", "nearby", "places", "poster", "title", "year"]);
});

test("the deck answers 503 unconfigured and 502 when the database fails", async () => {
  assert.equal((await createDeckHandler({ createReader: () => null })()).status, 503);
  const failing = createDeckHandler({ createReader: () => ({ deck: async () => { throw new Error("down"); } }), logError: () => {} });
  assert.equal((await failing()).status, 502);
  const ok = createDeckHandler({ createReader: () => ({ deck: async (limit, center) => [{ id: "1", title: `n=${limit} ${JSON.stringify(center)}`, kind: "film" }] }) });
  const body = await (await ok(new Request("http://local/api/deck?lat=51.5094&lng=-0.1183"))).json();
  assert.equal(body.cards[0].title, 'n=60 {"lat":51.5,"lng":-0.1}');
});

test("the centre is rounded to a tenth of a degree, and a bad one deals the world's deck", () => {
  const params = (query) => new URL(`http://local/api/deck?${query}`).searchParams;
  assert.deepEqual(deckCenter(params("lat=51.5094&lng=-0.1183")), { lat: 51.5, lng: -0.1 });
  assert.equal(deckCenter(params("lat=91&lng=0")), null);
  assert.equal(deckCenter(params("lat=abc&lng=1")), null);
  assert.equal(deckCenter(params("")), null);
  assert.equal(deckCenter(null), null);
});
