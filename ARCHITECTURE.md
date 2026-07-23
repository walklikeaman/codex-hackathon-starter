# 🏛️ GloryMap Architecture — the grounded content-to-map engine

> **Thesis.** GloryMap is a map of everything that happens in the content you
> love — films, series, books, music — where **every point is backed by a source,
> never invented by a model**. Shot on a real street → we find the exact place
> (and can guess it from the frame). Shot on a soundstage → we honestly mark
> "studio, and here's the studio on the map." Fictional (Hogwarts, Middle-earth)
> → flagged as fiction, never falsely geocoded. From that foundation come walking
> tours, recreate-the-shot, and an ambient audio guide that narrates a place as
> you approach it.

This document is the **north star** for how the pieces fit. It resolves the data
model, names the spine, and gives a build order. It supersedes scattered notes;
the phased feature list lives in [`ROADMAP.md`](ROADMAP.md), the running log in
[`wiki/log.md`](wiki/log.md).

---

## 1. Layered overview

```text
                         ┌─────────────────────────────────────────┐
   Import connectors ───▶│  Content graph (SHARED knowledge cache)  │
   Letterboxd/IMDb/…     │  creators · works · scenes · places ·    │
   Trakt · Goodreads ·   │  work_place_links · place_evidence       │◀── the ONE
   Kinopoisk · Last.fm   │  (+ user_library_items = per-user JOIN)   │    source of truth
                         └───────────────┬──────────────────────────┘
                                         │  writes: service_role only
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                 ▼
┌───────────────────┐        ┌────────────────────────┐        ┌────────────────────┐
│ Location          │        │ Map read layer         │        │ Ambient audio /    │
│ Resolution Engine │──fills▶│ map_points (proj.) +    │──feeds▶│ geo-runtime        │
│ (the SPINE)       │        │ PostGIS cluster/KNN RPC │        │ walk mode + TTS    │
└───────────────────┘        └────────────────────────┘        └────────────────────┘
        │  grounding-first, staged cascade                         reads place_class
        ▼
  Wikidata · web_search(cited) · GeoCLIP · Mapillary/Commons · OpenAI vision
```

Everything a user sees on the map is a **projection of the graph**, filtered
through `user_library_items` ("my library") — not a separate per-user copy.

---

## 2. Foundational decisions (lock these BEFORE writing subsystems)

The five architects each invented their own "place" table, `place_class` enum,
and confidence formula. That drift is the #1 risk. Decide once:

1. **One canonical data model.** A normalized `places` (one row per *real place*)
   + `work_place_links` (edges work↔place) + **one** `place_evidence` ledger.
   `map_points` and any per-work candidate table are **read projections /
   materialized views**, never sources of truth. This is the only way "one place
   shared by many works" dedup works without rewriting three subsystems.
2. **One classification vocabulary.** A single column `place_class` with a single
   enum: `real_exterior | real_interior | studio_interior | fictional |
   narrative_real | unknown`. Every subsystem reads this one field. Detection is
   by Wikidata **P31 BFS**, never by name-matching.
3. **One provenance ledger + one confidence function + one map threshold.**
   Per-edge grain, one aggregator (noisy-OR), fixed method priors, one visibility
   threshold — all in `app/lib/grounding.mjs`, imported everywhere. No per-feature
   copies.
4. **The graph is globally SHARED.** "My library" is a JOIN through
   `user_library_items`, **not** an `owner_user_id` on points. Writes to graph
   tables are **service_role only**; per-user RLS lives solely on
   `user_library_items`. This fixes RLS and query shape everywhere.
5. **Persisted-first is the runtime read path.** Consciously reverse the old
   "Supabase is not used at runtime" note ([[supabase]] wiki). Live `/api/locations`
   stays only for ad-hoc search with **write-through** into the graph. Consequence:
   the ambient audio subsystem reads `place_class` from the persisted layer — it
   cannot stay live, or it can't tell a studio/fiction from a street.

---

## 3. The canonical data model

New migration `content_graph` (green-field — the repo has only
`user_media_libraries`; the `locations`/`scenes` tables were applied via MCP but
never committed as a migration, so consolidate them here). Enable `postgis`,
`pg_trgm`, `pgvector`.

