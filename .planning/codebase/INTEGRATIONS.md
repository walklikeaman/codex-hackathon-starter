# External Integrations

**Analysis Date:** 2026-07-21

## APIs & External Services

**Application Runtime:**
- Supabase environment readiness check - `app/page.jsx` reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and renders whether they are present.
  - SDK/Client: Not installed; `package.json` contains no Supabase package, and `app/page.jsx` makes no HTTP/database request.
  - Auth: `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the intended public project key; the current code checks presence only.
- No OpenAI API, Gmail, eBay, or other product API is implemented under `app/`. References in `IDEAS.md` and `docs/index.html` are candidate project prompts, not current integrations.

**Hosting and Deployment:**
- Vercel - builds and hosts the Next.js app, with framework selection committed in `vercel.json`.
  - SDK/Client: Vercel CLI is optionally installed for the infra owner by `setup.sh --infra`; runtime code in `app/` does not use a Vercel SDK.
  - Auth: Interactive `vercel login` for the CLI and browser OAuth for the Vercel MCP, documented in `INSTALL.md` and configured by `setup.sh`.
- GitHub - source repository and trigger source for Vercel's Git-based preview deployments, documented in `INSTALL.md`; the checked-out remote is configured outside source files in `.git/config`.
  - SDK/Client: Git command line; no GitHub SDK or Actions workflow is committed.
  - Auth: Developer-local Git credentials; no repository credential is stored in tracked application files, as required by `.gitignore` and `.loops/guardrails.md`.

**Agent and Development Tooling:**
- OpenAI Codex - installed globally by `setup.sh` and authenticated interactively on first use according to `INSTALL.md`; it is a development tool, not an application runtime API.
  - SDK/Client: `@openai/codex` global npm package installed by `setup.sh`.
  - Auth: Interactive OpenAI/ChatGPT sign-in; no auth value is committed.
- CodeGraph - local source-code index exposed as a stdio MCP server by `config/mcp.json` and wired into Codex by `setup.sh`.
  - SDK/Client: Global `@colbymchenry/codegraph` CLI; indexes are local under `.codegraph/` and ignored by `.gitignore`.
  - Auth: None; `setup.sh` identifies CodeGraph as local and unauthenticated.
- Supabase MCP - lets the infra owner manage the shared Supabase project through the agent; endpoint and registration are defined in `config/mcp.json` and `setup.sh`.
  - SDK/Client: HTTP MCP endpoint `https://mcp.supabase.com/mcp`; not an application dependency in `package.json`.
  - Auth: Browser OAuth on first use, with the shared project selected interactively as documented in `INSTALL.md`.
- Vercel MCP - lets the infra owner inspect deployments, logs, and errors through the agent; endpoint and registration are defined in `config/mcp.json` and `setup.sh`.
  - SDK/Client: HTTP MCP endpoint `https://mcp.vercel.com`; not an application dependency in `package.json`.
  - Auth: Browser OAuth on first use, documented in `INSTALL.md`.
- Playwright MCP - optional real-browser automation for demo-path checks, configured in `config/mcp.json` and enabled by `setup.sh --playwright`.
  - SDK/Client: stdio process launched with `npx -y @playwright/mcp@latest`; it is not pinned by `package-lock.json`.
  - Auth: Not applicable; target applications may have their own auth, but this starter does not implement one.

## Data Storage

