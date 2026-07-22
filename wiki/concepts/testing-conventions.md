# Тестовые конвенции — 89 тестов, node:test, ноль сети

Запуск: `npm test` (`node --test test/*.test.mjs`). Без jest/vitest и
конфигурации; assert из node:assert/strict. Next.js в тестах не участвует —
тестируется чистый модульный слой.

## Три уровня изоляции

1. Большинство файлов — чистые функции/Zod-схемы вообще без моков.
2. route-api / narration-api — мутируют глобалы (globalThis.fetch,
   process.env) и ОБЯЗАНЫ восстанавливать через context.after.
3. film-image-api — фабрика `createFilmImageHandler` с полной инъекцией
   (env, fetchImpl, createOpenAIClient, allowRequest, verifyToken) — глобалы
   не трогаются. Предпочтительный образец для новых роутов.

## Конвенции

- Имена тестов — полные фразы-инварианты («film image API never falls back to
  a generic backdrop after a matcher error»).
- Ни один тест не ходит в сеть; внешние ответы (SPARQL, TMDB, OSRM, OpenAI)
  моделируются payload'ами. Реально исполняются только JSZip и zod.
- Сквозная тема — безопасность выдачи: allowlist хостов, canonical id,
  HMAC-токены, rate limit до платных вызовов, запрет кэшировать ошибку как
  no-match ([[film-imagery]]).
- Импорты: роуты как `.js`, либы как `.mjs` — легко перепутать.

## Грабли

- `test/fixtures/imdb-ratings.csv` — сирота, ни один тест её не читает
  (CSV строятся inline).
- Ожидаемые числа кодируют округление исходников точно (1234 м → 1.2 км) —
  менять округление = чинить тесты.
- После `git pull` обязательно `npm install` — новые зависимости (openai,
  zod) иначе роняют 3 тест-файла с ERR_MODULE_NOT_FOUND.