```text
creators(id, wikidata_id, name, kind[author|director|artist|band])
works(id, wikidata_id, tmdb_id, imdb_id, isbn, mbid,
      kind[film|series|book|track|album], title, title_norm, year)
work_creators(work_id, creator_id, role)

places(id, wikidata_id?, name, city, country,
       lat, lng,                      -- NULL is legal (fictional / unresolved)
       place_class,                   -- the single enum (decision #2)
       geocode_precision[country|city|street|building|point|none],
       shot_on_set bool,              -- studio/backlot depicts elsewhere
       confidence numeric, confidence_band[verified|candidate|weak],
       centroid geography(Point),     -- PostGIS, GIST-indexed
       frame_embedding vector(512)?)  -- pgvector, lazy-filled

work_place_links(id, work_id, place_id, scene_id?,
                 relation_kind[filming_location|narrative_location|
                               author_place|artist_place|studio_of],
                 confidence, narrative_order?)   -- edge = one work's claim on a place

scenes(id, work_id, sequence_index, act_or_chapter, plot_beat,
       spoiler_tier, is_fictional_setting)       -- first-class → Story Trails (Phase 5)

place_evidence(id, subject_type[place|link|scene], subject_id,
               method[wikidata_statement|wikidata_studio_entity|web_search_cited|
                      geoclip_infer|commons_geosearch|mapillary_match|
                      vision_verify|text_mention|manual_fix],
               source_url?, source_ref?, snippet?, cited_quote?,
               agrees bool?, weight, model?, model_confidence[high|medium|low|none],
               retrieved_at)                      -- 1 row = 1 signal; empty ⇒ not published

user_library_items(user_id, work_id, source[letterboxd|imdb|trakt|…],
                   rating?, added_at)             -- the ONLY per-user, RLS'd table
```

**Invariant:** a place with zero `place_evidence` rows and a NULL coordinate
(except a `fictional` anchor) is **never** emitted to the map — it sits in an
`unresolved` list. The model never writes a coordinate; only sources bring them.

---

## 4. Location Resolution Engine — the spine

`app/lib/location-resolver.mjs` (pure, DI-tested like [[testing-conventions]]),
entry `POST /api/resolve`. A **cheap→expensive cascade with early exit**; each
stage only *appends* evidence, then `fuseCandidates` merges signals per place.

| Stage | What | Cost | When |
|---|---|---|---|
| **0 · Wikidata canonical** | P915 (film/series) / P840 (book) / music places; reuse `buildLocationsSparql`, `normalizeWikidata*` | free | always |
| **1 · Classification** | P31 BFS (reuse `workMatchesTypeGraph`): fictional→Q3895768, studio→Q1107679 + `isStudioLocation`, else real; sets `place_class`, `shot_on_set` | free | always |
| **2 · Web research** | reuse `/api/locations/discover` (citation-gate); only if <3 points | **paid** (web_search) | gated |
| **3 · Image-geolocation** | GeoCLIP-ONNX (0 LLM tokens) on real-exterior frames → coarse GPS *hypothesis* only | free-compute | gated |
| **4 · Grounding** | Mapillary + Commons Geosearch around the guess → vision cross-check (reuse `scene-image-match`) → promote candidate→verified | free + **paid vision** | gated |

**MVP spine = Stage 0 + 1 only** (Wikidata canonical + P31 classification +
persist/dedup). Stages 2–4 are *growth*, and 3+4 must be **one deferred
image→GPS module**, not baked into the backbone and not duplicated.

`fuseCandidates`: cluster evidence by proximity (<50 m, reuse `distanceKm`) → one
place per cluster; `confidence` = noisy-OR with method priors (wikidata 0.9,
studio-entity 0.85, web-cited 0.55, vision +0.3, geoclip-alone 0.2 / corroborated
0.7, manual-fix 0.95) minus a penalty for contradicting evidence. Bands: verified
≥0.75 / candidate 0.4–0.75 / weak <0.4.

---

## 5. Subsystems, mapped onto the spine

