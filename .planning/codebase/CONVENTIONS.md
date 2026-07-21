# Coding Conventions

**Analysis Date:** 2026-07-21

## Naming Patterns

**Files:**
- Use framework-reserved lowercase names for Next.js App Router entry points: `app/layout.jsx` and `app/page.jsx`.
- Use lowercase kebab-case for reusable operator prompts: `prompts/loop-lint.md`, `prompts/loop-demo.md`, and `prompts/loop-spec-ship.md`.
- Use lowercase action names for executable shell scripts: `setup.sh` and `scaffold.sh`.
- Use uppercase descriptive names for team-facing root documents: `AGENTS.md`, `TASKS.md`, and `TEAMWORK.md`.
- Keep configuration names conventional to their tools: `next.config.mjs`, `vercel.json`, `package.json`, and `.codex/hooks.json`.

**Functions:**
- Name React components in PascalCase and export them as named function declarations: `RootLayout` in `app/layout.jsx` and `Home` in `app/page.jsx`.
- Use camelCase for browser JavaScript functions: `setLang` in `docs/index.html`.
- Use short lowercase verbs for shell helpers: `ok`, `warn`, `miss`, `have`, `install_or_report`, and `add_mcp` in `setup.sh`.
- Keep event callback parameters short only when their scope is a few lines: `b`, `btn`, and `e` stay local to handlers in `docs/index.html`.

**Variables:**
- Prefer `const` for application values that are not reassigned: `url`, `hasUrl`, and `hasKey` in `app/page.jsx`, and `nextConfig` in `next.config.mjs`.
- Prefix booleans with `has` in React code: `hasUrl` and `hasKey` in `app/page.jsx`.
- Use uppercase snake case for shell flags and resolved paths: `INFRA`, `PLAYWRIGHT`, `CHECK`, `STARTER_DIR`, and `GLOBAL_BIN` in `setup.sh`.
- Use lowercase names for shell loop variables and function-local values: `a`, `name`, `chk`, `inst`, `docs`, and `out` in `setup.sh`.
- The standalone guide intentionally follows its local ES5-style convention with `var`, function expressions, and single-letter callback parameters in `docs/index.html`; do not copy that style into `app/*.jsx`.

**Types:**
- Application code is JavaScript/JSX, so no project-defined TypeScript interfaces, type aliases, or enums exist in `app/layout.jsx` or `app/page.jsx`.
- Use JSDoc only where tool typing is useful without TypeScript; `next.config.mjs` annotates `nextConfig` with `import('next').NextConfig`.
- Runtime coercion is explicit where it communicates intent: `Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)` in `app/page.jsx`.

## Code Style

**Formatting:**
- No formatter is configured: `package.json` has no formatting script, and the repository has no Prettier or Biome configuration alongside `next.config.mjs`.
- Use two-space indentation in JSX, JavaScript, JSON, and shell control-flow bodies, matching `app/layout.jsx`, `app/page.jsx`, `config/mcp.json`, and `setup.sh`.
- Terminate JavaScript statements with semicolons, matching `app/layout.jsx`, `app/page.jsx`, `next.config.mjs`, and the script block in `docs/index.html`.
- Use double quotes in React/ES module source, matching `app/layout.jsx`, `app/page.jsx`, and `next.config.mjs`.
- Preserve file-local single quotes in the standalone browser script in `docs/index.html`; this file is a self-contained static artifact with a different established style.
- Include trailing commas in multiline JavaScript object literals, as shown by `metadata` and the inline `style` object in `app/layout.jsx`.
- Wrap multiline JSX around semantic elements rather than forcing long one-line markup, matching `app/page.jsx`.
- Keep React styling colocated as object literals while the application remains this small, matching `app/layout.jsx` and `app/page.jsx`.
- Keep the static guide's visual tokens in CSS custom properties and its styles inside the document, matching `:root` and the `<style>` block in `docs/index.html`.
- Quote every shell path or positional parameter expansion, matching `"$@"`, `"$0"`, `"$STARTER_DIR"`, and `"$GLOBAL_BIN"` in `setup.sh` and `"$ROOT"` in `scaffold.sh`.

**Linting:**
- No ESLint configuration or `lint` script is present in `package.json`; do not claim lint coverage from `next build`.
- The configured code-quality command is `npm run build` from `package.json`; `prompts/loop-lint.md` directs agents to use the available project check and repeat until it exits zero.
- Do not suppress findings with `eslint-disable`, `any`, or equivalent bypasses; this is a hard rule in `prompts/loop-lint.md`.
- Keep fixes surgical and reread auto-fixer changes, following `prompts/loop-lint.md` and `prompts/loop-de-sloppify.md`.
- Validate shell syntax directly with `bash -n setup.sh scaffold.sh`; both scripts pass this check on the analysis date.

## Import Organization

**Order:**
1. No import ordering convention is established because `app/layout.jsx` and `app/page.jsx` use the automatic JSX runtime and contain no imports.
2. `next.config.mjs` uses a JSDoc type import but no runtime import; keep configuration dependency-free unless Next.js configuration requires a module.
3. When imports are introduced, keep them explicit in the consuming module and establish a stable external-before-local order in that file rather than adding an unused import abstraction; this follows the minimal-change rule in `AGENTS.md`.

**Path Aliases:**
- Not detected: there is no `tsconfig.json` or `jsconfig.json`, and `app/layout.jsx`, `app/page.jsx`, and `next.config.mjs` use no aliased paths.
- Use relative paths for local modules until an alias is explicitly configured and used consistently; `AGENTS.md` requires minimum code and no abstractions in advance of need.

