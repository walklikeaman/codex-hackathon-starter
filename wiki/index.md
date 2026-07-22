# Knowledge Base Index

Read this FIRST each session. The wiki is the agent's compounding memory —
decisions, gotchas, and domain knowledge live here so the next session (and the
next teammate) starts smarter, not from zero.

Full rebuild on 22.07.2026 after reading through all the code (89 tests, main
after PR #41). Open the repository as an Obsidian vault — the `[[links]]` form a graph.

## Overview

- [overview.md](overview.md) — synthesis: how everything is wired + facts that are easy to forget

## Entities (what exists)

- [glorymap-app](entities/glorymap-app.md) — the product, the graph hub
- [frontend](entities/frontend.md) — the SceneMapApp + VoiceGuide monolith, patterns and gotchas
- [api-layer](entities/api-layer.md) — 7 BFF routes: contracts, timeouts, caches
- [wikidata](entities/wikidata.md) — P915/P840/P4947, SPARQL, limits, gotchas
- [openai](entities/openai.md) — 4 model roles, principles of distrust, incidents
- [external-services](entities/external-services.md) — Nominatim, OSRM, TMDB, Commons
- [supabase](entities/supabase.md) — auth + cloud libraries; locations stay live
- [deployment-pipeline](entities/deployment-pipeline.md) — staging automatically, prod manually
- [team](entities/team.md) — who does what per git history, access rights

## Concepts (how it works)

- [demo-path](concepts/demo-path.md) — the one sacred scenario
- [personal-library](concepts/personal-library.md) — Letterboxd ZIP/CSV, privacy
- [location-discovery](concepts/location-discovery.md) — Wikidata + web research with a citation gate
- [film-imagery](concepts/film-imagery.md) — HMAC token → vision → only high confidence
- [tours-and-voice](concepts/tours-and-voice.md) — route, timed tour, AI tour, TTS
- [nearby-geolocation](concepts/nearby-geolocation.md) — "what's nearby", radii, demo fallback
- [testing-conventions](concepts/testing-conventions.md) — node:test, zero network, DI pattern

## Sources (external knowledge)

- [personal-collections-matrix](sources/personal-collections-matrix.md) —
  where to read personal collections from (research 22.07, verified live) + ideas
  (film stills, "paste your Letterboxd handle")
- [feature-research](sources/feature-research.md) — competitors, APIs and legal
  notes behind `ROADMAP.md` and backlog issues #44–#77
- `Context/brief-scenemap-design.md` — the original product brief
- `.planning/codebase/` — 7 reference documents (ARCHITECTURE, CONCERNS…)
- `wiki/log.md` — the chronicle of decisions (append-only, newest on top)
