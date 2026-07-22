# Deployment — Vercel + GitHub Actions with gates

Vercel project `codex-hackathon-starter` (id `prj_FM31BOAjGEmwLlOFFK0zcpzcqStE`,
account `walklikeaman1904`), linked to the GitHub repo. The framework is forced by
`vercel.json` (otherwise it built as static).

## Current scheme (decision 21.07, PR ef1fecd)

- Push a branch → Vercel Preview for that branch (link in the PR).
- **Merge into `main` → staging**: GitHub environment `staging`, Vercel Preview.
- **Production — manual only**: GitHub Actions workflow with explicit
  confirmation via the `production` environment. Credentials (`VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) — in GitHub environment secrets.
- Prod URL: https://codex-hackathon-starter.vercel.app

## Incident lesson (guardrail)

The first `vercel deploy` without `--prod` on a freshly created project still went
to production. For a newly linked project you must use
`vercel deploy --target=preview` (recorded in `.loops/guardrails.md`).

## Gotchas

- The preview/staging environment has **no `OPENAI_API_KEY`** — AI features ([[openai]])
  are verified only in prod after a manual deploy.
- Prod env variables: NEXT_PUBLIC_SUPABASE_* (not used at runtime —
  [[supabase]]), OPENAI_*, TMDB_API_READ_ACCESS_TOKEN.
- Don't run `next build` while `next dev` is live in the same checkout — they share
  `.next` (guardrail).
