# Codebase Concerns

**Analysis Date:** 2026-07-21

## Tech Debt

**Project definition is still placeholder-only:**
- Issue: The repository requires the project idea, stack, single demo path, out-of-scope boundary, owners, tasks, and data contract to be locked before feature work, but every one of those fields is still a template placeholder.
- Files: `AGENTS.md`, `TASKS.md`, `wiki/overview.md`
- Impact: There is no authoritative product scope or integration contract. Parallel frontend/backend work can diverge, and the mandated demo-path validation has no defined target.
- Fix approach: Fill `AGENTS.md` and `TASKS.md` at kickoff, then summarize the locked decision in `wiki/overview.md` before creating schema or feature code.

**No automated quality gate:**
- Issue: The package exposes only `dev`, `build`, and `start`; there is no lint, test, typecheck, coverage, audit, or CI command.
- Files: `package.json`, `prompts/loop-lint.md`, `prompts/loop-demo.md`
- Impact: `/loop-lint` can fall back only to a production build. Shell behavior, onboarding JavaScript, regressions, and dependency vulnerabilities can reach a preview or `main` without a failing gate.
- Fix approach: Add explicit `lint`, `test`, `typecheck` where applicable, and a single `check` script that runs all required gates. Run `npm ci`, `npm run check`, and `npm run build` in a pull-request workflow.

**Implementation and documentation disagree about the application root:**
- Issue: The Next.js application and `.env.local` live at the repository root, but several current instructions still direct users to `app/.env.local`, say scaffolding creates an app in `./app`, recommend running CodeGraph from `app/`, or describe a removed positional argument to `scaffold.sh`.
- Files: `scaffold.sh`, `PREFLIGHT.md`, `INSTALL.md`, `AGENTS.md`, `README.md`
- Impact: Following the stale path creates configuration where root-level Next.js does not load it, produces a misleading “Supabase not configured” status, and sends users to commands that the current script does not support.
- Fix approach: Make root-level `.env.local` and root-level commands canonical, remove the obsolete `./scaffold.sh web` troubleshooting entry, and search all onboarding documents for `app/.env.local` and old scaffold behavior whenever setup changes.

**Onboarding content has multiple manually maintained sources:**
- Issue: Installation, shared-infrastructure, command, teamwork, and idea text is duplicated across Markdown documents and a 532-line bilingual static HTML file.
- Files: `README.md`, `GUIDE.md`, `INSTALL.md`, `PREFLIGHT.md`, `КОМАНДЕ.md`, `IDEAS.md`, `docs/index.html`
- Impact: Behavior changes require synchronized edits in many files. Current root-path drift demonstrates that copies do not stay consistent.
- Fix approach: Designate one Markdown source per topic and generate `docs/index.html` plus condensed onboarding documents from it, or reduce secondary documents to links into the canonical source.

**Build workspace root is environment-dependent:**
- Issue: `next.config.mjs` is empty. During the verified build, Next.js found a second lockfile at `/Users/msk-hq-nb-2469/package-lock.json` and inferred that parent directory as the workspace root.
- Files: `next.config.mjs`, `package-lock.json`
- Impact: Output-file tracing and build inputs can depend on files outside this repository, creating local/CI differences and potentially enlarging deployment traces.
- Fix approach: Set `outputFileTracingRoot` explicitly to the repository root and keep the build rooted at the directory containing this `package-lock.json`.

## Known Bugs

**`setup.sh --check` reports failure but exits successfully:**
- Symptoms: Missing required CLIs are printed with red failure markers, followed by `check done`, and the process exits with status `0`.
- Files: `setup.sh`
- Trigger: Run `./setup.sh --check` with Node/npm available but `codex` or `codegraph` absent. This was reproduced on 2026-07-21; both tools were reported missing and the observed exit status was `0`.
- Workaround: Read the textual output rather than trusting the exit code. The fix is to accumulate a failure flag or return immediately, then exit non-zero when any required check fails.

**`scaffold.sh` can print a false success banner:**
- Symptoms: A failed dependency installation can be followed by `✅ Готово`, and the script can finish with status `0` because the final heredoc succeeds.
- Files: `scaffold.sh`
- Trigger: Any `npm install --no-audit --no-fund` failure, such as registry/network failure or an invalid lockfile. The script uses `set -uo pipefail` without `-e` and does not test the npm command's status.
- Workaround: Inspect npm output manually. The fix is an explicit `if ! npm ...; then ...; exit 1; fi` and a post-install `npm ls --depth=0` verification.

**MCP setup failures do not fail the setup run:**
- Symptoms: `add_mcp` prints an error, but its error branch ends with the successful `miss` formatter; the overall script can still print `Setup done` and exit `0`.
- Files: `setup.sh`
- Trigger: Run `./setup.sh --infra` when `codex mcp add` fails for reasons other than the loose `exist|already` output match.
- Workaround: Verify with `codex mcp list`. The fix is to return non-zero from the failure branch, aggregate MCP failures, and base the closing banner and exit status on that aggregate.