- **Content graph & import** — the funnel floor: ID cross-walk
  (tmdb/imdb/isbn/mbid → `wikidata_id`) + connectors (Letterboxd-RSS, Trakt,
  Kinopoisk, Goodreads-RSS, Open Library, Last.fm/MusicBrainz — all free, from
  [[personal-collections-matrix]]) → `user_library_items`. **Music** needs
  `WORK_KIND_CONFIG` extended (today it's only film/series/book) + MusicBrainz
  place path (artist P19, video P915, studio, cover-art via cited web_search).
  **Books** need a text-mention pipeline (NER over public-domain Gutenberg text →
  real streets → Nominatim → evidence with `cited_quote`).
- **Map experience** — PostGIS `map_points` projection + RPC for bbox
  cluster/KNN; canvas render (`L.canvas()` + supercluster) for thousands of
  markers; honest glyph/colour per `place_class`; "this work / whole library"
  layers; a "Remote gems" screen for lone far-away points (car directions, not a
  walk). Zoom-out shows everything in your library.
- **Ambient audio / geo-runtime** — `geo-runtime.mjs` geofence state machine
  (`watchPosition` + Wake Lock, foreground-only on web; Capacitor for true
  background is *later*), streaming + cached TTS, offline bundle. Reads
  `place_class` from the graph to decide whether a point is worth narrating.
- **Story Trails (Phase 5)** — needs first-class `scenes` + `narrative_order`;
  builds **last**, only after the schema is fixed.

---

## 6. Free-tier plan (and the two places you'll pay)

**Free:** Wikidata SPARQL/Entity API · OSM Nominatim (1 req/s) + OSRM · Mapillary
Graph API (CC-BY-SA, hotlink by `image_id`) · Wikimedia Commons Geosearch · **GeoCLIP**
(MIT, 0 tokens, ONNX in the JS stack) · Wikipedia REST summary · Supabase Free
(500 MB DB, 50k MAU, PostGIS+pgvector+pg_trgm included) · Vercel Hobby · browser
Geolocation/Wake-Lock/Cache-Storage.

**You will pay for exactly two things**, so gate + cache both:
1. **OpenAI web_search** (Stage 2) — queue with a daily token budget; only for
   library works with <3 points.
2. **OpenAI vision** (Stage 4 verify) + **TTS** (ambient) — HMAC-gated, cached by
   content hash.

**Watch-outs:** `vector(512)` ≈ 2 KB → ~250k embeddings fills 500 MB (first paid
step: Supabase Pro $25); count embeddings *and* rows against the same budget.
**Supabase Free pauses after 7 days idle** — a real demo-killer; keep a heartbeat
or upgrade before a showing.

---

## 7. Build order

- **Step 0 (blocker):** the single `content_graph` migration — canonical
  `places` + `work_place_links` + one `place_evidence` + one `place_class` enum +
  `grounding.mjs`. Nothing else can be written correctly until this exists.
- **Step 1:** ID cross-walk + import connectors + `user_library_items` (the
  funnel floor; none of this code exists yet).
- **Step 2:** spine MVP = resolver Stage 0/1 + persist/dedup into the graph.
- **Step 3:** `/api/locations` returns `place_class`+confidence+evidence inline;
  map read RPC (bbox/cluster/KNN) + canvas render read from the graph, not live
  SPARQL.
- **Step 4 (growth, gated):** web_search Stage 2 (budgeted queue), then the
  single deferred GeoCLIP + Mapillary/Commons grounding module.
- **Step 5:** ambient audio reads `place_class` from the graph + TTS cache/offline.
- **Step 6 (last):** Story Trails on first-class `scenes` + `narrative_order`.

---

## 8. Have vs. Need

| Capability | Have today | Need to add |
|---|---|---|
| Wikidata locations (P915/P840) | ✅ `location-search.mjs` | reuse as Stage 0 |
| P31 type validation | ✅ `workMatchesTypeGraph` | reuse as Stage 1 classifier |
| Web research with citations | ✅ `/api/locations/discover` | move behind a budgeted queue |
| Vision frame match + HMAC gate | ✅ `scene-image-match` / `scene-match-token` | reuse for Stage 4 |
| Library import (CSV/ZIP) | ✅ `media-library` / `letterboxd-archive` | + nickname connectors, ID cross-walk |
| Cloud library + auth | ✅ `user_media_libraries` + RLS | → `user_library_items` shape |
| Canonical graph + provenance ledger | ❌ | **Step 0 migration** |
| `place_class` studio/fiction distinction | ❌ | Stage 1 + one enum |
| Image→GPS (GeoCLIP) | ❌ | one deferred module (Stage 3/4) |
| Music path | ❌ (kinds = film/series/book) | MusicBrainz + `WORK_KIND_CONFIG` |
| Book text-mention → street | ❌ | Gutenberg NER pipeline |
| Map: thousands of markers | ⚠️ DOM markers | PostGIS RPC + canvas cluster |
| Ambient GPS narration | ⚠️ nearby + VoiceGuide parts | `geo-runtime` geofence + walk mode |
| Story Trails | ❌ | first-class `scenes` (Step 6) |

The current app already contains most of Stage 0/1 and the vision/grounding
primitives — the missing piece is the **canonical graph with a provenance ledger**
that ties them together and makes "never invent a place" a schema-level invariant.
