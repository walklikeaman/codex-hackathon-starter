# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-07-21] update | Walking-route MVP verified

- Сохранён чёрно-золотой map-first дизайн текущего Vercel deployment; пользовательский интерфейс полностью переведён на английский.
- Добавлен серверный `POST /api/route`, который валидирует 2–5 координат и получает пешую GeoJSON-геометрию у публичного OSRM `routed-foot`.
- Клиент строит маршрут по улицам для 3–5 выбранных точек, показывает расстояние/время и откатывается к прямой линии при недоступности роутера.
- `npm run build`, API contract и desktop/mobile browser flow зелёные; Supabase и production deployment не менялись.
- Vercel Preview `codex-hackathon-starter-b760nc4e5-kitpos.vercel.app` имеет статус Ready и проверен через protection bypass; обычное открытие требует доступ к проекту Vercel.

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
