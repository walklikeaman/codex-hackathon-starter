<!-- refreshed: 2026-07-21 -->
# Architecture

**Analysis Date:** 2026-07-21

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Entry Surfaces                                 │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│ Browser / Vercel     │ Codex session        │ Teammate shell / static docs │
│ `app/page.jsx`       │ `AGENTS.md`          │ `setup.sh`, `scaffold.sh`    │
│ `app/layout.jsx`     │ `.codex/hooks.json`  │ `docs/index.html`            │
└──────────┬───────────┴──────────┬───────────┴──────────────┬────────────────┘
           │                      │                          │
           ▼                      ▼                          ▼
┌──────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
│ Next.js App Router   │ │ Agent workflow layer   │ │ Bootstrap/onboarding   │
│ server-rendered `/`  │ │ `prompts/*.md`         │ │ `config/mcp.json`      │
│ `app/`               │ │ `TASKS.md`             │ │ `docs/index.html`      │
└──────────┬───────────┘ └──────────┬─────────────┘ └────────────┬───────────┘
           │                        │                            │
           └────────────────────────┼────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      State and external boundaries                          │
│ Environment: process env / `.env.local` (ignored)                           │
│ Project state: `wiki/`, `Context/`, `.loops/`, `TASKS.md`, Git              │
│ Tool boundary: CodeGraph, Supabase, Vercel, Playwright via `setup.sh` / MCP │
└─────────────────────────────────────────────────────────────────────────────┘
```

The repository is a hackathon starter rather than an implemented domain product. Its executable product surface is one server-rendered Next.js route in `app/page.jsx`; its larger architecture is the repository-resident operating system for agents and teammates in `AGENTS.md`, `prompts/`, `wiki/`, `Context/`, `.loops/`, and the setup scripts.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root layout | Defines site metadata, document language, global body typography, and the content shell | `app/layout.jsx` |
| Home route | Renders the root readiness page and reports whether the two public Supabase settings are present | `app/page.jsx` |
| Node package entry | Exposes the Next.js development, build, and production-start commands | `package.json` |
| Machine bootstrap | Validates Node/npm, installs supported CLIs, wires MCP servers, and installs prompt files into the operator's Codex home | `setup.sh` |
| App scaffold | Seeds local environment configuration without overwriting it and installs npm dependencies | `scaffold.sh` |
| Agent control contract | Defines project scope, session startup, autonomy gates, knowledge handling, and git rules | `AGENTS.md` |
| Session-start automation | Reports active guardrails and warns when the project scope contract is still unfilled | `.codex/hooks.json` |
| Command catalog | Defines reusable `/autopilot`, `/ship`, quality-loop, database, UI, and pitch workflows | `prompts/*.md` |
| Team coordination | Holds assignments, the shared data contract, branch ownership, and integration cadence | `TASKS.md`, `TEAMWORK.md` |
| Knowledge inbox | Stores immutable raw material awaiting agent ingestion | `Context/`, `Context/clipped/` |
| Knowledge base | Stores the agent-maintained index, overview, operation log, sources, entities, and concepts | `wiki/` |
| Learning state | Persists hard constraints and failed debugging attempts across sessions | `.loops/guardrails.md`, `.loops/reflexion.md` |
| Human graph view | Configures Obsidian to visualize the `wiki/` knowledge graph while ignoring tooling output | `.obsidian/*.json` |
| Alternative-client MCP catalog | Declares CodeGraph, Supabase, Vercel, and optional Playwright servers for Cursor users | `config/mcp.json` |
| Static onboarding site | Serves a self-contained bilingual team guide with client-side language and copy controls | `docs/index.html` |
| Deployment declaration | Forces Vercel to treat the root package as a Next.js application | `vercel.json` |

## Pattern Overview

**Overall:** Repository-centric dual-plane starter: a thin Next.js App Router runtime plus an agent/team operations control plane.

**Key Characteristics:**
- Keep the product runtime intentionally small in `app/`; the root page is a server component and there is no client component, route handler, middleware, database client, or domain module yet (`app/page.jsx`, `app/layout.jsx`).
- Treat version-controlled Markdown and JSON as executable coordination state: agent policy lives in `AGENTS.md`, work state in `TASKS.md`, reusable procedures in `prompts/`, and durable knowledge in `wiki/` and `.loops/`.
- Keep raw inputs separate from derived knowledge: `Context/` is read-only input, while `wiki/` is the writable, cross-linked synthesis layer (`AGENTS.md:81`, `AGENTS.md:86`).
- Put infrastructure management behind setup and MCP boundaries instead of the application runtime (`setup.sh:77`, `setup.sh:84`, `config/mcp.json:3`).
- Maintain a separate static documentation surface in `docs/index.html`; it is not imported by, routed through, or built from `app/`.
- Use Git branches and pull requests as the concurrency boundary between teammates, with `TASKS.md` as the ownership board (`TEAMWORK.md:6`, `TEAMWORK.md:35`).

## Layers

**Application Runtime Layer:**
- Purpose: Serve the user-visible starter page and prove that the Next.js deployment can read its public environment configuration.
- Location: `app/`, `package.json`, `next.config.mjs`, `vercel.json`
- Contains: App Router route modules, the root HTML layout, npm lifecycle scripts, and deployment framework selection.
- Depends on: Next.js and React from `package.json`, plus public environment variables read in `app/page.jsx:2` and `app/page.jsx:4`.
- Used by: Local `npm run dev` / `npm run start` and Vercel builds configured by `vercel.json`.

**Agent Workflow Layer:**
- Purpose: Turn a user request into a bounded plan, implementation loop, verification, and safe git handoff.
- Location: `AGENTS.md`, `.codex/hooks.json`, `prompts/`
- Contains: Startup rules, project-scope gates, reusable slash-command prompts, lint/debug/demo loops, and shipping discipline.
- Depends on: Repository state in `TASKS.md`, `wiki/`, `.loops/`, and Git; optional CodeGraph and Playwright tooling named in `AGENTS.md:55` and `AGENTS.md:68`.
- Used by: Codex sessions and any teammate running copied prompts from `~/.codex/prompts/` after `setup.sh:104`.

**Coordination and Durable State Layer:**
- Purpose: Persist scope, ownership, decisions, raw sources, lessons, and debug history across people and sessions.
- Location: `TASKS.md`, `TEAMWORK.md`, `Context/`, `wiki/`, `.loops/`, `notes/`
- Contains: The data-contract placeholder, task board, raw inbox, derived knowledge graph, guardrails, reflexion log, and informal scratch notes.
- Depends on: Human or agent updates governed by `AGENTS.md:81`, `TEAMWORK.md:35`, and `notes/README.md`.
- Used by: Session startup (`AGENTS.md:55`), `/loop-debug` (`prompts/loop-debug.md`), `/loop-docs-sync` (`prompts/loop-docs-sync.md`), and `/ship` (`prompts/ship.md`).

**Bootstrap and Integration Layer:**
- Purpose: Prepare a machine and expose external services without embedding management credentials in application code.
- Location: `setup.sh`, `scaffold.sh`, `config/mcp.json`, `.env.example`
- Contains: CLI detection/installation, MCP registration, prompt installation, dependency installation, and the template for local environment configuration.
- Depends on: Node 22+, npm, the Codex CLI, optional Vercel/Playwright tooling, and browser OAuth for HTTP MCP servers (`setup.sh:35`, `setup.sh:54`, `setup.sh:64`, `setup.sh:84`).
- Used by: Teammates during initial setup and by the designated infrastructure owner using `./setup.sh --infra` (`TEAMWORK.md:18`).

**Onboarding Documentation Layer:**
- Purpose: Explain the environment, team workflow, available commands, and candidate project ideas.
- Location: `README.md`, `GUIDE.md`, `INSTALL.md`, `PREFLIGHT.md`, `IDEAS.md`, `TEAM.md`, `docs/`
- Contains: Markdown documentation, the full architecture reference, and a standalone bilingual HTML page.
- Depends on: Manual synchronization with the actual root scripts, prompts, and application structure (`README.md:73`, `GUIDE.md:149`).
- Used by: New teammates, alternate-agent-runtime users, and the GitHub Pages documentation surface in `docs/index.html`.

## Data Flow

### Primary Request Path

1. Next.js maps an HTTP `GET /` request to the default export in `app/page.jsx:1` under the App Router convention established by the `app/` directory.
2. The server component reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then reduces them to display-only booleans (`app/page.jsx:2`, `app/page.jsx:4`).
3. The component renders a readiness message and configuration statuses without making a database or API request (`app/page.jsx:6`).
4. `RootLayout` wraps the route output in the Russian-language HTML document and inline global body shell (`app/layout.jsx:6`).
5. Next.js serves the rendered response through the selected npm command (`package.json:4`); Vercel recognizes the repository as Next.js through `vercel.json:1`.

### Agent Session and Delivery Flow

1. Codex loads the repository contract from `AGENTS.md:1`; the SessionStart hook counts active guardrails and checks whether scope is filled (`.codex/hooks.json:4`).
2. The session reads current Git state, `.loops/guardrails.md`, `wiki/log.md`, `wiki/index.md`, and `TASKS.md` according to `AGENTS.md:55`.
3. A slash command from `prompts/` drives a bounded workflow; for example, `/autopilot` sequences specification, implementation, live verification, `/ship`, and a human gate (`prompts/autopilot.md:11`).
4. Implementation work is divided by branch/file ownership and reconciled through a pull request by the integrator (`TEAMWORK.md:6`, `TEAMWORK.md:35`).
5. Meaningful outcomes are recorded in `wiki/log.md` and task ownership is maintained in `TASKS.md` as prescribed by `AGENTS.md:81` and `AGENTS.md:110`.

### Environment Bootstrap Flow

1. `setup.sh` parses `--infra`, `--playwright`, and `--check`, rejecting unknown flags (`setup.sh:16`).
2. It enforces Node 22+, verifies npm, and installs or reports Codex, CodeGraph, and optionally Vercel (`setup.sh:35`, `setup.sh:46`).
3. It wires CodeGraph for every teammate, registers Supabase/Vercel MCP only in infrastructure-owner mode, optionally registers Playwright, and copies repository prompts to `~/.codex/prompts/` (`setup.sh:77`, `setup.sh:84`, `setup.sh:101`, `setup.sh:104`).
4. `scaffold.sh` copies `.env.example` to ignored `.env.local` only when the local file is absent, then installs npm dependencies (`scaffold.sh:7`, `scaffold.sh:10`, `scaffold.sh:15`).
5. The teammate starts the application through `npm run dev`, which invokes `next dev` (`package.json:4`).

### Knowledge Ingest Flow

1. A person places immutable source material under `Context/` or `Context/clipped/` (`AGENTS.md:86`).
2. The agent synthesizes source pages under `wiki/sources/`, updates `wiki/entities/` and `wiki/concepts/`, links related pages, updates `wiki/index.md`, and prepends `wiki/log.md` (`AGENTS.md:87`, `AGENTS.md:89`).
3. Obsidian reads the repository as a vault, writes attachments to `Context/clipped/`, and limits its graph view to the three knowledge directories (`.obsidian/app.json:2`, `.obsidian/graph.json:3`).

### Static Guide Interaction

1. A browser loads the standalone HTML/CSS document from `docs/index.html:1`; this path does not enter the Next.js application.
2. The language controls switch between the Russian and English document trees and persist `guide.lang` in browser-local storage (`docs/index.html:501`).
3. Copy buttons read referenced `<pre>` elements and write their text through the Clipboard API, with an in-page success or failure indicator (`docs/index.html:517`).

**State Management:**
- Product state is not implemented; `app/page.jsx` derives transient readiness flags from process environment on render and stores nothing.
- Browser-only guide preference is isolated to `localStorage` in `docs/index.html:511`; no client state library is present.
- Operational state is file-backed and version-controlled in `TASKS.md`, `wiki/`, and `.loops/`; raw source state remains under `Context/`.
- Local runtime state is intentionally ignored: `.env.local`, `node_modules/`, `.next/`, `.vercel/`, and `.codegraph/` are excluded by `.gitignore`.

## Key Abstractions

**Project Scope Contract:**
- Purpose: Lock the visible product, category, stack, single demo path, and explicit non-goals before implementation.
- Examples: `AGENTS.md:11`, `TASKS.md:7`
- Pattern: Human-approved repository configuration expressed as Markdown placeholders; application and database expansion must wait until it is populated.

**App Router Route Module:**
- Purpose: Map filesystem paths to rendered application routes.
- Examples: `app/page.jsx`, `app/layout.jsx`
- Pattern: Framework-reserved file names with default-exported React server components; nested routes belong under new `app/<segment>/` directories.

**Prompt Command:**
- Purpose: Package an operational workflow with a trigger description, exit condition, iteration limit, and safety rules.
- Examples: `prompts/autopilot.md`, `prompts/loop-demo.md`, `prompts/ship.md`
- Pattern: Markdown frontmatter plus imperative steps; `setup.sh:104` copies the repository versions into `~/.codex/prompts/`.

**Persistent Learning Record:**
- Purpose: Prevent repeated failures and loss of decisions between sessions.
- Examples: `.loops/guardrails.md`, `.loops/reflexion.md`, `wiki/log.md`
- Pattern: Append or prepend structured Markdown entries that are re-read during session startup or a matching loop.

**Raw-versus-Derived Knowledge Boundary:**
- Purpose: Preserve source fidelity while allowing agents to maintain concise, cross-linked knowledge.
- Examples: `Context/`, `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`
- Pattern: Never edit `Context/`; write all synthesis and relationships under `wiki/` (`AGENTS.md:81`).

**Shared Infrastructure Boundary:**
- Purpose: Give one infrastructure owner management access while ordinary teammates consume shared settings without managing the services.
- Examples: `setup.sh:84`, `config/mcp.json`, `TEAMWORK.md:13`
- Pattern: Register management MCPs only via `./setup.sh --infra`; keep application credentials in ignored local/server environment files rather than source.

## Entry Points

**Web Root Route:**
- Location: `app/page.jsx`
- Triggers: HTTP request for `/` in local Next.js or Vercel.
- Responsibilities: Compute public configuration readiness and render the starter message.

**Root Document Layout:**
- Location: `app/layout.jsx`
- Triggers: Rendering of every App Router route.
- Responsibilities: Supply page metadata, `<html lang="ru">`, and the global inline body shell.

**Development and Production Commands:**
- Location: `package.json`
- Triggers: `npm run dev`, `npm run build`, or `npm run start`.
- Responsibilities: Dispatch to `next dev`, `next build`, or `next start`.

**Machine Setup:**
- Location: `setup.sh`
- Triggers: `./setup.sh`, `./setup.sh --infra`, `./setup.sh --playwright`, or `./setup.sh --check`.
- Responsibilities: Validate/install tools, register integrations, and copy prompt commands.

**Application Scaffold:**
- Location: `scaffold.sh`
- Triggers: `./scaffold.sh`.
- Responsibilities: Seed `.env.local` once and install project dependencies.

**Agent Session Hook:**
- Location: `.codex/hooks.json`
- Triggers: Codex `SessionStart`.
- Responsibilities: Surface guardrail count and warn about an unfilled project-scope contract.

**Slash Commands:**
- Location: `prompts/*.md`
- Triggers: Named commands after `setup.sh` copies them into `~/.codex/prompts/`.
- Responsibilities: Drive scoped implementation, quality loops, database work, UI polish, pitch creation, and safe shipping.

**Static Team Guide:**
- Location: `docs/index.html`
- Triggers: Direct static-page load, including a GitHub Pages deployment.
- Responsibilities: Render bilingual onboarding content, persist language choice, and copy command/prompt snippets.

## Architectural Constraints

- **Threading:** The Next.js runtime uses the framework request model; `app/page.jsx` performs no background work. `docs/index.html` uses the browser event loop for click handlers and clipboard promises. `setup.sh` and `scaffold.sh` execute sequential shell operations.
- **Global state:** The application exposes only static `metadata` in `app/layout.jsx:1`; no shared mutable server state exists. The only mutable browser global is the local `docs`/`btns` state and `localStorage` preference in `docs/index.html:501`.
- **Circular imports:** No imports exist among the two application modules, so no circular dependency chain is present (`app/page.jsx`, `app/layout.jsx`).
- **Server/client boundary:** Both files in `app/` are server components because neither declares `"use client"`; keep secrets and privileged integrations out of client modules and out of `NEXT_PUBLIC_*` variables (`app/page.jsx:1`, `prompts/schema.md:33`).
- **Route surface:** Only `/` exists; there are no `app/api/**/route.js`, middleware, error boundary, loading boundary, or nested route modules under `app/`.
- **Data boundary:** No Supabase SDK, model, migration, repository, authentication implementation, or API client exists in application code; `app/page.jsx` checks configuration presence only.
- **Scope gate:** The project description, demo path, task assignments, and data contract remain placeholders in `AGENTS.md:11` and `TASKS.md:7`; product-specific layers must follow those decisions rather than precede them.
- **Runtime artifacts:** `.env.local`, `node_modules/`, `.next/`, `.vercel/`, and `.codegraph/` are local/derived and excluded by `.gitignore`; do not make application behavior depend on committed copies of them.
- **Reference-versus-installed layers:** `docs/agent-framework.md` describes optional Graphify, git-hook, and GitHub Actions layers, but the repository contains no tracked `graphify-out/`, `.githooks/`, or `.github/`; verify actual paths before depending on a reference-layer feature.

## Anti-Patterns

### Duplicated Onboarding Source

**What happens:** Team workflow, setup instructions, stack claims, and project ideas are repeated in `GUIDE.md`, `README.md`, `IDEAS.md`, and the two language trees embedded in `docs/index.html`.
**Why it's wrong:** A change to `setup.sh`, `prompts/`, or team policy can leave one or more onboarding surfaces stale; `docs/index.html` already requires parallel Russian and English edits.
**Do this instead:** Treat the root scripts and prompt files as behavioral truth, update `GUIDE.md` plus both `docs/index.html` language sections in the same change, and run the consistency procedure in `prompts/loop-docs-sync.md`.

### Expanding Integration Logic Inside the Page Component

**What happens:** The current readiness page reads environment configuration directly in the render function (`app/page.jsx:2`).
**Why it's wrong:** Extending this pattern to database calls, privileged keys, or business workflows would mix presentation, configuration, and external I/O and make server/client boundaries easy to violate.
**Do this instead:** Keep `app/<segment>/page.jsx` focused on composition; put HTTP entry logic in `app/api/<name>/route.js` and shared server-only integration code in a dedicated `lib/` module once the scope and data contract in `AGENTS.md` and `TASKS.md` are fixed.

### Treating Reference Documentation as Executable State

**What happens:** `docs/agent-framework.md` documents Graphify artifacts, git hooks, GitHub Actions, and local operator-memory layers that are not present as tracked runtime components in this repository.
**Why it's wrong:** Assuming those paths exist can skip required setup, call unavailable automation, or write state to a noncanonical location.
**Do this instead:** Resolve architecture from tracked files such as `.codex/hooks.json`, `setup.sh`, `prompts/`, and `wiki/`; use `docs/agent-framework.md` only as the adoption reference until the corresponding paths are added.

## Error Handling

**Strategy:** Fail early for invalid setup prerequisites, degrade to explicit readiness messages for missing public application configuration, and make operational workflows stop at human or destructive gates.

**Patterns:**
- `setup.sh` rejects unknown arguments and exits for missing/old Node or missing npm (`setup.sh:16`, `setup.sh:35`); helper functions print success/warning/failure status for optional tool installation (`setup.sh:27`, `setup.sh:46`).
- `scaffold.sh` avoids overwriting existing `.env.local` and lets `npm install` report dependency failures (`scaffold.sh:10`, `scaffold.sh:15`).
- `app/page.jsx` converts absent configuration into user-visible “not configured” statuses instead of throwing (`app/page.jsx:2`, `app/page.jsx:18`).
- `docs/index.html` catches blocked local-storage access and clipboard rejection so onboarding navigation remains usable (`docs/index.html:511`, `docs/index.html:523`).
- Agent workflows encode maximum iterations and stop conditions in `prompts/loop-*.md`; destructive database operations stop for operator approval in `prompts/loop-migrate.md:15`.
- No application-level `error.jsx`, structured logger, retry policy, or error response schema is implemented under `app/`.

## Cross-Cutting Concerns

**Logging:** The web application has no logging layer (`app/`). Setup scripts emit human-readable terminal status (`setup.sh:27`), while durable operational narrative belongs in `wiki/log.md` and failed debug attempts in `.loops/reflexion.md`.
**Validation:** `setup.sh` validates flags, Node major version, and command availability; `app/page.jsx` performs only shallow environment-presence checks. No request payload, schema, or domain validation exists because there are no APIs or domain models.
**Authentication:** The application has no user authentication code (`app/`). Supabase/Vercel management authentication occurs outside the app through browser OAuth when MCP servers are registered by `setup.sh:84`; `config/mcp.json` contains endpoints, not embedded credentials.

---

*Architecture analysis: 2026-07-21*