## Error Handling

**Patterns:**
- Render recoverable configuration problems as visible state rather than throwing during page render: `app/page.jsx` derives `hasUrl` and `hasKey` and displays a configured/not-configured message.
- Validate external string shape before declaring configuration healthy: `app/page.jsx` requires the public URL to start with `https://`.
- Catch optional browser capability failures locally: `docs/index.html` protects `localStorage` reads/writes with `try/catch` and maps clipboard rejection to a visible `×` state.
- Guard DOM lookups before dereferencing them: `docs/index.html` uses `el ? el.innerText : ''` and falls back to Russian when a requested language key is absent.
- Exit non-zero for unrecoverable CLI input or prerequisites: `setup.sh` exits `1` for an unknown flag, missing Node/npm, and unsupported Node versions.
- Report recoverable setup failures through `miss`/`warn` and return from helpers: `install_or_report` and `add_mcp` in `setup.sh` distinguish already-installed, missing, and failed states.
- Preserve explicit shell status handling in `setup.sh`: it uses `set -uo pipefail` without `set -e`, so command failures that matter must remain inside `if`, `&&`/`||`, or explicit `exit` branches.
- Never expose secret values in errors or logs; `AGENTS.md`, `.loops/guardrails.md`, and `.gitignore` require credentials to remain in ignored environment files.

## Logging

**Framework:** No application logging framework; user-facing shell output via `printf`/`echo` in `setup.sh` and `scaffold.sh`.

**Patterns:**
- Use `ok`, `warn`, and `miss` for categorized setup output instead of ad hoc status formats in `setup.sh`.
- Keep application rendering free of debug logging; `app/layout.jsx`, `app/page.jsx`, and `docs/index.html` contain no `console.log` calls.
- Remove temporary `console.log`, probe output, and debug branches before shipping, as required by `prompts/loop-de-sloppify.md`.
- Record durable decisions in `wiki/log.md`, repeated constraints in `.loops/guardrails.md`, and failed debug attempts in `.loops/reflexion.md`; `AGENTS.md` explicitly forbids hiding durable decisions in code comments.

## Comments

**When to Comment:**
- Use comments for operational intent, safety constraints, and section navigation in scripts, as demonstrated by the setup overview and numbered sections in `setup.sh`.
- Use short comments to identify behavior blocks in a self-contained static file, such as `// language toggle` and `// copy buttons` in `docs/index.html`.
- Do not narrate obvious React markup; `app/layout.jsx` and `app/page.jsx` remain readable without inline comments.
- Put cross-session rationale in `wiki/log.md` or `.loops/guardrails.md`, following `AGENTS.md` and `prompts/loop-guardrails.md`.

**JSDoc/TSDoc:**
- JSDoc is limited to tool-facing type assistance in `next.config.mjs`; no general JSDoc/TSDoc requirement is established in `app/*.jsx`.
- Add API documentation only when a non-obvious contract exists; do not add boilerplate comments to the small components in `app/layout.jsx` or `app/page.jsx`.

## Function Design

**Size:** Keep UI components and browser helpers focused: `Home` is 27 lines in `app/page.jsx`, `RootLayout` is 19 lines in `app/layout.jsx`, and `setLang` is 8 lines in `docs/index.html`. Review newly added functions over roughly 40 lines as directed by `prompts/loop-de-sloppify.md`.

**Parameters:**
- Destructure React props at the boundary, as `RootLayout({ children })` does in `app/layout.jsx`.
- Pass shell helper inputs positionally, assign them immediately to quoted `local` names, and `shift` only after capture, matching `install_or_report` and `add_mcp` in `setup.sh`.
- Keep DOM event parameters inside their handler scope, matching the click callbacks in `docs/index.html`.

**Return Values:**
- React components return one semantic root tree: `<html>` from `app/layout.jsx` and `<main>` from `app/page.jsx`.
- Shell predicates and setup helpers communicate through exit status: `have`, `install_or_report`, and `add_mcp` in `setup.sh`.
- Browser handlers use visible UI fallback rather than returning structured errors in `docs/index.html`.

## Module Design

**Exports:**
- Export each route/layout component as the file's default function, matching `app/page.jsx` and `app/layout.jsx`.
- Use named exports only for framework metadata or reusable values that Next.js reads by name, such as `metadata` in `app/layout.jsx`.
- Export configuration as the default value from ESM config files, matching `next.config.mjs`.
- Keep the standalone guide dependency-free and self-contained in `docs/index.html`.

**Barrel Files:**
- Not used: no `index.js`, `index.jsx`, or shared export aggregator exists under `app/`.
- Do not introduce barrel modules until multiple consumers make them necessary; `AGENTS.md` requires the minimum code for the task.

## Change Discipline

- Touch only files required by the active slice and match the surrounding style, per `AGENTS.md` and `prompts/loop-de-sloppify.md`.
- Keep one locked demo path green and verify behavior by opening the page or exercising the endpoint, per `AGENTS.md` and `prompts/loop-demo.md`.
- Review the full branch diff for correctness, completeness, style, missing tests, and stale documentation before a PR, per `prompts/loop-pr-review.md`.
- Never stage broad paths, secrets, or scratch artifacts; `prompts/ship.md`, `.gitignore`, and `.loops/guardrails.md` require explicit-path staging and secret exclusion.
- Keep user-facing behavior and long-lived operational documentation synchronized through `prompts/loop-docs-sync.md` and `wiki/log.md`.

---

*Convention analysis: 2026-07-21*
