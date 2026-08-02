# Location search — three paths with an anti-hallucination gate

All paths normalize into one location record with `relation_kind`
(filming_location | narrative_location) and `evidence_source` to distinguish provenance.
Code: `app/lib/location-search.mjs`, `app/lib/location-discovery-schema.mjs`; routes —
[[api-layer]].

**The rule every path obeys: a model may name a place, never locate one.** Names become
points through [[geocoding-cascade]].

## Path 1 — canonical ([[wikidata]])

nearby mode (geo-SPARQL around a point) or work mode (search for the work →
validate the type against the graph P31/P279 → locations via P915/P840). Only this path
emits a scene_match_token for [[film-imagery]] (real Q-ids + TMDB id).

## Path 2 — exploratory ([[openai]] web_search)

Enabled ONLY after a work search, if matched_work is found but there are < 3 locations.
The model searches for up to 5 places in the city and returns **a name and its citation**.
The server then hard post-filters:

- `sourceUrl` must canonically match a source `web_search` actually consulted (a Map built
  from `web_search_call` in `response.output`). Anything uncited is dropped — a remembered
  URL is not evidence.
- The name is geocoded through [[geocoding-cascade]], with the city being viewed passed as
  the `near` hint: "Cambridge" while looking at London is answerable, "Cambridge" on its
  own is refused.
- A refused name is returned under `unplaced` with its reason and is **never plotted**.
  The UI says so — "found three, could place one" and "found one" are different
  statements, and silence read as the wrong one.
- Only then meaningful: outside the city radius — dropped. Same Wikidata entity as
  something already on the map — dropped. Within 50 m of an existing place — dropped.

The id is now the **Q-id**, so a place found by both paths is recognised as one place
however differently the two sources spelled its name. It still gets no film still, but for
a different reason than before: only path 1 emits a scene_match_token.

### What #121 changed, and why it mattered

This path used to ask the model for `lat`/`lng`. Every check below it then validated the
invention rather than the place: the radius test only confirmed the made-up point was
*plausibly located*, the identity string `web-<slug>-<lat>-<lng>` baked it in, and the map
labelled the result "sourced" beside genuinely verified Wikidata places.

A recalled coordinate has no identity, only a position — which is why the same place found
twice used to become two places.

The point now carries its own provenance (`geocode_source`, `geocode_source_id`,
`geocode_reason`) separate from the claim's. The web source said the film shot here;
Wikidata said where here is. Those are different questions, and recording one source for
both makes the coordinate look as researched as the connection.

## Path 3 — Wikipedia prose (#47)

Offline, queued for review, never straight to the map. See [[wikipedia-enrichment]].

## Gotchas

- canonicalUrl strips the hash and the trailing "/", but NOT the query — a source with different
  query parameters won't match and the location will disappear.
- Incident 21.07: `format:"uri"` in the Zod schema → 502 (OpenAI Structured Outputs
  doesn't support it) — URLs in the model schema must be plain strings only.
- `existingLocations` carries an optional `wikidataId`. An older client that omits it
  still gets duplicate protection by distance, just weaker.
- The client deduplicates discover results by place name and coordinates
  ±0.0005.