**Databases:**
- Supabase managed PostgreSQL is the intended shared database described in `README.md`, `INSTALL.md`, and `AGENTS.md`.
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` names the project endpoint and `NEXT_PUBLIC_SUPABASE_ANON_KEY` names the public browser credential in `app/page.jsx`.
  - Client: Not detected; no ORM, database driver, or `@supabase/supabase-js` dependency exists in `package.json`.
  - Schema: Not detected; there is no Supabase directory, SQL migration, Prisma schema, or application data model in the repository. `TASKS.md` explicitly leaves the data contract unfilled.
  - Runtime status: Not connected in code; `app/page.jsx` only displays configuration presence and performs no read/write.

**File Storage:**
- No application file-storage integration is implemented under `app/`. Supabase Storage is named as a capability in `GUIDE.md` and `docs/index.html`, but there is no storage client, bucket configuration, or upload code in `package.json` or `app/`.
- Repository-local Markdown knowledge is stored in `wiki/` and immutable source material in `Context/`; these are Git-managed project files, not runtime user-data storage, as defined by `AGENTS.md`.

**Caching:**
- None configured - there is no Redis/provider client in `package.json`, no cache configuration in `next.config.mjs`, and no application cache access in `app/`.
- Next.js may apply framework-level build/render caching, but the repository declares no explicit cache policy in `app/page.jsx` or `next.config.mjs`.

## Authentication & Identity

**Auth Provider:**
- End-user authentication: Not implemented. Supabase Auth is an intended shared-infrastructure capability in `README.md` and `INSTALL.md`, but `app/` contains no sign-in flow, session handling, middleware, or auth SDK.
  - Implementation: Add end-user auth only after the project scope and data contract are fixed in `AGENTS.md` and `TASKS.md`; use a Supabase client dependency rather than treating the env check in `app/page.jsx` as an authenticated connection.
- Development-tool identity: Codex uses interactive OpenAI sign-in, Vercel CLI uses `vercel login`, and Supabase/Vercel MCP use browser OAuth as documented in `INSTALL.md`.
  - Implementation: Credentials remain in developer/tool-managed local stores and must not be committed; `.gitignore` and `.loops/guardrails.md` enforce the repository-side boundary.

## Monitoring & Observability

**Error Tracking:**
- No application error-tracking provider or SDK is configured in `package.json`, `next.config.mjs`, or `app/`.
- Vercel deployment/runtime logs and errors are accessible to the infra owner through Vercel MCP according to `AGENTS.md`, `README.md`, and `config/mcp.json`; this is operational access, not in-process instrumentation.

**Logs:**
- Application logging is not implemented in `app/page.jsx` or `app/layout.jsx`.
- Setup diagnostics are printed to the terminal by `setup.sh` and `scaffold.sh`; these shell messages are local operational output and have no remote log sink.
- Use Vercel's platform logs for deployed Next.js output, accessed through the Vercel dashboard/CLI/MCP described in `INSTALL.md` and `config/mcp.json`.

## CI/CD & Deployment

**Hosting:**
- Vercel - `vercel.json` explicitly selects the Next.js framework; `README.md` and `GUIDE.md` identify Vercel as the shared deployment target.
- A documented starter URL exists in `GUIDE.md` and `docs/index.html`, but runtime availability is not established by repository configuration alone.
- Preview deployment is the permitted default; production-domain deployment requires human approval under `.loops/guardrails.md` and `AGENTS.md`.

**CI Pipeline:**
- Vercel Git integration - pushed branches receive preview deployments and `main` is documented as production in `INSTALL.md`.
- No repository-owned CI workflow is detected: there is no `.github/workflows/`, `.gitlab-ci.yml`, or other CI pipeline definition. Treat Vercel project settings as external state, not reproducible repository configuration.
- Build command is `npm run build` (`next build`) from `package.json`; no lint, typecheck, or test command is defined there.

## Environment Configuration

**Required env vars:**
- `NEXT_PUBLIC_SUPABASE_URL` - read by `app/page.jsx`; expected to begin with `https://` for the UI's configured status.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - read by `app/page.jsx`; expected to be non-empty for the UI's configured status.
- No other runtime environment variables are referenced in `app/`, `next.config.mjs`, or `vercel.json`.

**Secrets location:**
- `.env.example` exists as the committed template; this audit records its presence only and does not reproduce its contents.
- `scaffold.sh` copies the template to `.env.local` only if that local file does not already exist.
- `.env`, `.env.*`, `.key`, `.pem`, and Vercel local state are excluded by `.gitignore`; `.env.example` is the explicit committed exception.
- Deployed values are configured through Vercel Environment Variables according to `INSTALL.md`; Supabase/Vercel MCP credentials are held by their OAuth clients rather than source files according to `config/mcp.json`.
- Both currently referenced Supabase variables are `NEXT_PUBLIC_*` and therefore are not suitable for service-role keys or other server secrets; `prompts/schema.md` explicitly directs server-only credentials away from the public prefix.

## Webhooks & Callbacks

**Incoming:**
- None implemented - the `app/` tree contains only `app/layout.jsx` and `app/page.jsx`; there are no API routes, route handlers, or callback endpoints.
- Supabase Auth callbacks are not implemented because there is no end-user auth flow under `app/`.

**Outgoing:**
- None implemented in application code - `app/page.jsx` does not call `fetch`, an SDK, a webhook, or a database client.
- Git pushes trigger Vercel deployments through externally configured Git integration described in `INSTALL.md`; this is a platform integration, not an outgoing webhook implemented by the application.

---

*Integration audit: 2026-07-21*
