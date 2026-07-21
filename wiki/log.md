# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-07-21] update | AI-guided film tour

- Добавлен серверный `POST /api/tour`: Responses API с `gpt-5.6-terra` возвращает русскоязычную экскурсию по выбранному фильму через Structured Outputs.
- Модель работает только с проверенными локациями SceneMap; схема и пост-проверка отклоняют неизвестные, пропущенные и повторяющиеся точки.
- UI фильтрует карту до выбранного фильма, показывает AI-рассказ и строит реальный пешеходный маршрут в предложенном порядке; ручной маршрут из 3–5 точек сохранён.
- Проверено: unit-тесты, production build, реальный API-вызов и оба браузерных пути (AI Skyfall и ручной маршрут) прошли успешно.

## [2026-07-21] update | Real walking routes

- Added a server-side proxy to the public OpenStreetMap foot-routing service with validated coordinates, an 8-second timeout, and a clearly labeled straight-line fallback.
- The map now fits and draws the returned street geometry; the route summary uses router distance and duration and includes source attribution.
- Verified with 4 unit tests, a production build, a live API request, and the browser flow from 3 selected stops to a 13.1 km / 174 min London walking route.

## [2026-07-21] incident | First Vercel deploy targeted production

- Ветка `feature/scenemap-skeleton` запушена с commit `dd17ac7`; локальный и Vercel builds зелёные.
- Первый `vercel deploy --yes` после создания проекта неожиданно получил target `production`, хотя команда запускалась без `--prod`; deployment Ready и отвечает HTTP 200 на `https://codex-hackathon-starter-lac.vercel.app`.
- GitHub Login Connection в Vercel не настроен, поэтому автоматическая Git-интеграция не подключилась; ручной CLI deploy сработал. В guardrails добавлен явный `--target=preview` для новых проектов.

## [2026-07-21] update | SceneMap skeleton slice 1

- Зафиксирован brief в `Context/brief-scenemap-design.md` и заполнен блок «Проект» в `AGENTS.md`.
- Собран первый срез MVP: тёмная Leaflet-карта Лондона, 10 hardcoded film-location pins, карточка локации, список точек и локальная линия маршрута после добавления 3 stops.
- Supabase-схема и таблицы не создавались; следующий срез — контракт данных + seed/API.
## [2026-07-21] update | Codebase mapped for GSD initialization

- Created the seven reference documents in `.planning/codebase/`.
- Verified that every document is substantive and contains no detected secret patterns.
- Mapping commit: `734d97e` on `feature/gsd-project-setup`.
