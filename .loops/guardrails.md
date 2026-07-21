# Project Guardrails

Hard constraints for this build. The agent reads this at session start. Add a
line whenever the same mistake happens twice, or when a decision must survive
the next teammate / the next Codex session. One-liners beat paragraphs.

---

## Guardrail: Never `git add -A` or `git add .`
Stage by explicit path only. A stray `.env` in a commit can leak a key that
kills both the demo and the account.

## Guardrail: Secrets live in env, never in code or git
`.env` is gitignored. No tokens in source, no tokens in commits, no tokens in
the Supabase MCP args that get committed.

## Guardrail: Preview deploys only — no production domain without asking
`vercel` (preview) is free to run. A real domain / `--prod` is a human call.
For a newly linked project, use `vercel deploy --target=preview`; the first plain
`vercel deploy` can create a production deployment even without `--prod`.

## Guardrail: Protect the demo path
Before starting a new feature, confirm the one locked demo flow still works.
A green demo that does one thing beats a broken one that tries five.

## Guardrail: One Next.js writer per checkout
Never run `next build` while `next dev` or another build uses the same checkout.
They share `.next` and concurrent writers can corrupt the dev/runtime manifest.
