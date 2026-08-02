// The network half of the Wikidata geocoder.
//
// `geocode-wikidata.mjs` stays pure — it builds queries and chooses between candidates
// with no I/O, which is why its decisions are cheap to test. This module is the part
// that actually talks to WDQS, and it exists so the enrichment script and the discovery
// route resolve names the SAME way. Two implementations of "turn a name into a point"
// would drift, and the one that drifted would be the one inventing coordinates.
//
// Injected `fetchImpl` and `sleep` keep the tests offline and instant.

import {
  buildGeocodeQuery,
  gazetteerName,
  chooseCandidate,
  groupByName,
  MAX_NAMES_PER_QUERY,
  MAX_BACKOFF_ATTEMPTS,
  MAX_SHRINK_DEPTH,
  QUERY_GAP_MS,
  retryPlan,
  WIKIDATA_SPARQL,
} from "./geocode-wikidata.mjs";
import { normalizePlaceName } from "./place-dedup.mjs";
import { USER_AGENT } from "./wikipedia-source.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function batched(names) {
  const batches = [];
  for (let i = 0; i < names.length; i += MAX_NAMES_PER_QUERY) {
    batches.push(names.slice(i, i + MAX_NAMES_PER_QUERY));
  }
  return batches;
}

export function createGeocoder({ fetchImpl = fetch, sleep = wait, onNote = () => {} } = {}) {
  // Resolve a list of place names to coordinates. Returns a Map from the name that was
  // asked for to a decision — `{ place, reason }` — where `place` may be null. A refusal
  // is a result, not an error: a name we cannot place is dropped by the caller rather
  // than given a plausible-looking point.
  //
  // `near` is the enclosing area the caller already knows about — the city the user is
  // looking at. It is the only thing allowed to break a homonym tie, and it comes from
  // the request rather than from a model.
  return async function geocodeNames(names, { near = null } = {}) {
    const resolved = new Map();

    // Ask the gazetteer the question it can answer, and report under the name the
    // caller used. Several prose names can reduce to one lookup.
    const asked = new Map();
    for (const original of Array.isArray(names) ? names : []) {
      const lookup = gazetteerName(original);
      if (!lookup) continue;
      if (!asked.has(lookup)) asked.set(lookup, []);
      asked.get(lookup).push(original);
    }

    // Ask about one batch, and then act on what the failure MEANS.
    //
    // `retryPlan` already distinguished a query that was too heavy from one that came
    // in too fast, and the caller then ignored the distinction and skipped the batch
    // either way — naming the right action without taking it. A 504 says the query
    // overran its budget, and the answer to that is a smaller query. Seen live:
    // sixteen names lost every coordinate to two skipped batches.
    // Two budgets, not one. Halving a heavy query and waiting out a rate limit are
    // answers to different problems, and sharing a counter between them means a single
    // 429 spends the room needed to shrink: seen live, 8 names went 8 → 4 → wait → 4 →
    // 2 and then gave up with splits still available.
    async function resolveBatch(batch, { splits = 0, waits = 0 } = {}) {
      const query = buildGeocodeQuery(batch);
      if (!query) return;

      let response;
      try {
        response = await fetchImpl(WIKIDATA_SPARQL, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ query }),
        });
      } catch (failure) {
        // The geocoder being unreachable must not take the whole request down; every
        // name in this batch simply stays unplaced.
        onNote(`geocoder unreachable: ${failure?.message ?? "network error"}`);
        return;
      }

      if (!response.ok) {
        const plan = retryPlan(response.status);

        if (plan.action === "shrink_batch" && batch.length > 1 && splits < MAX_SHRINK_DEPTH) {
          const half = Math.ceil(batch.length / 2);
          onNote(`geocoder ${response.status} → splitting ${batch.length} names`);
          await sleep(plan.waitMs);
          await resolveBatch(batch.slice(0, half), { splits: splits + 1, waits });
          await sleep(QUERY_GAP_MS);
          await resolveBatch(batch.slice(half), { splits: splits + 1, waits });
          return;
        }

        if (plan.action === "back_off" && waits < MAX_BACKOFF_ATTEMPTS) {
          onNote(`geocoder ${response.status} → waiting ${plan.waitMs / 1000}s`);
          await sleep(plan.waitMs);
          await resolveBatch(batch, { splits, waits: waits + 1 });
          return;
        }

        onNote(`geocoder ${response.status} → ${batch.length} name(s) left unplaced`);
        return;
      }

      const payload = await response.json().catch(() => null);
      const grouped = groupByName(payload?.results?.bindings);
      for (const lookup of batch) {
        const chosen = chooseCandidate(grouped.get(normalizePlaceName(lookup)) ?? [], { near });
        for (const original of asked.get(lookup) ?? [lookup]) resolved.set(original, chosen);
      }
    }

    const batches = batched([...asked.keys()]);
    for (const [index, batch] of batches.entries()) {
      await resolveBatch(batch);
      // Pace only BETWEEN queries. A single batch — the common case for a handful of
      // names — costs nothing extra, which is what makes this usable inside a request.
      if (index < batches.length - 1) await sleep(QUERY_GAP_MS);
    }

    return resolved;
  };
}
