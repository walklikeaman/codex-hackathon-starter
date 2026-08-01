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
  chooseCandidate,
  groupByName,
  MAX_NAMES_PER_QUERY,
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
    const batches = batched(Array.isArray(names) ? names : []);

    for (const [index, batch] of batches.entries()) {
      const query = buildGeocodeQuery(batch);
      if (!query) continue;

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
        continue;
      }

      if (!response.ok) {
        // A timeout and a rate limit mean opposite things; the plan says which.
        const plan = retryPlan(response.status);
        onNote(`geocoder ${response.status} → ${plan.action}`);
        if (plan.waitMs > 0) await sleep(plan.waitMs);
        continue;
      }

      const payload = await response.json().catch(() => null);
      const grouped = groupByName(payload?.results?.bindings);
      for (const name of batch) {
        resolved.set(name, chooseCandidate(grouped.get(normalizePlaceName(name)) ?? [], { near }));
      }

      // Pace only BETWEEN queries. A single batch — the common case for a handful of
      // names — costs nothing extra, which is what makes this usable inside a request.
      if (index < batches.length - 1) await sleep(QUERY_GAP_MS);
    }

    return resolved;
  };
}
