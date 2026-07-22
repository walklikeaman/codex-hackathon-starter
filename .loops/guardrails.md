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

## Guardrail: `ship` authorizes the complete production release
An explicit `ship` from the owner means: stage the agreed scope, commit, push,
mark the PR ready, wait for required checks, merge into `main`, deploy production,
and verify the public site. Do not stop after a preview or ask for a second
production confirmation. Without an explicit `ship`, use preview deployments.

## Guardrail: Protect the demo path
Before starting a new feature, confirm the one locked demo flow still works.
A green demo that does one thing beats a broken one that tries five.

## Guardrail: Inspect teammate changes before editing
Before every slice, fetch origin and inspect the dirty worktree, recent commits,
relevant branch diffs, and shared contracts. Never revert unknown changes; rebase,
integrate, or isolate the work so every teammate's contribution is preserved.

## Guardrail: One Next.js writer per checkout
Never run `next build` while `next dev` or another build uses the same checkout.
They share `.next` and concurrent writers can corrupt the dev/runtime manifest.
