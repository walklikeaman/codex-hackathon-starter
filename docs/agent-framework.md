# Universal Autonomous-Agent Operating Framework — **Codex edition**

> **What this is.** The complete, project-agnostic method one operator uses to
> run AI coding agents so that knowledge _compounds_ instead of evaporating.
> It is distilled from a mature multi-agent repo and stripped of any domain
> specifics — hand it to **OpenAI Codex** (CLI, cloud, or IDE) in any repo and
> the agent immediately knows how the operator wants to work: how to think,
> where knowledge lives, how to persist it, how automation and CI/CD are wired,
> and which guardrails are non-negotiable.
>
> **How to use it.** Drop this file in a fresh repo and tell the agent _"Adopt
> this framework and bootstrap the project."_ It runs every command and writes
> every file here. When the wiki is still empty, the agent's first job is to
> tell the operator **where to drop raw material** (`Context/`) so it can build
> the knowledge graph. Replace `<owner>/<repo>` and `<agent>` with yours.

---

## 0. The one-paragraph thesis

Most people use a coding agent like a goldfish: every chat starts from zero,
re-derives yesterday's lessons, repeats yesterday's mistakes. This framework
fixes that with **plain-text layers** the agent reads and writes, **three
habits** (a startup ritual, auto-logging, a verify-then-persist loop), and
**automation** that keeps the knowledge fresh and the repo shippable. Git
history is the version history. Everything compounds because **every session
reads what the last one wrote.** Session #50 is smarter than session #1.

---

## 1. The full architecture at a glance

```
                       ┌───────────────────────────────────────────┐
                       │  AGENTS.md  (repo root, read EVERY session) │   ← the glue
                       │  schema · rituals · ops · house rules       │
                       └──┬─────────┬──────────┬──────────┬──────────┘
       HOW to think ──────┘         │          │          └────── operator-local
   ┌───────────────────┐  ┌─────────▼──────┐  ┌▼──────────────┐  ┌─────────────────┐
   │ Karpathy          │  │ wiki/  GRAPH KB │  │ Context/      │  │ ~/.codex/        │
   │ discipline        │  │ index·log·      │  │ raw inbox     │  │ memory/ (creds,  │
   │ (in AGENTS.md)    │  │ concepts·       │  │ IMMUTABLE     │  │ prefs)           │
   └───────────────────┘  │ entities·       │  │ (drop files)  │  └─────────────────┘
                          │ sources         │  └───────────────┘
                          └───┬─────────────┘
        ┌─────────────────────┼───────────────────┬─────────────────────┐
   ┌────▼─────┐   ┌───────────▼────────┐   ┌───────▼────────┐   ┌────────▼─────────┐
   │ Obsidian  │   │ Graphify           │   │ 13 quality     │   │ GitHub: hooks +   │
   │ human     │   │ auto knowledge-    │   │ loops + .loops/│   │ Actions + /ship + │
   │ graph     │   │ graph (no API)     │   │ guardrails     │   │ Secrets (CI/CD)   │
   └───────────┘   └────────────────────┘   └────────────────┘   └───────────────────┘
```

| #   | Layer                   | Path                                     | Owner            | Role                                       |
| --- | ----------------------- | ---------------------------------------- | ---------------- | ------------------------------------------ |
| 1   | Behavioral discipline   | Karpathy (pasted into `AGENTS.md`)       | installed once   | _How_ the agent thinks & edits             |
| 2   | Glue config             | `AGENTS.md` (root)                       | you + agent      | The always-read schema                     |
| 3   | Graph knowledge base    | `wiki/`                                  | the agent        | Compounding plain-text knowledge           |
| 4   | Raw inbox               | `Context/`                               | you (drop files) | Immutable source material                  |
| 5   | Human graph view        | `.obsidian/`                             | you (read)       | Visual graph, backlinks, properties        |
| 6   | Auto knowledge graph    | `graphify-out/`                          | tooling          | Structural map (god nodes, clusters)       |
| 7   | Quality-gate loops      | `~/.codex/prompts/loop-*.md` + `.loops/` | you + agent      | Self-pacing checks, accumulated guardrails |
| 8   | Hooks                   | `.codex/hooks.json` + `.githooks/`       | you              | Event-driven automation glue               |
| 9   | One-button ship         | `~/.codex/prompts/ship.md`               | you + agent      | Persist + publish in one keystroke         |
| 10  | CI/CD                   | `.github/workflows/`                     | you + agent      | Scheduled & triggerable execution          |
| 11  | Operator memory         | `~/.codex/memory/<repo>/`                | you              | Secrets/prefs, never committed             |
| 12  | Session memory compiler | gitignored helper dir                    | tooling          | Cross-session AI-interaction knowledge     |

