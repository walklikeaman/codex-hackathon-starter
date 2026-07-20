# Hackathon Starter — Project Schema (read every session)

Codex auto-loads this file from the repo root (nested `AGENTS.md` merge up the
tree). It teaches the agent how we work so you spend the 7 hours building, not
re-explaining. Tune the **Project** section the moment your idea is locked.

---

## Project (fill in at kickoff — 2 minutes)

- **What we're building:** <one sentence — the demo a judge will watch>
- **Category:** productivity | dev-tools | education | game | work-solution
- **Stack:** <e.g. Next.js + Supabase + Vercel>
- **The one demo path that must work:** <the single flow shown on stage>
- **Explicitly out of scope for tonight:** <what we will NOT build>

The last two lines are the most important. A hackathon is won by one flow that
works end to end, not five that half-work. Guard scope ruthlessly.

## Behavioral guidelines (Karpathy — apply on every non-trivial task)

Codex has no global skill auto-loader, so these live here:

1. **Think before coding** — state assumptions; if a request has two readings,
   ask; prefer the simpler approach; if unclear, stop and name it.
2. **Simplicity first** — minimum code for the demo. No speculative
   abstractions, no error-handling for cases that cannot happen tonight.
3. **Surgical changes** — touch only what the current step needs; match existing
   style; delete only what your change made unused.
4. **Goal-driven** — define a checkable success criterion up front (usually "the
   demo path renders/works"), then loop until it verifiably passes.

## Autopilot is the default

Drive a well-specified step to verified-green on your own: plan → build → run →
**verify by actually opening the result** (curl the endpoint, load the page,
read the console) → clean up → report. Don't wait for a "go" between steps.

STOP and ask first ONLY for the BLOCKING cases:

- outward-facing / hard-to-reverse actions (deploy to a _production_ domain,
  sending anything, posting publicly, spending money);
- destructive ops (dropping a table with data in it, `rm -rf`, force-push);
- anything touching credentials or another team's/account's data.

Preview deploys, throwaway branches, local runs, seed data → just do it.

## Session-startup ritual

1. This file (especially **Project** + scope).
2. `git log --oneline -10 && git status --short` — what the last session left.
3. `cat .loops/guardrails.md` — hard constraints accumulated tonight.
4. If code exists: ask CodeGraph for structure, don't grep blind
   (`codegraph_context` / `codegraph_explore`). Build the index once with
   `codegraph init`; rebuild after a branch switch with `codegraph index --force`.

## Tools wired for you (see README)

- **CodeGraph** — local code knowledge graph over MCP. Ask it "what calls X",
  "where is Y", "blast radius of changing Z" instead of grepping. Cuts tokens.
- **Supabase MCP** — spin up tables, run SQL, deploy edge functions, read logs.
- **Vercel** — `vercel` for preview deploys; Vercel MCP for logs/errors.
- **Playwright MCP** (optional) — drive a browser to verify the demo path.

Auth is per-teammate (your own accounts). We never commit tokens — they come
from env / the tool's own login.

## /ship — persist without breaking flow

When a slice is working, type `/ship`: it stages surgically (never `git add
-A`), writes a clean commit, and pushes. Keeps the repo demo-ready and lets the
next teammate pull working code. Never commit `.env` or keys.

## Loops (fire at the trigger moment — `~/.codex/prompts/loop-*.md`)

- `/loop-lint` — before a commit, drive lint/typecheck/build to clean.
- `/loop-demo` — get the one demo path green end to end.

## House rules (what NOT to do)

- Never `git add -A` / `git add .` — explicit paths only (a stray `.env` in a
  commit can leak a key that kills the demo _and_ the account).
- Never hardcode secrets — env vars only; `.env` is gitignored.
- Don't deploy to a real/production domain without asking — preview URLs only.
- Don't build past the locked scope. New idea → write it down, finish the demo
  path first.
- Don't bury decisions in code comments — put a line in `.loops/guardrails.md`
  so the next session and the next teammate see it.

## Commit co-author

End commit messages with:
`Co-Authored-By: Codex <noreply@openai.com>`

---

> This is the **lean** hackathon cut. The full compounding-knowledge framework
> (wiki graph, Context inbox, Obsidian, 13 loops) is overkill for one evening —
> it lives in the `agent-env-setup` skill for long-lived projects.
