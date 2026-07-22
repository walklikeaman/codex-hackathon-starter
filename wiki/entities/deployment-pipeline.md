# Деплой — Vercel + GitHub Actions с гейтами

Проект Vercel `codex-hackathon-starter` (id `prj_FM31BOAjGEmwLlOFFK0zcpzcqStE`,
аккаунт `walklikeaman1904`), привязан к GitHub-репо. Framework форсится
`vercel.json` (иначе билдился как статика).

## Актуальная схема (решение 21.07, PR ef1fecd)

- Пуш ветки → Vercel Preview на ветку (ссылка в PR).
- **Мерж в `main` → staging**: GitHub-окружение `staging`, Vercel Preview.
- **Production — только вручную**: GitHub Actions workflow с явным
  подтверждением через окружение `production`. Креды (`VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) — в GitHub environment secrets.
- Прод-URL: https://codex-hackathon-starter.vercel.app

## Инцидент-урок (гардрейл)

Первый `vercel deploy` без `--prod` на свежесозданном проекте всё равно ушёл
в production. Для нового линкованного проекта обязателен
`vercel deploy --target=preview` (записано в `.loops/guardrails.md`).

## Грабли

- Превью/staging окружение **без `OPENAI_API_KEY`** — AI-фичи ([[openai]])
  проверяются только в проде после ручного деплоя.
- Env-переменные прода: NEXT_PUBLIC_SUPABASE_* (не используются рантаймом —
  [[supabase]]), OPENAI_*, TMDB_API_READ_ACCESS_TOKEN.
- Не запускать `next build` при живом `next dev` в том же checkout — делят
  `.next` (гардрейл).