The split that matters: **`Context/` is raw and immutable; `wiki/` is the
agent's compounding artifact; code is runtime.** Narrative knowledge never
hides in code comments — it goes in the wiki where the next session finds it.

---

## 2. Where your files go (the ingest flow — read first)

```
  YOU drop raw files here     →  AGENT ingests them into      →  YOU browse here
  ─────────────────────          ──────────────────────          ───────────────
   Context/                       wiki/sources/<slug>.md           Obsidian (graph)
   ├── brief.pdf      ─ "ingest" ─▶ wiki/entities/<name>.md   ────▶ + Graphify
   ├── export.csv                  wiki/concepts/<topic>.md          (god nodes,
   └── clipped/*.md                wiki/log.md  (dated entry)         clusters)
       (IMMUTABLE)                  ▲ cross-linked [[links]] + relates_to:
                                    └ that network of wiki/ pages IS the graph KB
```

1. **Drop anything into `Context/`** — briefs, PDFs, CSV/JSON exports, transcripts,
   screenshots, web clips (`Context/clipped/`). The agent **reads, never edits** it.
2. **Say "ingest `Context/`."** The agent reads each source, discusses takeaways,
   writes a summarized `wiki/sources/` page, creates/updates `entities/` +
   `concepts/`, **cross-links** them, and logs it.
3. **Browse in Obsidian** (open the repo as a vault) and read the **Graphify**
   report for the structural map.

---

## 3. Runtime binding — OpenAI Codex

This section records the Codex-specific runtime values used by the framework.

| Concept            | Codex                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always-read config | `AGENTS.md` at repo root (auto-loaded; nested `AGENTS.md` merge up the tree)                                                                                                |
| Behavioral skill   | **No global auto-loader** — paste the Karpathy block _into `AGENTS.md`_; optional reference copy at `.agents/skills/karpathy-guidelines/SKILL.md`                           |
| Slash commands     | `~/.codex/prompts/<name>.md`, invoked `/name` in the TUI; mirror to `.agents/skills/<name>/SKILL.md` for cloud/other agents                                                 |
| Quality loops      | `~/.codex/prompts/loop-*.md`, invoked `/loop-<name>`                                                                                                                        |
| Event hooks        | `.codex/hooks.json` (SessionStart, PreCompact) + `~/.codex/config.toml`; fold unsupported event reminders into `AGENTS.md` rules instead (see §12)                            |
| Operator memory    | `~/.codex/memory/<repo>/` (`MEMORY.md` index + topic files)                                                                                                                 |
| Commit co-author   | `Co-Authored-By: Codex <noreply@openai.com>`                                                                                                                                |
| In-repo playbooks  | `.agents/skills/<name>/SKILL.md`, referenced from `AGENTS.md`                                                                                                               |

## 4. Layer 1 — Behavioral discipline (Karpathy)

The single highest-leverage addition: guardrails that stop over-engineering and
sloppy edits. **For Codex, paste the block directly into `AGENTS.md`** (no global
auto-loader fires a referenced-only skill). Optionally keep the upstream copy:

```bash
git clone --depth 1 https://github.com/forrestchang/andrej-karpathy-skills /tmp/aks
mkdir -p .agents/skills/karpathy-guidelines
cp /tmp/aks/karpathy-guidelines/SKILL.md .agents/skills/karpathy-guidelines/SKILL.md
rm -rf /tmp/aks
```

The four rules, in one breath:

1. **Think before coding** — state assumptions; if two readings exist, ask; prefer the simpler approach; if unclear, stop and name it.
2. **Simplicity first** — minimum code; no speculative abstractions/flexibility/error-handling for impossible cases. "Would a senior call this overcomplicated?" If yes, rewrite.
3. **Surgical changes** — touch only what the request needs; don't "improve" adjacent code; match existing style; remove only what _your_ change made unused.
4. **Goal-driven** — define a checkable success criterion up front; loop until it verifiably passes.

(Source: https://github.com/forrestchang/andrej-karpathy-skills · Karpathy's
[LLM-pitfalls notes](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).)

---

## 5. Layer 2 — `AGENTS.md` (the glue)

The one file read every session. Keep it ~100 lines. Skeleton (fill `<…>`):

