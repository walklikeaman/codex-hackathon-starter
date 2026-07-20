# Project Schema (read every session)

Codex auto-loads this file from the repo root (nested `AGENTS.md` merge up the
tree). It teaches the agent how this project works so you spend your time building,
not re-explaining. Full method: [`docs/agent-framework.md`](docs/agent-framework.md).
Fill the **Project** block the moment your idea is locked.

---

## Project (fill in at kickoff — 2 minutes)

- **What we're building:** <one sentence — the thing a user/judge will actually see work>
- **Category:** productivity | dev-tools | education | game | work-solution
- **Stack:** <e.g. Next.js + Supabase + Vercel>
- **The one demo path that must work:** <the single flow shown on stage>
- **Explicitly out of scope for now:** <what we will NOT build yet>

The last two lines matter most. One flow that works end to end beats five that
half-work. Guard scope ruthlessly; new ideas go to the out-of-scope list until the
demo path is green.

## Behavioral guidelines (apply on every non-trivial task)

Codex has no global skill auto-loader, so these live here:

1. **Think before coding** — state assumptions; if a request has two readings, ask;
   prefer the simpler approach; if unclear, stop and name it.
2. **Simplicity first** — minimum code for the goal. No speculative abstractions, no
   error-handling for cases that cannot happen.
3. **Surgical changes** — touch only what the current step needs; match existing style;
   delete only what your change made unused.
4. **Goal-driven** — define a checkable success criterion up front, then loop until it
   verifiably passes (usually: "the demo path works when I actually run it").

## Autopilot is the default

Drive a well-specified step to verified-green on your own: plan → build → run →
**verify by actually opening the result** (curl the endpoint, load the page, read the
console, re-read the file) → clean up → log → report. Don't wait for a "go" between steps.

STOP and ask first ONLY for the BLOCKING cases:

- outward-facing / hard-to-reverse actions (deploy to a _production_ domain, sending
  anything, posting publicly, spending money);
- destructive ops (dropping a table with real data, force-push, deleting files);
- anything touching credentials or another account's data.

Preview deploys, throwaway branches, local runs, seed data → just do it. For a hard
fork in approach, lay out the options and pick one with a reason instead of guessing.

## Session-startup ritual (read before doing anything)

1. This file — especially the **Project** block + scope.
2. `git log --oneline -10 && git status --short` — what the last session left.
3. `cat .loops/guardrails.md` — hard constraints accumulated so far.
4. `grep "^## \[" wiki/log.md | head -20` — recent decisions/knowledge.
5. `wiki/index.md` if the task touches anything already learned — **cite it, don't re-derive**.
6. If code exists, ask CodeGraph for structure instead of grepping blind
   (`codegraph_context` / `codegraph_explore`). Build the index once with
   `codegraph init`; rebuild after a branch switch with `codegraph index --force`.

## Tools wired for you (see README)

- **CodeGraph** — local code knowledge graph over MCP. "What calls X", "where is Y",
  "blast radius of changing Z" — answered from a pre-built index, fewer tokens.
- **Supabase** (MCP) — create tables, run SQL, deploy edge functions, read logs.
- **Vercel** — `vercel` for preview deploys; Vercel MCP for logs/errors.
- **Playwright** (MCP, opt-in) — drive a real browser to verify the demo path.

Auth is per-teammate (your own accounts). Never commit tokens — they come from env
or each tool's own login. `.env` is gitignored; expected keys are in `.env.example`.

## Knowledge that compounds — the `wiki/` layer

This is what makes the project _mature_ instead of goldfish-memory: every session
reads what the last one wrote, so knowledge accumulates instead of evaporating.

- `Context/` — raw, **immutable** inbox. Drop briefs, exports, screenshots, notes here.
- `wiki/` — the agent's to write and cross-link (`[[links]]`): `index.md` (read first),
  `log.md` (append-only, newest-first), `overview.md`, and `sources/ entities/ concepts/`.
- **Ingest**: when told "ingest `Context/`", read each source → write a `wiki/sources/`
  page → update entities/concepts → cross-link → prepend a `wiki/log.md` entry.
- **Auto-log**: after any meaningful operation, prepend a `wiki/log.md` entry. Default
  YES if unsure. Never bury a decision in a code comment — it goes in the wiki.

For a fast build you don't have to use the wiki, but the moment a decision or gotcha
is worth surviving to the next session or teammate, write it down here.

## Loops (fire at the trigger moment — `~/.codex/prompts/loop-*.md`)

- `/loop-demo` — get the one demo path green, end to end.
- `/loop-lint` — before a commit, drive lint/typecheck/build to clean.
- `/loop-debug` — a failing bug; logs attempts to `.loops/reflexion.md` so you don't repeat them.
- `/loop-spec-ship` — take a small spec to verified-green and ship it.
- `/loop-guardrails` — codify a repeated mistake into `.loops/guardrails.md`.
- `/loop-docs-sync`, `/loop-de-sloppify`, `/loop-migrate`, `/loop-pr-review` — as needed.

## /ship — persist without breaking flow

When a slice works, type `/ship`: it stages surgically (never `git add -A`), writes a
clean commit, pushes, verifies the remote, and logs to the wiki. Keeps the repo
demo-ready and lets the next teammate pull working code.

## House rules (what NOT to do)

- Never `git add -A` / `git add .` — explicit paths only (a stray `.env` leaks a key
  that kills the demo _and_ the account).
- Never hardcode secrets — env vars only.
- Don't deploy to a real/production domain without asking — preview URLs only.
- Don't build past the locked scope. New idea → out-of-scope list, finish the demo path first.
- Don't bury decisions in code comments — put a line in `.loops/guardrails.md` or `wiki/`.

## Commit co-author

End commit messages with:
`Co-Authored-By: Codex <noreply@openai.com>`
