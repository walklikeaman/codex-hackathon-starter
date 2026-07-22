# Testing conventions — 89 tests, node:test, zero network

Run: `npm test` (`node --test test/*.test.mjs`). No jest/vitest and no
configuration; assert from node:assert/strict. Next.js is not involved in the tests —
the pure module layer is tested.

## Three levels of isolation

1. Most files — pure functions/Zod schemas with no mocks at all.
2. route-api / narration-api — mutate globals (globalThis.fetch,
   process.env) and MUST restore them via context.after.
3. film-image-api — the `createFilmImageHandler` factory with full injection
   (env, fetchImpl, createOpenAIClient, allowRequest, verifyToken) — globals
   are not touched. The preferred pattern for new routes.

## Conventions

- Test names are full invariant phrases ("film image API never falls back to
  a generic backdrop after a matcher error").
- No test hits the network; external responses (SPARQL, TMDB, OSRM, OpenAI)
  are modeled with payloads. Only JSZip and zod actually execute.
- The cross-cutting theme is output safety: host allowlist, canonical id,
  HMAC tokens, rate limit before paid calls, no caching an error as
  no-match ([[film-imagery]]).
- Imports: routes as `.js`, libs as `.mjs` — easy to mix up.

## Gotchas

- `test/fixtures/imdb-ratings.csv` is an orphan, no test reads it
  (CSVs are built inline).
- Expected numbers encode the source rounding exactly (1234 m → 1.2 km) —
  changing the rounding = fixing the tests.
- After `git pull` always `npm install` — new dependencies (openai,
  zod) otherwise crash 3 test files with ERR_MODULE_NOT_FOUND.
