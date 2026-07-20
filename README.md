# Hackathon Starter (OpenAI Codex)

A clean project that already works the way a **mature agentic project** does — so a
team can describe what they want and start building immediately, not fight setup.
Clone it, run one script, scaffold an app, go. Tuned for the **OpenAI Build Week
hackathon** (build with Codex; working demo required).

Nothing domain-specific is baked in — it's a blank project with the full agent
toolkit wired up: discipline, autopilot, compounding memory, quality loops,
one-button ship, code intelligence, and a backend + deploy pipeline.

## What you get

| Piece                        | Why it wins you time                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                  | Codex reads it every session: think-first discipline + autopilot default + a scope-lock block, so it builds without hand-holding.                                              |
| **Supabase** (MCP)           | Postgres + auth + edge functions, created and queried by the agent. OAuth in-browser, **write-enabled** — Codex can build your schema.                                         |
| **Vercel**                   | `vercel` for preview deploys in seconds; Vercel MCP for logs/errors.                                                                                                           |
| `scaffold.sh`                | One command → a runnable Next.js + TS + Tailwind app, so Codex/CodeGraph/Vercel have something to work on from minute one.                                                     |
| **CodeGraph** (MCP)          | Local code knowledge graph. Codex answers "what calls X / blast radius of Z" from a pre-built index instead of grepping — fewer tokens, fewer tool calls. 100% local, no auth. |
| Compounding memory (`wiki/`) | The agent writes decisions, gotchas, and domain notes into a plain-text knowledge base, so the next session and the next teammate start smarter, not from zero.                |
| Quality loops                | `/loop-demo`, `/loop-lint`, `/loop-debug`, `/loop-spec-ship`, `/loop-guardrails`, and more — self-pacing checks that drive work to green.                                      |
| `/ship`                      | Stage surgically → clean commit → push → verify → log. Repo stays demo-ready; secrets never leak.                                                                              |
| `.loops/guardrails.md`       | Hard constraints (no `git add -A`, no prod deploy without asking, protect the demo path), surfaced at session start.                                                           |
| **Playwright** (MCP, opt-in) | `./setup.sh --playwright` — drive a real browser to verify the demo path.                                                                                                      |

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

Then just tell Codex what you're building. Fill the **Project** block at the top of
`AGENTS.md` first — idea, stack, the ONE demo path, and what's out of scope. That
block keeps a team of 3-6 aimed at the same demo (the session-start hook nags you
if it's blank).

Full account + machine checklist: **[INSTALL.md](INSTALL.md)**.
Come-prepared one-pager for the whole team: **[PREFLIGHT.md](PREFLIGHT.md)**.
How the whole method works: **[docs/agent-framework.md](docs/agent-framework.md)**.

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
docs/agent-framework.md   the full method: layers, rituals, loops, ship
config/mcp.json    MCP set for Claude Code / Cursor users
prompts/           /ship + /loop-* → copied to ~/.codex/prompts/
wiki/              compounding knowledge base (index · log · concepts · entities · sources)
Context/           raw, immutable inbox — drop material here, tell the agent to ingest
.loops/            guardrails + reflexion state, surfaced at session start
.obsidian/         open the repo as an Obsidian vault to see the knowledge graph
.codex/hooks.json  prints guardrail count + a scope-not-locked nudge at session start
```
