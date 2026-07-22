# Knowledge Base Index

Read this FIRST each session. The wiki is the agent's compounding memory —
decisions, gotchas, and domain knowledge live here so the next session (and the
next teammate) starts smarter, not from zero.

Полная перестройка 22.07.2026 по итогам чтения всего кода (89 тестов, main
после PR #41). Открой репозиторий как Obsidian-волт — `[[links]]` образуют граф.

## Overview

- [overview.md](overview.md) — синтез: как всё устроено + факты, которые легко забыть

## Entities (что существует)

- [glorymap-app](entities/glorymap-app.md) — продукт, хаб графа
- [frontend](entities/frontend.md) — монолит SceneMapApp + VoiceGuide, паттерны и грабли
- [api-layer](entities/api-layer.md) — 7 BFF-роутов: контракты, таймауты, кэши
- [wikidata](entities/wikidata.md) — P915/P840/P4947, SPARQL, лимиты, грабли
- [openai](entities/openai.md) — 4 роли моделей, принципы недоверия, инциденты
- [external-services](entities/external-services.md) — Nominatim, OSRM, TMDB, Commons
- [supabase](entities/supabase.md) — создан, но рантаймом НЕ используется
- [deployment-pipeline](entities/deployment-pipeline.md) — staging автоматом, прод вручную
- [team](entities/team.md) — кто что делает по git-истории, доступы

## Concepts (как это работает)

- [demo-path](concepts/demo-path.md) — единственный святой сценарий
- [personal-library](concepts/personal-library.md) — Letterboxd ZIP/CSV, приватность
- [location-discovery](concepts/location-discovery.md) — Wikidata + web-research с гейтом цитат
- [film-imagery](concepts/film-imagery.md) — HMAC-токен → vision → только high confidence
- [tours-and-voice](concepts/tours-and-voice.md) — маршрут, таймированный тур, AI-тур, TTS
- [nearby-geolocation](concepts/nearby-geolocation.md) — «что рядом», радиусы, demo-фолбэк
- [testing-conventions](concepts/testing-conventions.md) — node:test, ноль сети, DI-образец

## Sources (внешнее знание)

- [personal-collections-matrix](sources/personal-collections-matrix.md) —
  откуда читать личные коллекции (ресёрч 22.07, проверено живьём) + идеи
  (кадры фильмов, «вставь ник Letterboxd»)
- `Context/brief-scenemap-design.md` — исходный бриф продукта
- `.planning/codebase/` — 7 справочных документов (ARCHITECTURE, CONCERNS…)
- `wiki/log.md` — летопись решений (append-only, новое сверху)
