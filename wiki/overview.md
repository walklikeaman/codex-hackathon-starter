# GloryMap — обзор проекта

Синтез на 22.07.2026, после полного прочтения кода (89 тестов, ~4400 строк без
фронта). Продукт: [[glorymap-app]] — карта реальных мест из твоих любимых
фильмов, сериалов и книг; из личной коллекции строится пеший «стори-маршрут».
Бренд: SceneMap → **GloryMap** (PR #31; внутренние имена и localStorage-ключи
`scenemap-*` намеренно сохранены).

## Как это работает (один абзац)

Клиент — один большой Leaflet-компонент [[frontend]]. Он ходит в 7 серверных
роутов [[api-layer]]: город геокодится через Nominatim, локации ищутся живьём
в [[wikidata]] (P915 «место съёмки» / P840 «место действия»), при скудном
результате доисследуются через OpenAI web_search с обязательной проверкой
источников ([[location-discovery]]). Личная библиотека импортируется из
Letterboxd ZIP / IMDb CSV и живёт только в браузере ([[personal-library]]).
Кадр фильма для локации подбирает vision-модель со строгим порогом уверенности
([[film-imagery]]). Маршрут строит OSRM, туры по бюджету времени и аудиогид —
[[tours-and-voice]]. «Что рядом» — [[nearby-geolocation]].

## Ключевые факты, которые легко забыть

- **Supabase в рантайме НЕ используется** — данные не персистятся, всё живое
  из Wikidata + кэши Next/CDN. Схема `locations`/`scenes` существует, но пуста
  ([[supabase]]).
- Демо-фолбэк: пока `/api/locations` не ответил, карта показывает 10
  захардкоженных лондонских точек — приложение никогда не пустое.
- Прод-деплой — **ручной** через GitHub Actions gate; мерж в main даёт только
  staging-preview ([[deployment-pipeline]]).
- UI строго англоязычный (контракт после ревью PR #13).
- Модели: `gpt-5.6-terra` (туры), `gpt-5-mini` (vision-матчинг кадров),
  `gpt-4o-mini-tts` (голос), web_search — `gpt-5.6` ([[openai]]).

## Карта знаний

- Сущности: [[frontend]] · [[api-layer]] · [[wikidata]] · [[openai]] ·
  [[external-services]] · [[supabase]] · [[deployment-pipeline]] · [[team]]
- Концепты: [[demo-path]] · [[personal-library]] · [[location-discovery]] ·
  [[film-imagery]] · [[tours-and-voice]] · [[nearby-geolocation]] ·
  [[testing-conventions]]
- Источники: [[personal-collections-matrix]] ·
  `Context/brief-scenemap-design.md` · `.planning/codebase/` (7 док-справок)
