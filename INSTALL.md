# INSTALL — fresh-machine setup

Everything to stand up the starter on a laptop that has nothing yet. Budget
~25-40 min the day BEFORE the hackathon (Wi-Fi and npm are slower on-site, and
the app scaffold + first MCP OAuth are best done at home).

## 0. Prerequisites

| Need           | Check            | Get it                                              |
| -------------- | ---------------- | --------------------------------------------------- |
| **Node 22+**   | `node --version` | https://nodejs.org or `nvm install 22`              |
| **git**        | `git --version`  | Xcode CLT (`xcode-select --install`) / your pkg mgr |
| **A terminal** | —                | Terminal.app / iTerm                                |

`setup.sh` refuses to run below Node 22 (Codex + CodeGraph both need it).

## 1. Accounts to have ready (BEFORE the day)

One shared project: **one** Supabase database and **one** Vercel project for the
whole team, not one per person. Each teammate needs only OpenAI + GitHub.

| Account                    | Who      | Why                                                            |
| -------------------------- | -------- | -------------------------------------------------------------- |
| **OpenAI** (ChatGPT / API) | everyone | Codex sign-in; $150 credits at the event                       |
| **GitHub**                 | everyone | push to the one shared repo (owner adds you as collaborator)   |
| **Supabase**               | owner    | one shared database; owner shares the URL + anon key           |
| **Vercel**                 | owner    | one shared project, linked to the repo (auto-deploys branches) |

We ship **no credentials**. The owner sets up the shared Supabase + Vercel once
and shares the Supabase keys; everyone else just needs OpenAI + GitHub.

### Owner — once for the whole team

1. Create one Supabase project and one Vercel project.
2. In Vercel: Import Project → pick the shared GitHub repo (every branch push then gets a preview URL).
3. Send the team the Supabase URL + anon key (for `app/.env.local`).
4. Run `./setup.sh --infra` so your Codex can manage the schema via the Supabase/Vercel MCP.
5. Add teammates as collaborators (repo → Settings → Collaborators).

## 2. Get the code

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git
cd codex-hackathon-starter
```

It's a shared team repo — the owner adds teammates as **collaborators** (repo →
Settings → Collaborators) so everyone can `/ship` (push). Non-collaborators can
fork and open a PR instead.

## 3. Run setup

```bash
./setup.sh                 # teammate: Codex + CodeGraph + skills (no DB/deploy account)
./setup.sh --infra         # owner/backend: also Vercel CLI + wire Supabase + Vercel MCP
./setup.sh --playwright    # also wire the Playwright browser MCP (~100MB chromium on first use)
./setup.sh --check         # verify only, install nothing
```

`setup.sh` (idempotent — safe to re-run):

1. verifies Node 22+/npm;
2. installs **Codex CLI** (`@openai/codex`) and **CodeGraph** (`@colbymchenry/codegraph`);
3. puts the freshly-installed global bin on PATH, then runs `codegraph install` to wire CodeGraph into Codex;
4. copies `/ship` + loop prompts to `~/.codex/prompts/`.

With **`--infra`** it also installs the Vercel CLI and wires the **Supabase** and
**Vercel** MCP servers — only the one person managing the shared backend/deploy
needs this. Everyone else uses the shared DB through `app/.env.local`.

If the CLIs install but aren't yet on your shell's PATH, the script says so and
tells you to open a new terminal and re-run — it won't falsely report success.

## 4. Scaffold a runnable app

```bash
./scaffold.sh              # Next.js + TS + Tailwind in ./app  (or bring your own stack)
cd app
codegraph init            # build the local code index for Codex
npm run dev               # http://localhost:3000
```

`scaffold.sh` also seeds `app/.env.local` from `.env.example` — fill it in
(it's gitignored). Doing the scaffold the day before pre-caches the packages.

## 5. Sign in

```bash
codex           # first run: sign in with your OpenAI/ChatGPT account
vercel login
```

If you ran `--infra`, the **Supabase and Vercel MCPs** each open their own
in-browser OAuth the first time the agent calls them — trigger that at home so it
doesn't surprise you mid-build, and pick the ONE shared project. Everyone else can
skip this; they reach the shared DB through `app/.env.local`.

## 6. Verify it worked

```bash
node --version                 # >= 22
codex --version
codegraph --version
vercel --version
codex mcp list                 # → codegraph  (supabase, vercel too if you ran --infra)
ls ~/.codex/prompts/           # → ship.md, loop-demo.md, loop-lint.md, …
```

Then open the repo with Codex and confirm the SessionStart line prints
`[loops] .loops/guardrails.md: N guardrail(s) active` (Codex supports
`.codex/hooks.json` SessionStart hooks). If the Project block is still blank
you'll also see the `[scope] ⚠ …` nudge — fill it before building.

## 7. First real step

Fill the **Project** block at the top of `AGENTS.md` (idea, category, stack, the
one demo path, out-of-scope). That single block keeps a team of 3-6 pointed at
the same demo. Then build.

## Manual MCP wiring (if the script couldn't)

```bash
codegraph install                                    # pick Codex CLI when prompted
codex mcp add supabase --url https://mcp.supabase.com/mcp
codex mcp add vercel   --url https://mcp.vercel.com
codex mcp add playwright -- npx -y @playwright/mcp@latest   # optional
codex mcp list                                       # confirm
```

## Troubleshooting

- **`codex: command not found` after install** — the global npm bin isn't on
  PATH in this shell. Open a new terminal; if it persists, add
  `$(npm prefix -g)/bin` to PATH. (Do **not** `npm i -g codex` — that's an
  unrelated 2012 package. It's `@openai/codex`.)
- **CodeGraph says "not initialized"** in a repo — run `codegraph init` then
  `codegraph index --force` at the repo root (do this in your `app/` dir).
- **Agent can't create a Supabase table** — the MCP needs to have completed its
  browser OAuth, and the project must be selected. Re-run the OAuth from a fresh
  agent session.
- **`scaffold.sh` says the dir exists** — pass another name: `./scaffold.sh web`.
