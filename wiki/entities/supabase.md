# Supabase — auth и облачные библиотеки (с 22.07 вечера)

ОБНОВЛЕНО: после PR #42/#43 Supabase используется рантаймом — **Supabase Auth**
(Google/Facebook OAuth, кнопка Login with Google на главном экране) и
**облачное хранение личной библиотеки** (нормализованный JSON, user-scoped
RLS; гостевые импорты остаются локальными и мёржатся после логина —
[[personal-library]]). Локации по-прежнему НЕ персистятся — живые из
[[wikidata]] с кэшами Next/CDN.

## Что существует

- Общий проект команды `codex-hackathon`, ref `quvxxqxowathrcyshhwj`,
  регион Frankfurt. URL + anon-ключ вкоммичены в `.env.example`
  (намеренно: публичны по дизайну, защита — RLS; НЕ утечка).
- Миграция `scenemap_initial_schema` (создана владельцем 21.07):
  - `locations` (work_wikidata_id, work_tmdb_id, work_title, work_year,
    kind film|book, loc_wikidata_id, loc_name, lat, lng, commons_image, city;
    уникальность по паре work+loc)
  - `scenes` (location_id → locations, scene_title, description,
    source wikidata|ai)
  - RLS пермиссивный: anon читает и пишет обе таблицы; service_role не нужен.
- Обе таблицы **пусты** — сид Wikidata не запускался: команда выбрала
  живые запросы вместо персистентности.

## Когда пригодится

- Кэш дорогих AI-результатов (описания сцен, vision-матчи) между инстансами —
  сейчас кэш film-image только CDN/in-memory.
- Общие фичи между пользователями (лента, сохранённые маршруты, wishlist).
- Управление — через Supabase MCP владельца или `./setup.sh --infra`.
