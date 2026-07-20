# Hackathon Starter (OpenAI Codex)

A pre-wired environment so a team spends the 7 hours **building the product**, not
fighting setup. Clone it, run one script, scaffold an app, start building. Tuned
for the **OpenAI Build Week hackathon** (build with Codex; working demo required).

Distilled from the KIT Label agent stack — this is the **lean** cut: the agent
discipline, the backend + deploy + code-intelligence tools, one-button ship, and
a runnable app scaffold. The heavy compounding-knowledge layer (wiki graph,
Obsidian, 13 loops) is left out on purpose; it's overkill for one evening.

## What you get

| Piece                        | Why it wins you time                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supabase** (MCP)           | Postgres + auth + edge functions, created and queried by the agent. OAuth in-browser, **write-enabled** — Codex can build your schema.                                                                                                                 |
| **Vercel**                   | `vercel` for preview deploys in seconds; Vercel MCP for logs/errors.                                                                                                                                                                                   |
| `scaffold.sh`                | One command → a runnable Next.js + TS + Tailwind app, so Codex/CodeGraph/Vercel/`loop-demo` have something to work on from minute one.                                                                                                                 |
| `AGENTS.md`                  | Codex reads it every session: Karpathy discipline + autopilot default + a scope-lock block, so it builds without hand-holding.                                                                                                                         |
| `/ship`                      | Stage surgically → clean commit → push → verify. Repo stays demo-ready; secrets never leak.                                                                                                                                                            |
| `/loop-lint`, `/loop-demo`   | Drive the build to clean, and the one demo flow to green.                                                                                                                                                                                              |
| **CodeGraph** (MCP)          | Local code knowledge graph. Once your build has real size, Codex answers "what calls X / blast radius of Z" from a pre-built index instead of grepping. Free, 100% local, no auth. (Small payoff on the first hundred lines; grows with the codebase.) |
| **Playwright** (MCP, opt-in) | `./setup.sh --playwright` — drive a real browser to verify the demo path.                                                                                                                                                                              |
| `.loops/guardrails.md`       | Hard constraints (no `git add -A`, no prod deploy without asking, protect the demo path), surfaced at session start.                                                                                                                                   |

## 60-second quickstart

```bash
# 1. Clone the team repo (owner: add teammates as collaborators so they can push)
git clone https://github.com/walklikeaman/codex-hackathon-starter.git && cd codex-hackathon-starter

# 2. Install CLIs + wire MCP into Codex (idempotent)
./setup.sh

# 3. Scaffold a runnable app (do this the day before if you can — it pulls packages)
./scaffold.sh            # Next.js in ./app  (swap for your own stack if you prefer)

# 4. Sign in, then build
codex                    # sign in on first run
vercel login             # (Supabase + Vercel MCPs also OAuth in-browser on first agent use)
```

Fill the **Project** block at the top of `AGENTS.md` before writing code — idea,
stack, the ONE demo path, and what's out of scope. That block is what keeps a
team of 3-6 aimed at the same demo (the session-start hook nags you if it's blank).

Full account + machine checklist: **[INSTALL.md](INSTALL.md)**.
Come-prepared one-pager for the whole team: **[PREFLIGHT.md](PREFLIGHT.md)**.

## Using Claude Code or Cursor instead of Codex?

Same servers, same win. Claude Code: copy `config/mcp.json` → `.mcp.json` and
`AGENTS.md` → `CLAUDE.md` at the repo root. Cursor: copy `config/mcp.json` →
`.cursor/mcp.json`.

## Demo-day tactics (baked into `/loop-demo`)

- **One flow, green, on stage.** A single end-to-end path that works beats five
  half-built ones. Judges score a working demo, not a roadmap.
- **Lock scope in `AGENTS.md` first** — write the demo path and the out-of-scope
  list before writing code. Everything new goes to out-of-scope until it's green.
- **Deploy early to a preview URL.** A live link removes "works on my machine"
  risk and gives you something to show if the laptop misbehaves.
- **Record the green path the moment it works** — a 60-90s screen capture
  (`Cmd-Shift-5` on macOS) is your backup demo if Wi-Fi or the laptop fails on stage.
- **Verify by running, never by assuming.** `/loop-demo` walks the real path.
- **`/ship` often.** Small green commits mean a teammate can pull working code and
  you can always roll back to the last thing that demoed.

## Layout

```
AGENTS.md          the glue Codex reads (fill in Project at kickoff)
setup.sh           idempotent machine setup + MCP wiring  (--playwright, --check)
scaffold.sh        drop in a runnable Next.js app (./app)
.env.example       expected env keys (copy to .env.local; never commit the filled copy)
INSTALL.md         fresh-machine + account checklist
PREFLIGHT.md       short shareable "install before you arrive" one-pager
config/mcp.json    MCP set for Claude Code / Cursor users
prompts/           /ship, /loop-lint, /loop-demo  → copied to ~/.codex/prompts/
.loops/guardrails.md   hard constraints, surfaced at session start
.codex/hooks.json  prints guardrail count + a scope-not-locked nudge at session start
```
