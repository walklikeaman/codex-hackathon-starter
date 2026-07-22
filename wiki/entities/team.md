# Команда — кто что делает (по git-истории)

Роли в TASKS.md формально не заполнены; фактическое распределение видно по
коммитам (на 22.07.2026):

- **Андрей (GitHub timido22, коммиты как vitebskiy.andrey — судя по всему,
  один человек)** — фактический интегратор (сводит большинство PR в main:
  #27, #29, #32, #34, #35, #36, #39) и бэкенд-качество: живые
  Wikidata-локации, walking routes, scene matching, multi-location search,
  viewport refresh, sourced discovery.
- **Nikita Nakonechnyi / walklikeaman (владелец)** — документация и README
  (Devpost-серия), ребрендинг GloryMap, деплой-гейты, Letterboxd ZIP-импорт;
  владелец Supabase/Vercel-инфраструктуры.
- **ystalinskaya (Илана)** — ветка feature/yana: city search, personal media
  connectors, current-location-to-map.
- Ефим — без доступа к репо (решение владельца 21.07).

GitHub-доступы: walklikeaman (admin), timido22 (write), yanastalin99 (write,
приглашение), gordonefim (write, приглашение).

Правила: ветки `feature/*`, в main — только интегратор через PR
(`TEAMWORK.md`); прод-деплой — ручной гейт ([[deployment-pipeline]]).