**The home page claims connectivity without testing connectivity:**
- Symptoms: The page says `Окружение работает` and marks Supabase as connected when the URL merely starts with `https://` and the anon-key variable is merely non-empty.
- Files: `app/page.jsx`
- Trigger: Supply a syntactically HTTPS but incorrect URL and any non-empty key; no Supabase request is made.
- Workaround: Treat the page as an environment-presence indicator only. The fix is a server-side health query against a known harmless resource, with separate “configured” and “reachable” states.

**The published guide's table of contents does not navigate to sections:**
- Symptoms: Every Russian and English table-of-contents link targets `#top`, so selecting any section returns to the top instead of the requested content.
- Files: `docs/index.html`
- Trigger: Click any item under `Содержание` or `Contents`.
- Workaround: Scroll manually. The fix is to assign stable section IDs and point each localized link at its corresponding ID.

## Security Considerations

**Shared client configuration is distributed from a tracked env template:**
- Risk: Repository documentation and the scaffold script state that the tracked env template contains the shared Supabase URL and anon key. Although an anon key is intended for clients, anyone with the repository can exercise every operation allowed to the anon role; a weak or accidental RLS policy exposes the shared event data.
- Files: `.env.example` (existence only; contents not inspected), `scaffold.sh`, `README.md`, `GUIDE.md`, `docs/index.html`, `INSTALL.md`
- Current mitigation: `.env.local` is gitignored, the application uses only `NEXT_PUBLIC_*` names, and `prompts/schema.md` instructs the backend owner to enable RLS and add policies scoped to the demo path.
- Recommendations: Keep privileged/service-role keys out of all tracked files, test RLS with anon credentials before every demo, restrict policies to the exact demo operations, and rotate/recreate the shared project if it is reused beyond the event.

**One write-capable control plane has a broad blast radius:**
- Risk: The infra owner connects write-capable Supabase and Vercel MCP servers to the single shared projects. An agent mistake, wrong OAuth project selection, or compromised operator session can alter shared schema, data, functions, or deployment settings.
- Files: `setup.sh`, `config/mcp.json`, `AGENTS.md`, `INSTALL.md`
- Current mitigation: Only the person running `./setup.sh --infra` is told to connect those MCP servers, and `TASKS.md` reserves schema ownership for one backend role.
- Recommendations: Scope OAuth to the intended projects, keep non-owners read-only or disconnected, apply schema changes through committed migrations, preserve a recoverable seed/backup, and verify the selected project before each mutation.

**Preview branches share production-like backend state:**
- Risk: Every branch gets a Vercel preview while all teammates use one Supabase project. Experimental frontend or migration code can read or mutate the same data used by the demo and other branches.
- Files: `TEAMWORK.md`, `INSTALL.md`, `AGENTS.md`, `prompts/schema.md`
- Current mitigation: The docs require one schema owner and an agreed data contract before parallel work.
- Recommendations: Use separate preview/test data or schemas, mark seed rows by branch/session, gate destructive migrations, and reserve a stable dataset for the demo path.

**Bootstrap executes unpinned third-party code globally:**
- Risk: Setup installs the latest available Codex, CodeGraph, and Vercel packages globally, while optional Playwright wiring executes `@playwright/mcp@latest` through `npx -y`. A registry compromise or breaking release affects every participant and mutates their global toolchain.
- Files: `setup.sh`, `config/mcp.json`
- Current mitigation: Installation is explicit and Playwright is opt-in.
- Recommendations: Pin tested versions (including the Playwright MCP), record checksums or a tested version matrix, prefer project-local tooling where practical, and rerun the preflight after version changes.

**Setup overwrites global prompt files without backup:**
- Risk: `cp prompts/*.md "$HOME/.codex/prompts/"` silently replaces same-named personal prompt files outside the repository.
- Files: `setup.sh`, `prompts/ship.md`, `prompts/loop-demo.md`, `prompts/loop-lint.md`
- Current mitigation: The copied filenames are repository-controlled and the operation is documented as idempotent.
- Recommendations: Compare before copying, back up or refuse to overwrite divergent files, or install project prompts under a namespaced directory.

## Performance Bottlenecks

**Runtime bottlenecks are not currently present, but the baseline has no performance budget:**
- Problem: The only application route is a statically rendered 27-line status page. The verified production build reports about 102 kB of shared first-load JavaScript, but no bundle budget or regression check exists.
- Files: `app/page.jsx`, `app/layout.jsx`, `package.json`
- Cause: The repository is still a framework starter; performance-sensitive user flows, database queries, media handling, and AI requests have not been implemented.
- Improvement path: Add a bundle-size or Lighthouse budget when the demo flow is chosen, and measure the actual critical route after each integration rather than optimizing the placeholder page.

