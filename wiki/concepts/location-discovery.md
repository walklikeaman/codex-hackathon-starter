# Location search — two paths with an anti-hallucination gate

Both paths are normalized into one location record format with the fields `relation_kind`
(filming_location | narrative_location) and `evidence_source` to distinguish
provenance. Code: `app/lib/location-search.mjs`,
`app/lib/location-discovery-schema.mjs`; routes — [[api-layer]].

## Path 1 — canonical ([[wikidata]])

nearby mode (geo-SPARQL around a point) or work mode (search for the work →
validate the type against the graph P31/P279 → locations via P915/P840). Only this path
emits a scene_match_token for [[film-imagery]] (real Q-ids + TMDB id).

## Path 2 — exploratory ([[openai]] web_search)

Enabled ONLY after a work search, if matched_work is found but there are < 3 locations.
The model searches for up to 5 places in the city; the server hard post-filters:

- `sourceUrl` must canonically match a source that was actually consulted by
  web_search (a Map from `web_search_call` in response.output) —
  anything not cited is dropped;
- outside the city radius — dropped; a duplicate (same name or <50 m) —
  dropped;
- the id is synthetic `web-<slug>-<lat>-<lng>` — not a Q-id, so such locations
  will never get a film still.

## Gotchas

- canonicalUrl strips the hash and the trailing "/", but NOT the query — a source with different
  query parameters won't match and the location will disappear.
- Incident 21.07: `format:"uri"` in the Zod schema → 502 (OpenAI Structured Outputs
  doesn't support it) — URLs in the model schema must be plain strings only.
- The client deduplicates discover results by place name and coordinates
  ±0.0005.
