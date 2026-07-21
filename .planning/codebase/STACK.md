# Technology Stack

**Analysis Date:** 2026-07-21

## Languages

**Primary:**
- JavaScript with JSX (ECMAScript modules; version not pinned) - Next.js App Router UI in `app/page.jsx`, root layout in `app/layout.jsx`, and build configuration in `next.config.mjs`.

**Secondary:**
- Bash - idempotent workstation/tooling setup in `setup.sh` and application dependency/env bootstrap in `scaffold.sh`.
- HTML and CSS - standalone bilingual onboarding site with embedded styles in `docs/index.html`; it is documentation, not part of the Next.js route tree under `app/`.
- JSON - package metadata and lock state in `package.json` and `package-lock.json`, Vercel selection in `vercel.json`, MCP examples in `config/mcp.json`, and session hooks in `.codex/hooks.json`.
- Markdown - operating instructions, prompts, project memory, and planning context in `AGENTS.md`, `README.md`, `INSTALL.md`, `prompts/`, and `wiki/`.
- TypeScript - Not detected in implementation; no `.ts`/`.tsx` files or TypeScript compiler configuration are present. Do not assume the TypeScript claim in `README.md` reflects the current app under `app/`.

## Runtime

**Environment:**
- Node.js 22 or newer is the project-level development requirement enforced by `setup.sh`; the audited workstation has Node.js 26.5.0.
- Next.js 15.5.20 itself accepts Node.js `^18.18.0 || ^19.8.0 || >=20.0.0` according to `package-lock.json`, but use the stricter Node.js 22+ project requirement from `setup.sh` because Codex and CodeGraph are part of the expected workflow.
- No Node runtime pin is committed: `package.json` has no `engines` field, and `.nvmrc`, `.node-version`, and `.tool-versions` are absent.

**Package Manager:**
- npm; the audited workstation has npm 12.0.0, but the npm version is not pinned in `package.json`.
- Lockfile: present at `package-lock.json`, lockfile format version 3.
- Installed dependency state: `node_modules/` is absent and `npm ls --depth=0` reports the three direct dependencies missing. Run `./scaffold.sh` or `npm install` before build/dev commands; the prescribed install path is `scaffold.sh`.

## Frameworks

**Core:**
- Next.js 15.5.20 - full-stack React framework and App Router runtime; the route tree is rooted at `app/`, exact resolved version is in `package-lock.json`, and the declared range is in `package.json`.
- React 19.2.7 - component/rendering model used by `app/layout.jsx` and `app/page.jsx`; exact resolved version is in `package-lock.json`.
- React DOM 19.2.7 - browser/server DOM renderer brought in by Next.js; exact resolved version is in `package-lock.json`.

**Testing:**
- Not detected - `package.json` defines no test script or test dependency, and the repository contains no Jest, Vitest, Playwright Test, or other test configuration. The optional browser MCP in `config/mcp.json` is an agent tool, not a checked-in test suite.

**Build/Dev:**
- Next.js CLI 15.5.20 - `npm run dev`, `npm run build`, and `npm run start` map directly to `next dev`, `next build`, and `next start` in `package.json`.
- SWC platform binaries 15.5.20 - optional native compiler packages resolved through Next.js in `package-lock.json`; select the matching platform package through npm rather than declaring one directly.
- PostCSS 8.4.31 and styled-jsx 5.1.6 - transitive Next.js build/style dependencies in `package-lock.json`; there is no project-level PostCSS or Tailwind configuration.
- Vercel framework detection - forced to `nextjs` by `vercel.json`; `next.config.mjs` currently exports an empty configuration object.

## Key Dependencies

**Critical:**
- `next` `^15.5.20` (resolved 15.5.20) - owns routing, server rendering, development server, build, and production server; declared in `package.json` and resolved in `package-lock.json`.
- `react` `^19.2.7` (resolved 19.2.7) - UI component runtime used in `app/`; declared in `package.json` and resolved in `package-lock.json`.
- `react-dom` `^19.2.7` (resolved 19.2.7) - React DOM integration required by Next.js; declared in `package.json` and resolved in `package-lock.json`.

**Infrastructure:**
- `@openai/codex` (globally installed, version unpinned) - interactive coding agent installed by `setup.sh`; it is not an application dependency in `package.json`.
- `@colbymchenry/codegraph` (globally installed, version unpinned) - local code knowledge graph installed and wired into Codex by `setup.sh`; local indexes are excluded by `.gitignore`.
- `vercel` CLI (globally installed, version unpinned, infra-owner only) - preview deployment CLI installed by `setup.sh --infra`; deployment framework selection lives in `vercel.json`.
- `@playwright/mcp@latest` (optional, intentionally floating) - browser-driving MCP started through `npx` by `setup.sh --playwright` and described in `config/mcp.json`; it is not present in `package.json` or `package-lock.json`.
- `sharp` 0.34.5 (optional transitive dependency) - Next.js image-processing optimization resolved in `package-lock.json`; application code under `app/` does not import it directly.

## Configuration

**Environment:**
- Keep local environment configuration in `.env.local`, which is ignored by `.gitignore` and created only when absent by `scaffold.sh` from the committed `.env.example` template.
- `.env.example` is present as the environment template; its contents are intentionally not reproduced in this map. Use source references in `app/page.jsx` as the current contract.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the only environment variable names read by runtime code in `app/page.jsx`.
- Both variables use Next.js's public prefix and are therefore browser-exposable by design. Put server-only credentials in unprefixed variables, as reinforced by `prompts/schema.md`.
- The current page only validates that the URL looks HTTPS and that the key is non-empty in `app/page.jsx`; no Supabase SDK or database request is installed or executed.

**Build:**
- `package.json` - canonical npm dependency and command manifest.
- `package-lock.json` - reproducible dependency graph and exact package versions.
- `next.config.mjs` - empty Next.js configuration; add framework behavior here only when required.
- `vercel.json` - forces the Vercel builder to treat the repository as Next.js.
- `app/layout.jsx` - document metadata, root HTML language, and global inline layout styling.
- `.gitignore` - excludes dependency output, `.next/`, Vercel local state, CodeGraph indexes, environment files, and other local artifacts.
- `.codex/hooks.json` - Codex session-start guardrail/scope reminders; it affects the agent workflow, not the application runtime.
- No `tsconfig.json`, `jsconfig.json`, ESLint configuration, Tailwind configuration, PostCSS configuration, Dockerfile, or container orchestration file is present.

## Platform Requirements

**Development:**
- Use Node.js 22+ and npm as checked by `setup.sh`; Git is required by the onboarding flow in `INSTALL.md`.
- Install application dependencies with `./scaffold.sh`, which invokes npm and initializes `.env.local` without overwriting an existing local file.
- Use `npm run dev` from `package.json` for the application at `http://localhost:3000`, then build with `npm run build` before shipping.
- Codex CLI and CodeGraph are expected project-workflow tools installed by `setup.sh`; Vercel CLI and Supabase/Vercel MCP access are limited to the infra owner through `setup.sh --infra`.
- Playwright MCP is opt-in through `setup.sh --playwright`; do not treat it as an installed test dependency because it is not locked by `package-lock.json`.

**Production:**
- Vercel is the declared hosting/build target in `vercel.json`, `README.md`, and `INSTALL.md`.
- Vercel's connected Git repository performs preview builds for pushed branches; `main` is documented as the production branch in `INSTALL.md`.
- The deployed application needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured in Vercel Environment Variables for the status checks in `app/page.jsx` to report connected.
- No Docker image, standalone server deployment manifest, or alternate cloud runtime is configured in the repository.

---

*Stack analysis: 2026-07-21*