**Bootstrap work is serial and network-heavy:**
- Problem: A clean setup can install multiple global npm packages, application dependencies, and optionally a browser runtime before useful work begins.
- Files: `setup.sh`, `scaffold.sh`, `package-lock.json`
- Cause: Tool installation and application bootstrap are combined into synchronous scripts, with no versioned cache or offline path.
- Improvement path: Preinstall during preflight, pin/cache artifacts, use `npm ci` for deterministic application installs, and keep `--check` reliable so missing prerequisites are found before the timed event.

## Fragile Areas

**Shell bootstrap and scaffold:**
- Files: `setup.sh`, `scaffold.sh`
- Why fragile: Both scripts mutate machine-global state or local configuration, use no automated shell tests, and currently allow command failures to be masked by later successful output.
- Safe modification: Preserve `--check` as non-mutating, make every required failure contribute to the final exit status, avoid silent overwrites, and test with fake commands for success/missing/failure/already-installed branches.
- Test coverage: No Bats/shell test suite or CI job covers argument parsing, failed installs, PATH repair, MCP errors, or env seeding.

**Bilingual static onboarding page:**
- Files: `docs/index.html`, `GUIDE.md`, `IDEAS.md`, `TEAMWORK.md`
- Why fragile: Russian and English copies plus duplicated prompts are maintained in one large HTML file, and navigation/copy behavior is inline JavaScript with no DOM test.
- Safe modification: Generate both languages from structured source content, keep stable IDs, and validate all anchors and copy targets after content changes.
- Test coverage: No HTML validation, link checker, accessibility audit, or browser test covers the published guide.

**Environment status page:**
- Files: `app/page.jsx`, `next.config.mjs`, `vercel.json`
- Why fragile: Its result is determined from build-time environment strings, not service availability; changing runtime configuration without a rebuild can leave stale output.
- Safe modification: Define whether this is a build-time configuration badge or a runtime health check, implement that contract explicitly, and avoid presenting presence checks as connectivity.
- Test coverage: No tests cover missing, malformed, stale, or valid environment configurations.

**Shared database contract:**
- Files: `TASKS.md`, `TEAMWORK.md`, `AGENTS.md`, `prompts/schema.md`
- Why fragile: All branches and four team roles depend on one database, while the data contract and schema owner remain unassigned placeholders.
- Safe modification: Lock the contract and owner first, use committed forward-only migrations, seed reproducible demo data, and coordinate changes through `TASKS.md`.
- Test coverage: No schema, migration, RLS, or application-to-Supabase integration tests exist yet.

**Next build root inference:**
- Files: `next.config.mjs`, `package-lock.json`
- Why fragile: The same repository can trace a different root based on unrelated parent lockfiles on a developer machine.
- Safe modification: Pin `outputFileTracingRoot` and verify the build from a clean checkout and the deployment environment.
- Test coverage: The local production build passes, but no clean-checkout CI build verifies isolation from parent-directory state.

## Scaling Limits

**Single shared Supabase/Vercel environment:**
- Current capacity: The documented operating model is one team of four, one Supabase project, one Vercel project, and one infrastructure owner.
- Limit: Additional teams, parallel demos, or incompatible branch schemas collide in the same backend and control plane.
- Scaling path: Provision per-team or per-environment projects from migration/seed scripts, inject environment-specific variables, and retain a protected shared demo environment.
- Files: `TEAMWORK.md`, `INSTALL.md`, `AGENTS.md`, `TASKS.md`

**No application-level scaling contract exists yet:**
- Current capacity: One static page with no API routes, database queries, uploads, authentication, queues, or AI calls.
- Limit: Rate limits, request/body limits, concurrency, retries, timeouts, and cost ceilings are undefined for whichever demo idea is selected.
- Scaling path: After scope is locked in `AGENTS.md`, document limits for the chosen external calls, bound input sizes and timeouts, and add one load/concurrency check for the demo path.
- Files: `app/page.jsx`, `AGENTS.md`, `IDEAS.md`

## Dependencies at Risk

**Next.js transitive PostCSS vulnerability:**
- Risk: The current lock resolves Next.js `15.5.20` with PostCSS `8.4.31`. `npm audit --omit=dev` on 2026-07-21 reports two moderate findings (the direct `next` chain and `postcss`) for an XSS issue in PostCSS CSS stringification.
- Impact: Code paths that stringify attacker-influenced CSS can emit unescaped `</style>` content. The placeholder page does not currently process user CSS, but proposed generated-UI ideas could make this relevant.
- Migration plan: Upgrade to a framework/dependency set that resolves PostCSS `>=8.5.10`, rerun build and audit, and do not accept npm's reported major downgrade suggestion without validating framework support.
- Files: `package.json`, `package-lock.json`