```markdown
# <project> — Project Schema

## Behavioral guidelines (Karpathy)

(paste the verbatim 4-rule block from §4 here — Codex has no skill auto-loader)

## First-run behaviour

If the wiki is still empty (only seed `index.md`/`log.md`/`overview.md`), your
NEXT message must tell the operator: "Drop raw files into `Context/` and tell
me to ingest — I'll build the graph under `wiki/`." Then wait; don't invent.

## Session-startup ritual (read before doing anything)

1. This file.
2. Operator memory: `cat ~/.codex/memory/<repo>/MEMORY.md 2>/dev/null`.
3. Knowledge graph: `cat graphify-out/GRAPH_REPORT.md 2>/dev/null | head -80`.
4. Recent log: `grep "^## \[" wiki/log.md | head -20`.
5. Active guardrails: `cat .loops/guardrails.md 2>/dev/null`.
6. Relevant playbook: `ls .agents/skills/`.
7. Recent commits: `git log --oneline -10 && git status --short`.
8. `wiki/index.md` if the task touches domain knowledge.
   If an existing wiki/log/graph entry covers the request, CITE it.

## Per-task operating loop

Surface assumptions → check prior work → state a plan → probe → run → verify by
re-reading the actual resource → clean up scratch scripts → log it → /ship.

## Auto-fire the loops (don't wait to be told)

Run the matching `/loop-*` at its trigger moment (see §11 table).

## Before any git commit

Run lint on staged files; if uncommitted work remains at session end, run /ship.
(When a desired event hook is unavailable, keep the behavior here as an explicit rule.)

## /ship

When work is ready to persist, type `/ship` — surgical stage, auto-log, commit,
push, verify remote, update the graph. Don't reinvent the tail of the loop.

## Wiki layer (agent-owned) — the GRAPH knowledge base

`Context/` raw & immutable; `wiki/` is yours to write and cross-link.

- `wiki/index.md` — catalog. READ FIRST. - `wiki/log.md` — append-only journal.
- `wiki/overview.md` — synthesis. - `wiki/{sources,entities,concepts}/`.

## Operations

**Ingest**: read source → discuss → `wiki/sources/<slug>.md` → update
entities/concepts (cross-link `[[…]]`) → prepend `wiki/log.md` entry → update index.
**Query**: read index first → drill in → answer with citations → file reusable answers back.
**Lint**: contradictions, stale claims, orphans, missing concept pages, broken links.

## Auto-logging rule (no exceptions)

After EVERY meaningful operation, prepend a `wiki/log.md` entry and commit —
without being asked. Unsure if meaningful? Default YES. Cite a rule's origin
("Per <operator> YYYY-MM-DD …") and the commit hash.

## Page conventions

YAML frontmatter (`type/created/updated/sources` + optional
`confidence/status/verified_by/staleness_window/relates_to/supersedes/tags`).
Today's date; convert relative dates to absolute. Paraphrase, no long quotes.
Relative links so Obsidian AND GitHub resolve.

## House rules

(see §16 — the operator's non-negotiables)

## What NOT to do

Never edit `Context/`. Never `git add -A`. Don't pre-create empty pages. Don't
duplicate across pages (link). Don't bury knowledge in code comments.
```

---

## 6. Layer 3 — the wiki (graph knowledge base)

Plain Markdown, agent-owned, version-controlled. **The priority layer — the
thing the whole method exists to build.**

```
wiki/  index.md (READ FIRST) · log.md (compounds) · overview.md
       sources/   one page per ingested raw source
       entities/  brands, people, vendors, services, components
       concepts/  APIs, workflows, rules, domain topics
```

**Frontmatter** (every page):

```yaml
---
# REQUIRED
type: source | entity | concept
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [<slug>, …]
# OPTIONAL (borrowed from agentmemory — plain frontmatter, no DB)
confidence: high | medium | low
status: active | deprecated | archived
verified_by: <name> YYYY-MM-DD
staleness_window: 30d | 90d | 180d | 1y | none   # linter flags when updated+window < today
relates_to: [<slug>, …]        # explicit graph edges
supersedes: <slug> / superseded_by: <slug>   # lineage
tags: [<topic>, …]
---
```

