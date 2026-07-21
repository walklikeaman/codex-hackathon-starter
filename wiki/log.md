# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-07-21] incident | First Vercel deploy targeted production

- Ветка `feature/scenemap-skeleton` запушена с commit `dd17ac7`; локальный и Vercel builds зелёные.
- Первый `vercel deploy --yes` после создания проекта неожиданно получил target `production`, хотя команда запускалась без `--prod`; deployment Ready и отвечает HTTP 200 на `https://codex-hackathon-starter-lac.vercel.app`.
- GitHub Login Connection в Vercel не настроен, поэтому автоматическая Git-интеграция не подключилась; ручной CLI deploy сработал. В guardrails добавлен явный `--target=preview` для новых проектов.

## [2026-07-21] update | SceneMap skeleton slice 1

- Зафиксирован brief в `Context/brief-scenemap-design.md` и заполнен блок «Проект» в `AGENTS.md`.
- Собран первый срез MVP: тёмная Leaflet-карта Лондона, 10 hardcoded film-location pins, карточка локации, список точек и локальная линия маршрута после добавления 3 stops.
- Supabase-схема и таблицы не создавались; следующий срез — контракт данных + seed/API.