**Unpinned global CLIs and MCP runtime:**
- Risk: Global installs and `@playwright/mcp@latest` can change behavior between teammates or on event day without repository changes.
- Impact: Setup, MCP flags, authentication, or browser automation can break at the worst time and cannot be reproduced from `package-lock.json`.
- Migration plan: Pin versions tested by `PREFLIGHT.md`, surface them in `./setup.sh --check`, and update them deliberately.
- Files: `setup.sh`, `PREFLIGHT.md`, `config/mcp.json`

**Node/npm runtime is documented but not machine-enforced:**
- Risk: The shell script requires Node 22+, but there is no `engines`, `packageManager`, `.nvmrc`, or equivalent repository pin; npm behavior already varies by version (npm 12 blocked the `sharp` install script during the verified install).
- Impact: Contributors and Vercel can resolve/install packages with different runtime and lifecycle-script policies.
- Migration plan: Add `engines` and `packageManager` to `package.json`, add a runtime version file, configure Vercel to the same major, and verify image optimization on the chosen npm policy.
- Files: `package.json`, `setup.sh`, `package-lock.json`, `vercel.json`

## Missing Critical Features

**No selected product or end-to-end demo flow:**
- Problem: The repository still serves only the setup status page; project, scope, roles, tasks, and data contract are unfilled.
- Blocks: Feature implementation, schema design, meaningful UAT, pitch preparation, and the required single green demo path.
- Files: `app/page.jsx`, `AGENTS.md`, `TASKS.md`, `wiki/overview.md`

**No real Supabase integration:**
- Problem: The app reads environment strings but contains no Supabase client, query, migration, schema, RLS policy, or health request.
- Blocks: The mandatory “one real write” infrastructure smoke test described by onboarding cannot be performed by the checked-in application.
- Files: `app/page.jsx`, `package.json`, `INSTALL.md`, `prompts/schema.md`

**No CI or deployment verification gate:**
- Problem: Vercel deployment is documented, but no repository workflow installs from the lockfile, runs audit/tests/build, or exercises the deployed page.
- Blocks: Reliable merge decisions and automatic detection of broken setup scripts, guide navigation, app builds, or demo paths.
- Files: `package.json`, `TEAMWORK.md`, `prompts/ship.md`, `vercel.json`

**No observability or recovery path:**
- Problem: There is no application error tracking, structured logging, uptime check, database backup/restore procedure, or incident runbook for the shared demo infrastructure.
- Blocks: Fast diagnosis and recovery when the single shared environment fails during integration or demonstration.
- Files: `app/page.jsx`, `INSTALL.md`, `TEAMWORK.md`, `.loops/reflexion.md`

## Test Coverage Gaps

**Setup command behavior:**
- What's not tested: Exit codes and output for missing prerequisites, install failures, PATH repair, `--infra`, `--playwright`, duplicate MCP registration, MCP failure, and prompt overwrite behavior.
- Files: `setup.sh`
- Risk: The main onboarding command can report success while required tooling or integrations are absent.
- Priority: High

**Scaffold failure and idempotency behavior:**
- What's not tested: Failed npm install, missing env template, existing `.env.local`, deterministic lockfile installation, and reruns.
- Files: `scaffold.sh`, `package-lock.json`
- Risk: Participants receive a green banner for an unusable environment or silently retain stale configuration.
- Priority: High

**Application health semantics:**
- What's not tested: Missing/malformed/invalid Supabase URL and key, real service reachability, static rebuild behavior, rendered copy, and accessibility.
- Files: `app/page.jsx`, `app/layout.jsx`
- Risk: The sole deployed page can falsely certify infrastructure readiness.
- Priority: High

**Shared backend policies and data isolation:**
- What's not tested: RLS allow/deny paths, anonymous operations, schema migration repeatability, preview-branch data separation, and recovery from a bad migration.
- Files: `prompts/schema.md`, `INSTALL.md`, `TASKS.md`
- Risk: Public client credentials or parallel branches can expose or corrupt the one shared demo dataset.
- Priority: High

**Published onboarding guide:**
- What's not tested: Anchor validity, copy-button targets, language persistence, external links, mobile layout, and reduced-motion/accessibility behavior.
- Files: `docs/index.html`
- Risk: Setup instructions fail at the exact point new contributors depend on them; the broken table of contents is already observable.
- Priority: Medium

**Dependency and clean-checkout build health:**
- What's not tested: Automated audit, Node/npm version matrix, clean `npm ci`, workspace-root isolation, and Vercel-equivalent production build.
- Files: `package.json`, `package-lock.json`, `next.config.mjs`, `vercel.json`
- Risk: Known vulnerabilities and machine-specific build behavior remain invisible until deployment.
- Priority: High

---

*Concerns audit: 2026-07-21*