Why the optional fields: a KB without confidence/freshness/graph signals
poisons itself — stale claims look like fresh ones. Linter rules: `confidence:
low` → surface; `updated+staleness_window < today` → flag stale; `deprecated`
without `superseded_by` → ask; dangling `relates_to` → broken-edge report.
(Source: https://github.com/rohitg00/agentmemory — concepts reused, not the DB.)

**Log entry format** (newest-first within a day — a guardrail):

```markdown
## [YYYY-MM-DD] {ingest|update|incident|lint} | <short subject>

**Object**: what this touched, or "N/A — meta".
**Scenario**: feature | bugfix | refactor | rule-change | incident | ingest
**Outcome**: ✅ success | ⚠️ partial | ❌ failed
**What happened**: 1–3 plain-English paragraphs (not stdout dumps). Cite a new
rule's origin ("Per <operator> YYYY-MM-DD …").
**Code changes**: commit <hash> — subject.
**Updated**: relative paths.
```

The log is where _reasoning_ lives ("tried X, failed because Y, now do Z"). A
postmortem written today stops the same mistake next week, because next week's
startup ritual reads it.

---

## 7. Layer 4 — `Context/` + Obsidian (graph links)

`Context/` is the raw inbox (§2) — immutable. The **graph** is made of three
edge types in `wiki/`:

1. **`[[wiki-links]]` / relative md links** in bodies — the real edges (resolve in Obsidian, GitHub, plain viewers).
2. **`relates_to:`** frontmatter — explicit peer edges.
3. **`supersedes:`/`superseded_by:`** — lineage edges.

**Obsidian** overlays a visual graph (agent never touches it; human read layer).
The repo root _is_ the vault. Config files (commit these):

`.obsidian/app.json` — `userIgnoreFilters` keeps tooling dirs out of the graph:

```json
{
  "attachmentFolderPath": "Context/clipped",
  "newLinkFormat": "relative",
  "useMarkdownLinks": true,
  "alwaysUpdateLinks": true,
  "userIgnoreFilters": [
    "node_modules",
    ".venv",
    ".agents/worktrees",
    "graphify-out"
  ]
}
```

`.obsidian/graph.json` — colour-code nodes by layer + scope the graph to the wiki:

```json
{
  "showOrphans": true,
  "nodeSizeMultiplier": 1.2,
  "linkDistance": 200,
  "search": "(path:wiki/concepts OR path:wiki/entities OR path:wiki/sources)",
  "colorGroups": [
    { "query": "path:wiki/concepts", "color": { "a": 1, "rgb": 6000639 } },
    { "query": "path:wiki/entities", "color": { "a": 1, "rgb": 11032055 } },
    { "query": "path:wiki/sources", "color": { "a": 1, "rgb": 2278750 } }
  ]
}
```

Core plugins to enable: `graph, backlink, outgoing-link, properties, tag-pane,
global-search, command-palette, bookmarks, file-recovery, canvas`. `.gitignore`
the per-user noise: `.obsidian/workspace.json`, `workspace-mobile.json`, `.DS_Store`.
**Web Clipper** (https://obsidian.md/clipper) drops web sources into
`Context/clipped/` as raw material to ingest.

---

## 8. Layer 6 — Graphify (the auto knowledge graph)

`graphify` (PyPI `graphifyy`) scans the whole repo + wiki, clusters concepts
(Louvain communities), and emits — with **no API key, structural analysis only**:

- `graphify-out/GRAPH_REPORT.md` — **god nodes** (most-connected abstractions),
  **community clusters**, surprising connections, import cycles, freshness.
- `graphify-out/graph.json` — structured data for queries.
- `graphify-out/manifest.json` — per-file hashes for incremental rebuilds.

All three are committed so every session starts on a fresh graph. Integration:

- **Startup ritual step 3** reads `GRAPH_REPORT.md | head -80` — god nodes +
  clusters tell you the core abstractions before diving into files.
- **Git post-commit hook** (`.githooks/post-commit`) rebuilds in the background
  after each commit; **post-checkout** rebuilds on branch switch. Wire with
  `git config core.hooksPath .githooks`. Pin `PYTHONHASHSEED=0` for deterministic
  clustering; record the python interpreter at install time so it works in GUI/CI.
- **`/ship` step 9b** commits any updated graph artifacts after push.
- **Query without rebuild / cost**: `graphify query "<question>" --graph graphify-out/graph.json`.
- Keep `graphify-out/` out of the Obsidian graph (it's in `userIgnoreFilters`).

The wiki gives you the _authored_ graph (your `[[links]]`); Graphify gives you
the _discovered_ graph (structural connections you didn't author). Use both.
(Git hooks are runtime-independent and keep this layer portable.)

---

## 9. Layer 11 — operator-local memory & §12 session compiler

**Operator memory** (`~/.codex/memory/<repo>/`, never committed) — for secrets
and preferences: API tokens, voice/style prefs, approval rules, commit-scope
rules, model policy. `MEMORY.md` is a <30-line index of links; each topic file:

```markdown
---
name: <slug>
description: <what this remembers; shown in the index>
metadata: { type: reference | feedback | user | project }
---

<the fact; link peers with [[name]]>
```

Document in `AGENTS.md` that a new machine sets this up locally. This is
startup-ritual step 2.

**Session memory compiler** (optional, gitignored helper) — auto-captures every
session to a daily log via hooks, compiles into knowledge articles. This is
_cross-session AI-interaction_ knowledge (decisions, gotchas) — distinct from
the _project-domain_ wiki. They don't overlap.

---

## 10. The operating loop (the three habits)

**Habit 1 — Startup ritual** (§5): read config → memory → graph report → recent
log → guardrails → playbooks → commits → index, _before acting_. Two minutes
here saves an hour of re-deriving. Cite anything that already covers the request.

**Habit 2 — Auto-logging** (§5): after any meaningful action, prepend a
`wiki/log.md` entry and commit. Without being asked. Default YES.

**Habit 3 — Per-task loop**:

1. Surface assumptions (two readings → ask).
2. Check prior work: `grep -rn "<kw>" . ; grep "<kw>" wiki/log.md`.
3. State a 2–5 step plan, each with a verification check; put it in the reply.
4. Probe before committing to specifics — throwaway `scripts/_probe_*.py`
   (underscore = delete before commit). UI/API assumptions are wrong ~30% of the time.
5. Run; capture output into the report.
6. **Verify by re-reading the actual resource** — "✅ done" is not proof,
   especially with async/caching/early success messages.
7. Clean up scratch scripts.
8. Log it (Habit 2). 9. `/ship`. 10. Report: done (with verification facts) / left / watch-next.

**Productize on the second repeat** — the second time you do a thing, write the
reusable CLI. **Versioning is git**: one semantic change per commit; date-stamp
rules when introduced; put the commit hash in the matching log entry (two-way link).

---

## 10b. Autonomy & decision posture (autopilot is the default)

**Autopilot is the default.** Take a well-specified task and drive it to a
verified-green state on your own — plan → probe → run → verify by re-reading the
resource → clean up → log → `/ship` — _then_ report. Don't wait for a "go"
between steps; the per-task loop (§10) IS the autopilot.

**BLOCKING — stop and ask first (never auto-done):**

- **Outward-facing / hard-to-reverse** — sending email, posting to a person or
  service, anything published externally, money/payment mutations, production
  pushes against real systems.
- **Out-of-scope repos** — commit only where the task lives; don't touch sibling
  repos/agents without an explicit ask.
- **Destructive ops** — deleting/overwriting files you didn't create, force-push,
  history rewrites, dropping data.
- **Releases** — tags, version bumps, anything a human treats as "shipped to users".

Inside those bounds, act: surface the assumption, pick the sensible default, proceed.

**Context-rot hygiene.** For long / multi-file / repo-sweep work, offload to
fresh-context sub-agent or parallel-task waves and keep only the _conclusion_ in
the main thread. Delegate the sweep; retain the answer — don't let one context
fill with file dumps.

**Hard decisions → consult multiple lenses, don't guess.** For genuinely hard,
high-stakes, or multi-trade-off forks (architecture choices, irreversible
data/release calls, close "which approach" calls), run a multi-persona
deliberation that surfaces disagreement instead of false consensus: spawn a few
independent expert-lens sub-agents (e.g. correctness, risk, simplicity, the
adversary) and synthesize where they _disagree_ before committing. Under Codex,
run the lenses as parallel sub-agents. Not for routine tasks
(autopilot handles those) — reach for it only when a wrong call is expensive.

**Don't bolt on external task-runners.** This native loop (startup ritual →
autopilot → quality loops → `/ship`) IS the "get-shit-done" engine. Adding a
second orchestration framework on top duplicates the loop, clashes with `/ship`,
and bloats context. Extend the loop you have; don't import a parallel one.

---

## 11. Quality-gate loops (the 13 self-pacing loops)

A **loop** is a slash command that runs a check between iterations and stops at a
verifiable exit condition or an iteration cap. Pattern (`~/.codex/prompts/loop-*.md`):

```markdown
---
description: <when to use + what it does — dense trigger phrases>
argument-hint: "<optional arg>"
---

Start the '<Name>' loop. Goal: <verifiable goal>. Max iterations: N.
Between iterations run: `<check command>`. Exit when: <exit condition>.

Step 1: … Step 2: … Step 3: self-pace — re-run the check, continue only if not met.

**Guardrail rules (never break):**

- Don't modify the check/criteria to force a pass. Don't stub checks.
- If blocked after N iterations, write the blocker down and report — don't game it.
```

**State files in `.loops/`** (tracked in git — accumulated project knowledge):

- `.loops/guardrails.md` — **permanent hard constraints**, one `## Guardrail:`
  entry written each time a failure repeats twice. Read at startup; treated as
  law. (Real examples: never `git add -A`; log entries newest-first; read
  `wiki/index.md` before domain questions.)
- `.loops/reflexion.md` — debug attempt log (one entry per failed attempt:
  tried / failed / next hypothesis). Never delete entries; clear only at the
  start of a new, unrelated debug session.

**The 13 loops & their auto-fire triggers** (run automatically — no reminder):

| Trigger moment                    | Command                         | Does                                              |
| --------------------------------- | ------------------------------- | ------------------------------------------------- |
| After any code/config/wiki change | `/loop-docs-sync`               | Sync stale wiki/docs to match code                |
| After every `/ship`               | `/loop-changelog`               | Ensure every change is in `wiki/log.md`           |
| Before any PR                     | `/loop-pr-review`               | 3-pass diff self-review, fix findings             |
| Same failure twice                | `/loop-guardrails`              | Write a constraint to `.loops/guardrails.md`      |
| Bug resisted one fix              | `/loop-debug`                   | Reflexion log, try a _different_ fix each time    |
| Can't find root cause             | `/loop-investigate`             | Tiny throwaway probe to isolate the issue         |
| After migration files             | `/loop-migrate`                 | Apply DB migrations cleanly                       |
| PRs in flight                     | `/loop 15m /loop-pr-babysitter` | Watch + heal open PRs on an interval              |
| Post-impl, pre-commit             | `/loop-de-sloppify`             | Strip debug code, dead branches, slop             |
| Start of multi-req task           | `/loop-spec-ship`               | Implement `spec.md` one requirement at a time     |
| Lint errors                       | `/loop-lint`                    | Fix lint/typecheck with minimal diffs until clean |
| Integration tests failing         | `/loop-e2e`                     | Fix first failure, repeat until green             |
| After UI changes                  | `/loop-visual-regression`       | Compare screenshots, fix diffs                    |

These are runtime-agnostic in spirit; adapt each loop's _check command_ to your
stack (your test runner, linter, type-checker, build step, or an API call). In Codex,
these live in `~/.codex/prompts/`; if a Codex build lacks self-pacing, the agent
runs the loop's steps manually until the exit condition holds.

---

## 12. Hooks — event-driven automation glue

Two hook systems compose: **git hooks** (`.githooks/`, wired via
`core.hooksPath` — runtime-identical) and **Codex hooks** (`.codex/hooks.json`).

**Git hooks**: `post-commit` + `post-checkout` rebuild the Graphify graph in the
background; `pre-commit` for fast local checks. Idempotent; skip during
rebase/merge/cherry-pick.

**Codex hooks** (`.codex/hooks.json` — SessionStart, PreCompact): on
`SessionStart`, run the session-memory-compiler and echo the active-guardrail
count (`grep -c '## Guardrail:' .loops/guardrails.md`); on `PreCompact`, flush
session knowledge.

Behaviors without a supported event hook (for example, "remind to /ship if
uncommitted" or "lint staged `.py` before commit") are encoded as **rules in
`AGENTS.md`** instead (§5, "Before any git commit"). The principle holds:
anything the operator wants to happen automatically is a hook _where the
runtime supports one_, otherwise an explicit `AGENTS.md` rule—not a fragile
memory.

---

## 13. `/ship` — one button for the whole tail

`/ship` (`~/.codex/prompts/ship.md`, mirrored to `.agents/skills/ship/SKILL.md`)
treats every meaningful operation as **five outputs that land together**: code,
playbook, wiki concept pages, wiki log, GitHub. The flow (generalized — drop any
domain-specific gates):

1. **Diagnose** — `git status/log/diff`; spot dangerous staged content (`.env`, keys, secrets) → STOP and ask.
2. **Cross-repo detection** — touched two repos? One surgical commit per repo.
3. **Playbook mirror sync** — copy edited `.agents/skills/*/SKILL.md` to `~/.codex/prompts/` where it backs a command (repo copy canonical).
4. **Auto-log** — prepend a `wiki/log.md` entry if not already covered (newest-first).
5. **Wiki index update** — add any new `wiki/{concepts,entities,sources}/` pages.
6. **Stage surgically** — explicit paths only, never `-A`; `git diff --cached --stat` sanity check.
7. **Commit** — subject ≤72 chars; body explains _why_ not _what_; date-stamp rules; Co-Authored-By trailer; via HEREDOC temp file.
8. **Push** — `git push origin HEAD`; non-`main` → ask about PR/force.
9. **Verify remote sync** — compare local vs `gh api` remote SHA.
   9b. **Graph update** — commit refreshed `graphify-out/*` (hook already rebuilt it; use `GRAPHIFY_SKIP_HOOK=1` to avoid re-trigger).
10. **Backfill** the real commit hash into the log entry (no `<hash>` placeholder ships).
11. **Report** — Done (hash + URL) / Logged (which page) / Sync (✓ or drift).

**Hard rules**: never `git add -A`/`.`; never commit `.env`/keys/credentials;
never `--no-verify`; never force-push `main` without OK; never empty commits to
satisfy ship; push immediately. **When NOT to ship**: mid-task checkpoint (use a
branch); right after an unverified destructive op; while secrets are dirty.

---

## 14. CI/CD & deployment (GitHub)

GitHub-hosted runners do the heavy lifting; the operator (even on a phone) only
triggers. **Secrets**: `printf '%s' '<value>' | gh secret set NAME` — **never
`--body -`** (stores the literal `-`); name secrets to match the env var the
code reads, so the same script runs locally (`.env`) or in CI.

Workflow patterns that pay off:

- **`workflow_dispatch` with a `choice` input** — one mega-workflow + branching
  beats N tiny workflows (better mobile UX).
- **`if: always()` artifact upload** — you get logs/screenshots even on failure
  (the case you most want to debug).
- **Scheduled ingest** (`cron`) — pull external data (email, analytics, metrics)
  on an interval and ingest into the wiki/brain; dedup by id.
- **Push-triggered sync** (`paths: ["wiki/**"]`) — refresh any downstream index
  when the wiki changes.
- **PR babysitter** — interval workflow that watches labeled PRs, fixes CI,
  rebases, escalates. (Mind the Actions-minutes budget — pause to manual when low.)
- **Optional RAG mirror** — if the wiki ever outgrows the context window, mirror
  it into a vector store (Supabase pgvector + embeddings, idempotent
  delete+reingest on push). **Default OFF — the graph KB is the priority**; add
  this only when the agent can no longer hold the relevant slice in context.
- **Deploy after every commit** — if the agent targets a device/app/site, push
  the build to the real target each commit so the operator actually sees the
  change (local-only work is invisible).

---

## 15. Versioning & git conventions

- **Git history IS the version history** — no parallel scheme for wiki/playbooks.
- One **semantic change per commit** (a doc edit, a code change, a config tweak = three commits).
- Subject ≤72 chars, present tense; **body explains _why_, not _what_** (the diff shows what).
- **Date-stamp rules** when introduced ("Per <operator> YYYY-MM-DD …") so the conversation that produced them is findable.
- **Commit hash in the matching `wiki/log.md` entry** — a two-way link between narrative and diff.
- **Push immediately** — local-only work is invisible to the next session, to Actions, and to mobile.
- **Cross-repo** — one surgical commit per repo; never mash.

---

## 16. House rules — the operator's conventions (the personal layer)

The non-negotiables that make an agent "work the way I want." Put these in
`AGENTS.md` and `.loops/guardrails.md`:

- **Autopilot by default** — drive well-specified tasks to verified-green on your own; only STOP for the 4 BLOCKING cases (outward-facing/hard-to-reverse, out-of-scope repos, destructive ops, releases). See §10b.
- **Hard / high-stakes forks → consult multiple lenses, don't guess** (multi-persona deliberation, §10b).
- **Offload long/multi-file/repo-sweep work to fresh-context waves** — keep only the conclusion in the main thread (context-rot hygiene).
- **Don't bolt external task-runners onto the native loop** — it IS the get-shit-done engine.
- **Never `git add -A` / `git add .`** — explicit paths only. (Guardrail.)
- **`wiki/log.md` newest-first within a day.** (Guardrail.)
- **Read `wiki/index.md` before any domain question.** (Guardrail.)
- **Auto-log everything meaningful, unasked; default YES** when unsure.
- **Auto-fire the loops by trigger** — don't wait to be told.
- **Verify by re-reading reality** — never report success off stdout alone.
- **Probe scripts are `_probe_*.py`, deleted before commit.** Productize on the 2nd repeat.
- **Don't touch sibling repos/agents without an explicit ask** — scope discipline.
- **Playbooks: repo copy canonical, `~/.codex/` is a mirror** — keep in sync.
- **Secrets only via `printf | gh secret set`** — never inline, never `--body -`.
- **Convert relative dates to absolute** when filing; today's date from session context.
- **Language: match the source** for direct quotes; both EN/RU fine.
- **Model policy** (if the agent calls models): default to the cheap/free tier; keep the model id in one place so it's swappable.
- **Cite your sources** — when an existing wiki/log/graph entry covers the ask, link it. Show your work.
- **Deploy after every commit** so the operator sees the change.

---

## 17. Pitfalls — paid-for lessons (don't relearn them)

- **`gh secret set NAME --body -`** stores the literal `"-"`. Use the `printf` pipe.
- **"✅ done" is not proof** — re-read the resource; the worst bugs are where the success message fired but the durable state didn't change.
- **Skipping the startup ritual** cost ~40 min once (re-probing already-known selectors). Two minutes of reading first, always.
- **Silent API failures** — rate limits / expired tokens often return a 200 with an empty body or a re-auth redirect, not a clean error. Assert on response _shape_. Cache the failure mode in a concept page with a `staleness_window`.
- **Async / eventual consistency** — re-check after a short wait before declaring failure; don't raise on the first miss.
- **Scope creep into a parallel memory store** — the graph wiki + git + Graphify already give persistence, versioning, links, and discovery. Two sources of truth age badly; move-and-cross-link, don't fork. (Why RAG is opt-in, not core.)
- **Non-deterministic graph clustering** — pin `PYTHONHASHSEED=0` or `graphify-out/` churns every run.

---

## 18. Adoption checklist

- [ ] Drop this file in the repo; tell the agent to adopt + bootstrap.
- [ ] Paste the Karpathy block into `AGENTS.md`; optional reference copy in `.agents/skills/`.
- [ ] Write `AGENTS.md` (§5).
- [ ] Scaffold `wiki/{sources,entities,concepts}` + `Context/` + seeds (`index/log/overview`).
- [ ] `.obsidian/` config (§7); open the repo as a vault — confirm graph + properties.
- [ ] Install Graphify; `git config core.hooksPath .githooks`; first build; commit `graphify-out/`.
- [ ] Add `~/.codex/prompts/loop-*.md` + `.loops/{guardrails,reflexion}.md` (§11).
- [ ] Add `/ship` (`~/.codex/prompts/ship.md` + `.agents/skills/ship/` mirror).
- [ ] Add `.codex/hooks.json`; encode the rest as `AGENTS.md` rules (§12).
- [ ] `gh secret set` credentials; add `.github/workflows/` (§14).
- [ ] Set up operator memory locally (`~/.codex/memory/<repo>/`).
- [ ] First **ingest**: drop a real source in `Context/`, ask the agent to process it, watch the graph appear, then `/ship`.
- [ ] Verify the point: a brand-new session answers a question only written to `wiki/` last session, without re-explanation.

---

## 19. Instantiating for a new domain

This framework is the _chassis_; a project supplies the _content_. To adapt:

1. **Entities** = the nouns your project tracks (clients, vendors, services, components, accounts).
2. **Concepts** = the APIs, workflows, rules, and policies (one page each; tag rate-limit/credential pages `staleness_window: 90d`).
3. **Sources** = whatever you drop in `Context/` (briefs, exports, transcripts).
4. **Loops** = keep all 13; swap each check command for your stack's equivalent.
5. **Workflows** = your scheduled ingest + any triggerable automation.
6. **House rules** = §16 as-is, plus any project-specific gate (encode it in `/ship` and `.loops/guardrails.md`).

Don't pre-create empty pages — each is born on the first real ingest that
mentions it. The graph grows from `Context/`, one ingest at a time.

---

_This framework is itself an artifact of the method it describes: plain
Markdown, version-controlled, handed to the next agent. Drop your files in
`Context/`, adopt the framework, and session #50 stands on session #1's
shoulders._
